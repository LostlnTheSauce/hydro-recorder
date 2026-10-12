<?php
declare(strict_types=1);
require __DIR__ . '/inc/bootstrap.php';
set_exception_handler(static function (Throwable $error): void {
    error_log('Hydrotest temperature service: ' . $error->getMessage());
    json_response(['error' => 'Temperature service unavailable. Check the website database setup.'], 503);
});

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST requests only.'], 405);
$action = (string) ($_GET['action'] ?? '');
$payload = json_input();

function temperature_session(string $sessionId): array
{
    if (!preg_match('/^[a-f0-9]{16}$/', $sessionId)) json_response(['error' => 'Invalid session ID.'], 400);
    $statement = db()->prepare('SELECT publisher_token_hash, viewer_password_hash FROM live_sessions WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $sessionId]);
    $session = $statement->fetch();
    if (!$session) json_response(['error' => 'Test session not found.'], 404);
    return $session;
}

function require_temperature_publisher(array $session, string $token): void
{
    if (!preg_match('/^[a-f0-9]{64}$/', $token)
        || !hash_equals((string) $session['publisher_token_hash'], hash('sha256', $token))) {
        json_response(['error' => 'Temperature access was not authorized.'], 403);
    }
}

function temperature_device(array $payload): array
{
    $id = (string) ($payload['device_id'] ?? '');
    $token = (string) ($payload['device_token'] ?? '');
    if (!preg_match('/^[a-f0-9]{16}$/', $id) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        json_response(['error' => 'Field app is not enrolled.'], 403);
    }
    $query = db()->prepare('SELECT id, serial, token_hash, active, source_id FROM temperature_devices WHERE id = :id LIMIT 1');
    $query->execute(['id' => $id]);
    $device = $query->fetch();
    if (!$device || (int) $device['active'] !== 1
        || !hash_equals((string) $device['token_hash'], hash('sha256', $token))) {
        json_response(['error' => 'Field app is not authorized.'], 403);
    }
    return $device;
}

if ($action === 'enroll_device') {
    require_host();
    require_csrf();
    $serial = strtoupper(trim((string) ($payload['serial'] ?? '')));
    if (!preg_match('/^[A-Z0-9_-]{2,40}$/', $serial)) json_response(['error' => 'Enter a valid logger serial.'], 400);
    $existing = db()->prepare('SELECT id FROM temperature_devices WHERE serial = :serial LIMIT 1');
    $existing->execute(['serial' => $serial]);
    if ($existing->fetch()) json_response(['error' => 'This logger is already enrolled; its private access was not changed.'], 409);
    $id = random_hex(8);
    $token = random_hex(32);
    $insert = db()->prepare('INSERT INTO temperature_devices (id, serial, token_hash, created_at)
        VALUES (:id, :serial, :token_hash, :created_at)');
    $insert->execute(['id' => $id, 'serial' => $serial, 'token_hash' => hash('sha256', $token),
        'created_at' => (int) round(microtime(true) * 1000)]);
    json_response(['device_id' => $id, 'device_token' => $token, 'serial' => $serial], 201);
}

if ($action === 'device_heartbeat') {
    $device = temperature_device($payload);
    if ((string) ($payload['serial'] ?? '') !== (string) $device['serial']) {
        json_response(['error' => 'Connected logger does not match this field app.'], 400);
    }
    $now = (int) round(microtime(true) * 1000);
    $ready = ($payload['ready'] ?? false) === true ? 1 : 0;
    $update = db()->prepare('UPDATE temperature_devices SET last_seen_at = :now, ready = :ready WHERE id = :id');
    $update->execute(['now' => $now, 'ready' => $ready, 'id' => $device['id']]);
    require_once __DIR__ . '/inc/field-power.php';
    save_field_power((string) $device['id'], $payload['power'] ?? null, $now);
    $source = null;
    if ($device['source_id'] !== null) {
        $query = db()->prepare('SELECT s.id, s.slot, s.created_at, s.sample_interval_seconds, s.whole_degrees, r.stopped_at
            FROM temperature_sources s JOIN temperature_device_runs r ON r.source_id = s.id
            WHERE s.id = :id LIMIT 1');
        $query->execute(['id' => $device['source_id']]);
        $source = $query->fetch() ?: null;
    }
    // Closed windows are independent of the current assignment. The field app
    // can finish their uploads without reserving the logger or mixing jobs.
    $closed = db()->prepare('SELECT s.id AS source_id, s.created_at AS attached_at, r.stopped_at
        FROM temperature_device_runs r JOIN temperature_sources s ON s.id = r.source_id
        WHERE r.device_id = :device_id AND r.stopped_at IS NOT NULL ORDER BY s.created_at');
    $closed->execute(['device_id' => $device['id']]);
    json_response(['ok' => true, 'source_id' => $source['id'] ?? null, 'slot' => $source['slot'] ?? null,
        'closed_runs' => $closed->fetchAll(),
        'attached_at' => $source === null ? null : (int) $source['created_at'],
        'stopped_at' => $source === null || $source['stopped_at'] === null ? null : (int) $source['stopped_at'],
        'sample_interval_seconds' => $source === null ? null : (int) $source['sample_interval_seconds'],
        'whole_degrees' => $source === null ? null : (int) $source['whole_degrees'] === 1,
        'server_time' => $now]);
}

if ($action === 'device_complete') {
    $device = temperature_device($payload);
    $sourceId = (string) ($payload['source_id'] ?? '');
    if (!preg_match('/^[a-f0-9]{16}$/', $sourceId)) json_response(['error' => 'Invalid recording ID.'], 400);
    $query = db()->prepare('SELECT stopped_at FROM temperature_device_runs WHERE source_id = :source_id AND device_id = :device_id');
    $query->execute(['source_id' => $sourceId, 'device_id' => $device['id']]);
    $run = $query->fetch();
    if (!$run || $run['stopped_at'] === null) json_response(['error' => 'This temperature recording has not stopped.'], 409);
    $clear = db()->prepare('UPDATE temperature_devices SET source_id = NULL WHERE id = :id AND source_id = :source_id');
    $clear->execute(['id' => $device['id'], 'source_id' => $sourceId]);
    json_response(['ok' => true]);
}

if ($action === 'list_devices') {
    require_host();
    require_csrf();
    require_once __DIR__ . '/inc/field-power.php';
    $fieldPower = list_field_power();
    $query = db()->query('SELECT d.id, d.serial, d.ready, d.last_seen_at, d.source_id, s.slot, s.session_id,
        s.sample_interval_seconds, s.whole_degrees,
        r.stopped_at, sa.session_id AS pending_session_id, sa.slot AS pending_slot
        FROM temperature_devices d LEFT JOIN temperature_sources s ON s.id = d.source_id AND s.active = 1
        LEFT JOIN temperature_sources sa ON sa.id = d.source_id
        LEFT JOIN temperature_device_runs r ON r.source_id = d.source_id
        WHERE d.active = 1 ORDER BY d.serial');
    $now = (int) round(microtime(true) * 1000);
    $devices = [];
    foreach ($query->fetchAll() as $row) {
        $lastSeen = $row['last_seen_at'] === null ? null : (int) $row['last_seen_at'];
        $devices[] = ['id' => $row['id'], 'serial' => $row['serial'], 'last_seen_at' => $lastSeen,
            'power' => $fieldPower[$row['id']] ?? null,
            'source_id' => $row['source_id'], 'bridge_online' => $lastSeen !== null && $lastSeen >= $now - 30000,
            'ready' => (int) $row['ready'] === 1,
            'online' => $lastSeen !== null && $lastSeen >= $now - 30000 && (int) $row['ready'] === 1,
            'slot' => $row['slot'], 'session_id' => $row['session_id'],
            'sample_interval_seconds' => $row['sample_interval_seconds'] === null ? null : (int) $row['sample_interval_seconds'],
            'whole_degrees' => $row['whole_degrees'] !== null && (int) $row['whole_degrees'] === 1,
            'finishing' => $row['stopped_at'] !== null,
            'pending_session_id' => $row['stopped_at'] !== null ? $row['pending_session_id'] : null,
            'pending_slot' => $row['stopped_at'] !== null ? $row['pending_slot'] : null];
    }
    json_response(['devices' => $devices, 'server_time' => $now]);
}

if ($action === 'connect_device' || $action === 'disconnect_device') {
    require_host();
    require_csrf();
    $sessionId = (string) ($payload['session_id'] ?? '');
    $session = temperature_session($sessionId);
    require_temperature_publisher($session, (string) ($payload['publish_token'] ?? ''));
    $slot = (string) ($payload['slot'] ?? '');
    $deviceId = (string) ($payload['device_id'] ?? '');
    $sampleInterval = is_numeric($payload['sample_interval_seconds'] ?? null)
        ? (int) $payload['sample_interval_seconds'] : 2;
    $wholeDegrees = ($payload['whole_degrees'] ?? false) === true ? 1 : 0;
    if (!in_array($slot, ['A', 'B'], true) || !preg_match('/^[a-f0-9]{16}$/', $deviceId)) {
        json_response(['error' => 'Choose a test and an enrolled logger.'], 400);
    }
    if ($sampleInterval < 2 || $sampleInterval > 60) {
        json_response(['error' => 'Choose a website temperature interval from 2 to 60 seconds.'], 400);
    }
    $now = (int) round(microtime(true) * 1000);
    db()->beginTransaction();
    try {
        // Serialize starts for this test session, including two different loggers.
        $sessionLock = db()->prepare('SELECT id FROM live_sessions WHERE id = :id FOR UPDATE');
        $sessionLock->execute(['id' => $sessionId]);
        $query = db()->prepare('SELECT id, serial, ready, last_seen_at, source_id FROM temperature_devices WHERE id = :id AND active = 1 FOR UPDATE');
        $query->execute(['id' => $deviceId]);
        $device = $query->fetch();
        if (!$device) { db()->rollBack(); json_response(['error' => 'Logger not found.'], 404); }
        if ($action === 'connect_device' && ((int) $device['ready'] !== 1
            || $device['last_seen_at'] === null || (int) $device['last_seen_at'] < $now - 30000)) {
            db()->rollBack(); json_response(['error' => 'Start the field app and wait for this logger to show online.'], 409);
        }
        if ($action === 'disconnect_device') {
            $check = db()->prepare('SELECT id FROM temperature_sources WHERE id = :id AND session_id = :session_id AND slot = :slot AND active = 1');
            $check->execute(['id' => $device['source_id'], 'session_id' => $sessionId, 'slot' => $slot]);
            if (!$check->fetch()) { db()->rollBack(); json_response(['error' => 'This logger is not connected to that test.'], 409); }
            $disable = db()->prepare('UPDATE temperature_sources SET active = 0 WHERE id = :id');
            $disable->execute(['id' => $device['source_id']]);
            $stop = db()->prepare('UPDATE temperature_device_runs SET stopped_at = :now WHERE source_id = :id AND stopped_at IS NULL');
            $stop->execute(['now' => $now, 'id' => $device['source_id']]);
            db()->commit();
            json_response(['ok' => true, 'stopped_at' => $now]);
        }
        if ($device['source_id'] !== null) {
            $previousQuery = db()->prepare('SELECT s.id, s.active, s.session_id, s.slot, r.stopped_at
                FROM temperature_sources s LEFT JOIN temperature_device_runs r ON r.source_id = s.id
                WHERE s.id = :id FOR UPDATE');
            $previousQuery->execute(['id' => $device['source_id']]);
            $previous = $previousQuery->fetch();
            if ($previous && (int) $previous['active'] === 1 && $previous['stopped_at'] === null) {
                if ($previous['session_id'] === $sessionId && $previous['slot'] === $slot
                    && ($payload['replace_recording'] ?? false) !== true) {
                    db()->commit();
                    json_response(['ok' => true, 'source_id' => $previous['id'], 'resumed' => true]);
                }
                if (($payload['replace_recording'] ?? false) !== true
                    || (string) ($payload['expected_source_id'] ?? '') !== (string) $previous['id']) {
                    db()->rollBack();
                    json_response(['error' => 'This logger is recording elsewhere. Refresh the logger list, then choose Move logger here to stop that recording and start this one.'], 409);
                }
                $stopPrevious = db()->prepare('UPDATE temperature_device_runs SET stopped_at = :now WHERE source_id = :id AND stopped_at IS NULL');
                $stopPrevious->execute(['now' => $now, 'id' => $previous['id']]);
                $disablePrevious = db()->prepare('UPDATE temperature_sources SET active = 0 WHERE id = :id');
                $disablePrevious->execute(['id' => $previous['id']]);
            }
            // A stopped run does not block a fresh Start. Its bounded backlog
            // remains uploadable by this device through closed_runs above.
        }
        $existing = db()->prepare('SELECT id FROM temperature_sources WHERE session_id = :session_id AND slot = :slot AND active = 1 LIMIT 1');
        $existing->execute(['session_id' => $sessionId, 'slot' => $slot]);
        if ($existing->fetch()) {
            db()->rollBack(); json_response(['error' => 'This test already has a temperature recording. Stop it first.'], 409);
        }
        $sourceId = random_hex(8);
        $insert = db()->prepare('INSERT INTO temperature_sources
            (id, session_id, slot, serial, token_hash, active, sample_interval_seconds, whole_degrees, created_at)
            VALUES (:id, :session_id, :slot, :serial, :token_hash, 1, :sample_interval, :whole_degrees, :created_at)');
        $insert->execute(['id' => $sourceId, 'session_id' => $sessionId, 'slot' => $slot,
            'serial' => $device['serial'], 'token_hash' => hash('sha256', random_hex(32)),
            'sample_interval' => $sampleInterval, 'whole_degrees' => $wholeDegrees, 'created_at' => $now]);
        $run = db()->prepare('INSERT INTO temperature_device_runs (source_id, device_id) VALUES (:source_id, :device_id)');
        $run->execute(['source_id' => $sourceId, 'device_id' => $deviceId]);
        $attach = db()->prepare('UPDATE temperature_devices SET source_id = :source_id WHERE id = :id');
        $attach->execute(['source_id' => $sourceId, 'id' => $deviceId]);
        db()->commit();
    } catch (Throwable $error) {
        if (db()->inTransaction()) db()->rollBack();
        throw $error;
    }
    json_response(['ok' => true, 'source_id' => $sourceId]);
}

if ($action === 'create_source') {
    require_host();
    require_csrf();
    $sessionId = (string) ($payload['session_id'] ?? '');
    $session = temperature_session($sessionId);
    require_temperature_publisher($session, (string) ($payload['publish_token'] ?? ''));
    $slot = (string) ($payload['slot'] ?? '');
    $serial = trim((string) ($payload['serial'] ?? ''));
    if (!in_array($slot, ['A', 'B'], true) || !preg_match('/^[A-Za-z0-9_-]{2,40}$/', $serial)) {
        json_response(['error' => 'Choose a test and enter the MadgeTech serial number.'], 400);
    }
    $sourceId = random_hex(8);
    $sourceToken = random_hex(32);
    $now = (int) round(microtime(true) * 1000);
    $activeDevice = db()->prepare('SELECT s.id FROM temperature_sources s
        JOIN temperature_device_runs r ON r.source_id = s.id
        WHERE s.session_id = :session_id AND s.slot = :slot AND s.active = 1 LIMIT 1');
    $activeDevice->execute(['session_id' => $sessionId, 'slot' => $slot]);
    if ($activeDevice->fetch()) json_response(['error' => 'Stop the active temperature recording before using a connection file.'], 409);
    db()->beginTransaction();
    try {
        $disable = db()->prepare('UPDATE temperature_sources SET active = 0 WHERE session_id = :session_id AND slot = :slot');
        $disable->execute(['session_id' => $sessionId, 'slot' => $slot]);
        $insert = db()->prepare('INSERT INTO temperature_sources (id, session_id, slot, serial, token_hash, active, created_at)
            VALUES (:id, :session_id, :slot, :serial, :token_hash, 1, :created_at)');
        $insert->execute([
            'id' => $sourceId, 'session_id' => $sessionId, 'slot' => $slot, 'serial' => $serial,
            'token_hash' => hash('sha256', $sourceToken), 'created_at' => $now,
        ]);
        db()->commit();
    } catch (Throwable $error) {
        if (db()->inTransaction()) db()->rollBack();
        throw $error;
    }
    json_response([
        'source_id' => $sourceId,
        'source_token' => $sourceToken,
        'serial' => $serial,
        'slot' => $slot,
        'endpoint' => base_url() . '/temperature.php?action=ingest',
    ], 201);
}

if ($action === 'ingest' || $action === 'device_ingest') {
    $device = $action === 'device_ingest' ? temperature_device($payload) : null;
    $sourceId = (string) ($payload['source_id'] ?? '');
    $sourceToken = (string) ($payload['source_token'] ?? '');
    if (!preg_match('/^[a-f0-9]{16}$/', $sourceId) || ($device === null && !preg_match('/^[a-f0-9]{64}$/', $sourceToken))) {
        json_response(['error' => 'Missing field-logger credentials.'], 400);
    }
    $lookup = db()->prepare('SELECT s.session_id, s.slot, s.serial, s.token_hash, s.active, s.created_at,
        s.sample_interval_seconds, s.whole_degrees,
        r.device_id, r.stopped_at FROM temperature_sources s
        LEFT JOIN temperature_device_runs r ON r.source_id = s.id WHERE s.id = :id LIMIT 1');
    $lookup->execute(['id' => $sourceId]);
    $source = $lookup->fetch();
    if (!$source || ($device === null && ((int) $source['active'] !== 1
        || !hash_equals((string) $source['token_hash'], hash('sha256', $sourceToken))))
        || ($device !== null && (string) $source['device_id'] !== (string) $device['id'])) {
        json_response(['error' => 'Field-logger connection is not authorized.'], 403);
    }
    if ((string) ($payload['serial'] ?? '') !== (string) $source['serial']) {
        json_response(['error' => 'The connected MadgeTech serial does not match this test.'], 400);
    }
    $samples = $payload['samples'] ?? null;
    if (!is_array($samples) || count($samples) < 1 || count($samples) > 300) {
        json_response(['error' => 'Send between 1 and 300 temperature samples.'], 400);
    }
    $now = (int) round(microtime(true) * 1000);
    $clean = [];
    foreach ($samples as $sample) {
        if (!is_array($sample) || !is_numeric($sample['at'] ?? null)) json_response(['error' => 'Invalid sample time.'], 400);
        $at = (int) round((float) $sample['at']);
        if ($at < 1577836800000 || $at > $now + 30000) json_response(['error' => 'Sample time is outside the allowed range. Check the field laptop clock.'], 400);
        if ($device !== null && $at < (int) $source['created_at']) {
            json_response(['error' => 'Temperature sample predates Start recording. Check the field laptop clock.'], 400);
        }
        if ($device !== null && $source['stopped_at'] !== null && $at > (int) $source['stopped_at']) {
            json_response(['error' => 'Temperature sample is after Stop recording.'], 400);
        }
        $recordedAt = $at;
        if ($device !== null) {
            $intervalMs = max(2, min(60, (int) $source['sample_interval_seconds'])) * 1000;
            $recordedAt = (int) $source['created_at']
                + (int) floor(($at - (int) $source['created_at']) / $intervalMs) * $intervalMs;
        }
        $row = ['at' => $recordedAt, 'sample_at' => $at];
        $hasValue = false;
        foreach (['pipe', 'soil', 'ambient', 'aux'] as $channel) {
            $value = $sample[$channel] ?? null;
            if ($value === null || $value === '') { $row[$channel] = null; continue; }
            if (!is_numeric($value) || !is_finite((float) $value) || abs((float) $value) > 10000) {
                json_response(['error' => 'Invalid temperature value.'], 400);
            }
            $number = (float) $value;
            $row[$channel] = $device !== null && (int) $source['whole_degrees'] === 1 ? round($number) : $number;
            $hasValue = true;
        }
        if (!$hasValue) json_response(['error' => 'A sample must contain a temperature.'], 400);
        $clean[] = $row;
    }
    $duplicateUpdate = $device !== null
        ? 'source_id = VALUES(source_id)'
        : 'received_at = VALUES(received_at), pipe = VALUES(pipe), soil = VALUES(soil), ambient = VALUES(ambient), aux = VALUES(aux)';
    $insert = db()->prepare('INSERT INTO temperature_readings
        (source_id, session_id, slot, captured_at, received_at, pipe, soil, ambient, aux)
        VALUES (:source_id, :session_id, :slot, :at, :received_at, :pipe, :soil, :ambient, :aux)
        ON DUPLICATE KEY UPDATE ' . $duplicateUpdate);
    db()->beginTransaction();
    try {
        if ($device !== null) {
            // Serialize an in-flight upload against the host's Stop recording click.
            $lock = db()->prepare('SELECT s.active, s.created_at, r.stopped_at FROM temperature_sources s
                JOIN temperature_device_runs r ON r.source_id = s.id WHERE s.id = :id FOR UPDATE');
            $lock->execute(['id' => $sourceId]);
            $current = $lock->fetch();
            if (!$current || ((int) $current['active'] !== 1 && $current['stopped_at'] === null)) {
                db()->rollBack();
                json_response(['error' => 'Temperature recording is unavailable.'], 409);
            }
            foreach ($clean as $sample) {
                if ($sample['sample_at'] < (int) $current['created_at']
                    || ($current['stopped_at'] !== null && $sample['sample_at'] > (int) $current['stopped_at'])) {
                    db()->rollBack();
                    json_response(['error' => 'Sample falls outside the Start/Stop recording window.'], 409);
                }
            }
        }
        foreach ($clean as $sample) {
            $insert->execute([
                'source_id' => $sourceId, 'session_id' => $source['session_id'], 'slot' => $source['slot'],
                'at' => $sample['at'], 'received_at' => $now, 'pipe' => $sample['pipe'],
                'soil' => $sample['soil'], 'ambient' => $sample['ambient'], 'aux' => $sample['aux'],
            ]);
        }
        db()->commit();
    } catch (Throwable $error) {
        if (db()->inTransaction()) db()->rollBack();
        throw $error;
    }
    json_response(['ok' => true, 'accepted' => count($clean), 'server_time' => $now]);
}

if ($action === 'view') {
    $sessionId = (string) ($payload['session_id'] ?? '');
    $session = temperature_session($sessionId);
    $publishToken = (string) ($payload['publish_token'] ?? '');
    $viewerPassword = (string) ($payload['viewer_password'] ?? '');
    $authorized = preg_match('/^[a-f0-9]{64}$/', $publishToken)
        && hash_equals((string) $session['publisher_token_hash'], hash('sha256', $publishToken));
    if (!$authorized && ($viewerPassword === '' || !password_verify($viewerPassword, (string) $session['viewer_password_hash']))) {
        json_response(['error' => 'Temperature access was not authorized.'], 403);
    }
    $sinceId = is_numeric($payload['since_id'] ?? null) ? max(0, (int) $payload['since_id']) : 0;
    $query = db()->prepare('SELECT id, slot, source_id, captured_at AS at, pipe, soil, ambient, aux
        FROM temperature_readings WHERE session_id = :session_id AND id > :since_id ORDER BY id ASC LIMIT 5001');
    $query->execute(['session_id' => $sessionId, 'since_id' => $sinceId]);
    $rows = $query->fetchAll();
    $hasMore = count($rows) > 5000;
    if ($hasMore) array_pop($rows);
    $lastId = $rows ? (int) $rows[count($rows) - 1]['id'] : $sinceId;
    json_response([
        'readings' => $rows, 'last_id' => $lastId, 'has_more' => $hasMore,
        'server_time' => (int) round(microtime(true) * 1000),
    ]);
}

json_response(['error' => 'Unknown temperature action.'], 404);
