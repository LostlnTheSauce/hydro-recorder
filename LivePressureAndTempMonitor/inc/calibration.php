<?php
declare(strict_types=1);

// Calibration papers: one current certificate (PDF, JPEG or PNG) per piece of equipment,
// stored in the database so it is on every device the host signs in from.

const CALIBRATION_MAX_BYTES = 8000000;

function calibration_schema(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS hydro_calibration_papers (equipment_id VARCHAR(80) PRIMARY KEY, file_name VARCHAR(200) NOT NULL, mime VARCHAR(40) NOT NULL, size INT NOT NULL, sha256 CHAR(64) NOT NULL, uploaded_at BIGINT NOT NULL, data LONGBLOB NOT NULL)');
}

function calibration_equipment_id(mixed $id): string {
    if (!is_string($id) || !preg_match('/^[A-Za-z0-9_.-]{1,80}$/', $id)) throw new InvalidArgumentException('Invalid equipment ID.');
    return $id;
}

// The file type comes from its first bytes, never from the name or the browser.
function calibration_kind(string $bytes): string {
    if (str_starts_with($bytes, '%PDF-')) return 'application/pdf';
    if (str_starts_with($bytes, "\xFF\xD8\xFF")) return 'image/jpeg';
    if (str_starts_with($bytes, "\x89PNG\r\n\x1A\n")) return 'image/png';
    throw new InvalidArgumentException('Upload the calibration paper as a PDF, JPEG or PNG.');
}

function calibration_file_name(mixed $name, string $mime): string {
    $name = is_string($name) ? basename(str_replace('\\', '/', $name)) : '';
    $name = trim((string) preg_replace('/[\x00-\x1F\x7F"]+/', '', $name));
    if (!preg_match('//u', $name)) $name = '';
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, 120, 'UTF-8'); else $name = substr($name, 0, 120);
    if ($name === '') $name = 'calibration.' . ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png'][$mime];
    return $name;
}

function calibration_limit(): int {
    $post = (string) ini_get('post_max_size');
    $bytes = (int) $post;
    $unit = strtoupper(substr(trim($post), -1));
    if ($unit === 'G') $bytes *= 1073741824; elseif ($unit === 'M') $bytes *= 1048576; elseif ($unit === 'K') $bytes *= 1024;
    return $bytes > 0 ? min(CALIBRATION_MAX_BYTES, $bytes - 4096) : CALIBRATION_MAX_BYTES;
}

