<?php
declare(strict_types=1);

function history_schema(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS hydro_jobs (id VARCHAR(64) PRIMARY KEY, writer_hash VARCHAR(64) NOT NULL, revision BIGINT NOT NULL DEFAULT 0, label VARCHAR(160) NOT NULL, status VARCHAR(16) NOT NULL, updated_at BIGINT NOT NULL, metadata_json MEDIUMTEXT NOT NULL, manifest_json MEDIUMTEXT NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS hydro_job_chunks (job_id VARCHAR(64) NOT NULL, hash VARCHAR(64) NOT NULL, created_at BIGINT NOT NULL, data_json MEDIUMTEXT NOT NULL, PRIMARY KEY(job_id, hash))');
    // Organization is separate from uploaded snapshots: retries must never undo
    // a phone rename, folder move, or Trash action.
    $db->exec('CREATE TABLE IF NOT EXISTS hydro_job_organization (job_id VARCHAR(64) PRIMARY KEY, custom_label VARCHAR(160) NOT NULL, folder VARCHAR(160) NOT NULL, deleted_at BIGINT NOT NULL, version BIGINT NOT NULL)');
}
function history_list(PDO $db): array {
    return $db->query("SELECT j.id, CASE WHEN COALESCE(o.custom_label, '') = '' THEN j.label ELSE o.custom_label END AS label, j.status, j.updated_at, COALESCE(o.folder, '') AS folder, COALESCE(o.deleted_at, 0) AS deleted_at, COALESCE(o.version, 0) AS organization_version FROM hydro_jobs j LEFT JOIN hydro_job_organization o ON o.job_id = j.id WHERE j.revision > 0 ORDER BY j.updated_at DESC")->fetchAll(PDO::FETCH_ASSOC);
}
function history_manage(PDO $db, string $action, array $p): array {
    $id = history_id($p['id'] ?? null);
    if (!in_array($action, ['rename', 'move', 'trash', 'restore'], true)) throw new InvalidArgumentException('Unknown organization action.');
    $value = $p['value'] ?? '';
    if (!is_string($value)) throw new InvalidArgumentException('Enter a name.');
    $value = trim($value);
    if (strlen($value) > 160 || preg_match('/[\x00-\x1F\x7F]/', $value) || !preg_match('//u', $value)) throw new InvalidArgumentException('Use a shorter name without control characters (maximum 160 UTF-8 bytes).');
    if ($action === 'rename' && $value === '') throw new InvalidArgumentException('Enter a test name.');
    try {
        $db->beginTransaction();
        $q = $db->prepare('SELECT revision FROM hydro_jobs WHERE id = ?' . ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : ''));
        $q->execute([$id]);
        if (!(int) $q->fetchColumn()) throw new InvalidArgumentException('Saved test not found.');
        $q = $db->prepare('SELECT * FROM hydro_job_organization WHERE job_id = ?'); $q->execute([$id]);
        $current = $q->fetch(PDO::FETCH_ASSOC);
        $row = $current ?: ['custom_label'=>'', 'folder'=>'', 'deleted_at'=>0, 'version'=>0];
        if ((int) ($p['version'] ?? -1) !== (int) $row['version']) throw new RuntimeException('This test was changed on another device. The list has refreshed; try again.');
        if ($action === 'rename') $row['custom_label'] = $value;
        if ($action === 'move') $row['folder'] = $value;
        if ($action === 'trash') $row['deleted_at'] = (int) round(microtime(true)*1000);
        if ($action === 'restore') $row['deleted_at'] = 0;
        $row['version']++;
        $values = [$row['custom_label'], $row['folder'], $row['deleted_at'], $row['version'], $id];
        if ($current) $db->prepare('UPDATE hydro_job_organization SET custom_label = ?, folder = ?, deleted_at = ?, version = ? WHERE job_id = ?')->execute($values);
        else $db->prepare('INSERT INTO hydro_job_organization (custom_label, folder, deleted_at, version, job_id) VALUES (?, ?, ?, ?, ?)')->execute($values);
        $db->commit();
        return ['organization' => $row];
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
function history_id(mixed $id): string {
    if (!is_string($id) || !preg_match('/^[a-zA-Z0-9_-]{16,64}$/', $id)) throw new InvalidArgumentException('Invalid job ID.');
    return $id;
}
function history_get(PDO $db, string $id): ?array {
    $q = $db->prepare('SELECT * FROM hydro_jobs WHERE id = ?'); $q->execute([$id]);
    return $q->fetch(PDO::FETCH_ASSOC) ?: null;
}
function history_owner(array $job, mixed $writer): void {
    if (!is_string($writer) || !preg_match('/^[a-f0-9]{64}$/', $writer) || !hash_equals($job['writer_hash'], hash('sha256', $writer))) throw new RuntimeException('This job is saved by its original recording computer. View it in Test history; do not overwrite it from another copy.');
}
function history_write(PDO $db, string $action, array $p): array {
    $id = history_id($p['id'] ?? null);
    if ($action === 'claim') {
        if (!preg_match('/^[a-f0-9]{64}$/', (string) ($p['writer'] ?? ''))) throw new InvalidArgumentException('Invalid recording device key.');
        $job = history_get($db, $id);
        if (!$job) {
            try {
                $q = $db->prepare('INSERT INTO hydro_jobs (id, writer_hash, label, status, updated_at, metadata_json, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
                $q->execute([$id, hash('sha256', $p['writer']), 'Uploading test', 'uploading', 0, '{}', '{}']);
            } catch (PDOException $e) { if (!history_get($db, $id)) throw $e; }
            $job = history_get($db, $id);
        }
        history_owner($job, $p['writer']);
        return ['revision' => (int) $job['revision'], 'manifest' => json_decode($job['manifest_json'], true)];
    }
    $job = history_get($db, $id);
    if (!$job) throw new InvalidArgumentException('Job not found.');
    history_owner($job, $p['writer'] ?? null);
    if ($action === 'chunk') {
        $data = $p['data'] ?? null;
        if (!is_string($data) || strlen($data) > 900000) throw new InvalidArgumentException('Reading batch is too large.');
        $rows = json_decode($data, true);
        if (!is_array($rows) || array_values($rows) !== $rows || count($rows) > 2000) throw new InvalidArgumentException('Invalid reading batch.');
        foreach ($rows as $r) {
            if (!is_array($r) || !isset($r['at']) || !is_numeric($r['at']) || !is_finite((float) $r['at']) || (float) $r['at'] < 0) throw new InvalidArgumentException('Invalid reading time.');
        }
        $hash = hash('sha256', $data);
        if (!hash_equals($hash, (string) ($p['hash'] ?? ''))) throw new InvalidArgumentException('Reading batch checksum failed.');
        $q = $db->prepare('SELECT hash FROM hydro_job_chunks WHERE job_id = ? AND hash = ?'); $q->execute([$id, $hash]);
        if (!$q->fetch()) {
            try { $q = $db->prepare('INSERT INTO hydro_job_chunks (job_id, hash, created_at, data_json) VALUES (?, ?, ?, ?)'); $q->execute([$id, $hash, (int) round(microtime(true)*1000), $data]); }
            catch (PDOException $e) { $q = $db->prepare('SELECT hash FROM hydro_job_chunks WHERE job_id = ? AND hash = ?'); $q->execute([$id, $hash]); if (!$q->fetch()) throw $e; }
        }
        $db->prepare('UPDATE hydro_job_chunks SET created_at = ? WHERE job_id = ? AND hash = ?')->execute([(int) round(microtime(true)*1000), $id, $hash]);
        return ['hash' => $hash];
    }
    if ($action !== 'commit') throw new InvalidArgumentException('Unknown history action.');
    $metadata = $p['metadata'] ?? null; $manifest = $p['manifest'] ?? null;
    if (!is_array($metadata) || !is_array($metadata['test'] ?? null) || !is_array($manifest)) throw new InvalidArgumentException('Invalid job details.');
    $metaJson = json_encode($metadata, JSON_THROW_ON_ERROR);
    if (strlen($metaJson) > 2000000) throw new InvalidArgumentException('Job details are too large.');
    try {
    $db->beginTransaction();
    $lockSql = 'SELECT * FROM hydro_jobs WHERE id = ?' . ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '');
    $lock = $db->prepare($lockSql); $lock->execute([$id]); $job = $lock->fetch(PDO::FETCH_ASSOC);
    history_owner($job, $p['writer']);
    foreach (['readings', 'temperatureReadings'] as $kind) {
        if (!is_array($manifest[$kind] ?? null) || count($manifest[$kind]) > 5000) throw new InvalidArgumentException('Invalid recording manifest.');
        foreach ($manifest[$kind] as $hash) {
            if (!is_string($hash) || !preg_match('/^[a-f0-9]{64}$/', $hash)) throw new InvalidArgumentException('Invalid reading checksum.');
            $q = $db->prepare('SELECT hash FROM hydro_job_chunks WHERE job_id = ? AND hash = ?'); $q->execute([$id, $hash]);
            if (!$q->fetch()) throw new InvalidArgumentException('Upload is incomplete. Previous saved version has not changed.');
        }
    }
    // One atomic manifest change publishes a complete snapshot, never half an upload.
    $status = !empty($metadata['archivedAt']) ? 'archived' : 'recording';
    if ($job['status'] === 'archived' && $status !== 'archived') throw new RuntimeException('This job is already archived. Refresh the recording computer.');
    $label = substr((string) (($metadata['test']['jobNumber'] ?? '') ?: ($metadata['test']['design']['projectName'] ?? $metadata['test']['displayName'] ?? 'Hydrotest')), 0, 160);
    $now = (int) round(microtime(true) * 1000);
    $q = $db->prepare('UPDATE hydro_jobs SET revision = revision + 1, label = ?, status = ?, updated_at = ?, metadata_json = ?, manifest_json = ? WHERE id = ? AND revision = ?');
    $q->execute([$label, $status, $now, $metaJson, json_encode($manifest, JSON_THROW_ON_ERROR), $id, (int) ($p['revision'] ?? -1)]);
    if ($q->rowCount() !== 1) throw new RuntimeException('Another save finished first. The upload will retry.');
    $db->commit();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
    // Keep yesterday's superseded tails for in-progress readers. Completed job
    // chunks are never expired: only old, unreferenced upload fragments qualify.
    // A transaction/row lock prevents cleanup racing a different manifest commit.
    if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' && random_int(1, 30) === 1) {
        try {
            $db->beginTransaction();
            $lock = $db->prepare('SELECT manifest_json FROM hydro_jobs WHERE id = ? FOR UPDATE'); $lock->execute([$id]);
            $current = json_decode((string) $lock->fetchColumn(), true);
            $keep = array_values(array_unique(array_merge($current['readings'] ?? [], $current['temperatureReadings'] ?? [])));
            $sql = 'DELETE FROM hydro_job_chunks WHERE job_id = ? AND created_at < ?';
            if ($keep) $sql .= ' AND hash NOT IN (' . implode(',', array_fill(0, count($keep), '?')) . ')';
            $db->prepare($sql)->execute(array_merge([$id, $now - 86400000], $keep));
            $db->commit();
        } catch (Throwable $cleanupError) { if ($db->inTransaction()) $db->rollBack(); error_log('Hydro history fragment cleanup deferred.'); }
    }
    return ['revision' => (int) $p['revision'] + 1, 'updatedAt' => $now];
}