function calibration_save(PDO $db, mixed $equipmentId, mixed $fileName, string $bytes, ?int $now = null): array {
    $id = calibration_equipment_id($equipmentId);
    if ($bytes === '') throw new InvalidArgumentException('The file is empty.');
    if (strlen($bytes) > CALIBRATION_MAX_BYTES) throw new InvalidArgumentException('The file is larger than 8 MB. Scan it at a lower resolution and try again.');
    $mime = calibration_kind($bytes);
    $row = ['equipment_id' => $id, 'file_name' => calibration_file_name($fileName, $mime), 'mime' => $mime, 'size' => strlen($bytes),
        'sha256' => hash('sha256', $bytes), 'uploaded_at' => $now ?? (int) round(microtime(true) * 1000)];
    try {
        $db->beginTransaction();
        $db->prepare('DELETE FROM hydro_calibration_papers WHERE equipment_id = ?')->execute([$id]);
        $q = $db->prepare('INSERT INTO hydro_calibration_papers (equipment_id, file_name, mime, size, sha256, uploaded_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $q->bindValue(1, $row['equipment_id']); $q->bindValue(2, $row['file_name']); $q->bindValue(3, $row['mime']);
        $q->bindValue(4, $row['size'], PDO::PARAM_INT); $q->bindValue(5, $row['sha256']); $q->bindValue(6, $row['uploaded_at'], PDO::PARAM_INT);
        $q->bindValue(7, $bytes, PDO::PARAM_LOB);
        $q->execute();
        $db->commit();
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
    return $row;
}

function calibration_list(PDO $db): array {
    $rows = $db->query('SELECT equipment_id, file_name, mime, size, sha256, uploaded_at FROM hydro_calibration_papers ORDER BY equipment_id')->fetchAll(PDO::FETCH_ASSOC);
    return array_map(fn ($r) => ['equipment_id' => (string) $r['equipment_id'], 'file_name' => (string) $r['file_name'], 'mime' => (string) $r['mime'],
        'size' => (int) $r['size'], 'sha256' => (string) $r['sha256'], 'uploaded_at' => (int) $r['uploaded_at']], $rows);
}

function calibration_get(PDO $db, mixed $equipmentId): ?array {
    $q = $db->prepare('SELECT equipment_id, file_name, mime, size, data FROM hydro_calibration_papers WHERE equipment_id = ?');
    $q->execute([calibration_equipment_id($equipmentId)]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    if (is_resource($row['data'])) $row['data'] = stream_get_contents($row['data']);
    return $row;
}

function calibration_delete(PDO $db, mixed $equipmentId): bool {
    $q = $db->prepare('DELETE FROM hydro_calibration_papers WHERE equipment_id = ?');
    $q->execute([calibration_equipment_id($equipmentId)]);
    return $q->rowCount() > 0;
}

// The equipment library, shared from the recording computer so the phone scanning page can
// list the same equipment. The whole list is one snapshot; the newest save wins.
function equipment_schema(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS hydro_equipment_inventory (id INT PRIMARY KEY, updated_at BIGINT NOT NULL, data_json MEDIUMTEXT NOT NULL)');
}

function equipment_clean(mixed $items): array {
    if (!is_array($items) || !array_is_list($items) || count($items) > 500) throw new InvalidArgumentException('Invalid equipment list.');
    $text = function (mixed $v, int $max): string {
        $v = is_scalar($v) ? trim((string) $v) : '';
        $v = (string) preg_replace('/[\x00-\x1F\x7F]+/', ' ', $v);
        if (!preg_match('//u', $v)) $v = '';
        return function_exists('mb_substr') ? mb_substr($v, 0, $max, 'UTF-8') : substr($v, 0, $max);
    };
    $types = ['deadweight', 'digital_gauge', 'pressure_recorder', 'ambient_chart', 'pipe_chart', 'ground_chart', 'pump'];
    $clean = [];
    foreach ($items as $item) {
        if (!is_array($item)) throw new InvalidArgumentException('Invalid equipment entry.');
        $type = (string) ($item['type'] ?? '');
        if (!in_array($type, $types, true)) throw new InvalidArgumentException('Unknown equipment type.');
        $date = (string) ($item['calibrationDate'] ?? '');
        $clean[] = ['id' => calibration_equipment_id($item['id'] ?? null), 'type' => $type, 'name' => $text($item['name'] ?? '', 120),
            'serial' => $text($item['serial'] ?? '', 60), 'manufacturer' => $text($item['manufacturer'] ?? '', 80), 'range' => $text($item['range'] ?? '', 60),
            'calibrationDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : '', 'intervalMonths' => max(1, min(60, (int) ($item['intervalMonths'] ?? 6))),
            'capacity' => $text($item['capacity'] ?? '', 20), 'isDefault' => !empty($item['isDefault'])];
    }
    return $clean;
}

function equipment_get(PDO $db): array {
    $row = $db->query('SELECT updated_at, data_json FROM hydro_equipment_inventory WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
    return $row ? ['updatedAt' => (int) $row['updated_at'], 'items' => json_decode((string) $row['data_json'], true) ?: []] : ['updatedAt' => 0, 'items' => []];
}

// Saves the list when it is newer than the stored one; returns what is stored afterwards.
function equipment_save(PDO $db, mixed $items, mixed $savedAt): array {
    $clean = equipment_clean($items);
    if (!is_int($savedAt) && !(is_float($savedAt) && floor($savedAt) === $savedAt)) throw new InvalidArgumentException('Invalid save time.');
    $savedAt = (int) $savedAt;
    try {
        $db->beginTransaction();
        $current = equipment_get($db);
        if ($savedAt > $current['updatedAt']) {
            $json = json_encode($clean, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($current['updatedAt'] === 0 && !$db->query('SELECT COUNT(*) FROM hydro_equipment_inventory')->fetchColumn()) $db->prepare('INSERT INTO hydro_equipment_inventory (id, updated_at, data_json) VALUES (1, ?, ?)')->execute([$savedAt, $json]);
            else $db->prepare('UPDATE hydro_equipment_inventory SET updated_at = ?, data_json = ? WHERE id = 1')->execute([$savedAt, $json]);
        }
        $db->commit();
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
    return equipment_get($db);
}
