<?php
declare(strict_types=1);
require __DIR__ . '/inc/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'POST requests only.'], 405);
}

$action = (string) ($_GET['action'] ?? '');
$payload = json_input();

function require_live_session_publisher(array $payload): array
{
    $sessionId = (string) ($payload['session_id'] ?? '');
    $publishToken = (string) ($payload['publish_token'] ?? '');
    if (!preg_match('/^[a-f0-9]{16}$/', $sessionId) || !preg_match('/^[a-f0-9]{64}$/', $publishToken)) {
        json_response(['error' => 'Missing test-session credentials.'], 400);
    }
    $query = db()->prepare('SELECT id, publisher_token_hash FROM live_sessions WHERE id = :id LIMIT 1');
    $query->execute(['id' => $sessionId]);
    $session = $query->fetch();
    if (!$session || !hash_equals((string) $session['publisher_token_hash'], hash('sha256', $publishToken))) {
        json_response(['error' => 'Test-session access was not authorized.'], 403);
    }
    return $session;
}

if (in_array($action, ['sheet_create', 'sheet_sync'], true)) {
    require_host();
    require_csrf();
    $snapshot = is_array($payload['snapshot'] ?? null) ? $payload['snapshot'] : [];
    try {
        if ($action === 'sheet_create') {
            $title = trim((string) ($payload['title'] ?? 'Hydrotest paperwork'));
            $result = google_sheet_request([
                'action' => 'create',
                'title' => substr($title !== '' ? $title : 'Hydrotest paperwork', 0, 120),
                'snapshot' => $snapshot,
            ]);
            json_response($result, 201);
        }
        $spreadsheetId = trim((string) ($payload['spreadsheet_id'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_-]{20,}$/', $spreadsheetId)) {
            json_response(['error' => 'The saved Google Sheet ID is invalid. Create a new Sheet for this test.'], 400);
        }
        $result = google_sheet_request([
            'action' => 'sync',
            'spreadsheetId' => $spreadsheetId,
            'finalized' => !empty($payload['finalized']),
            'snapshot' => $snapshot,
        ]);
        json_response($result);
    } catch (Throwable $error) {
        json_response(['error' => $error->getMessage()], 502);
    }
}

if ($action === 'create' || $action === 'create_private') {
    require_host();
    require_csrf();
    $private = $action === 'create_private';
    $title = trim((string) ($payload['title'] ?? ($private ? 'Hydrotest recording' : 'Live pressure tests')));
    $title = substr($title !== '' ? $title : 'Live pressure tests', 0, 100);
    $viewerPassword = $private ? random_hex(32) : trim((string) ($payload['viewer_password'] ?? ''));
    if (!$private && strlen($viewerPassword) < 4) {
        json_response(['error' => 'Use a viewer password with at least four characters.'], 400);
    }
    $sessionId = random_hex(8);
    $publishToken = random_hex(32);
    $now = (int) round(microtime(true) * 1000);
    $statement = db()->prepare(
        'INSERT INTO live_sessions (id, title, viewer_password_hash, publisher_token_hash, config_json, created_at, updated_at)
         VALUES (:id, :title, :viewer_hash, :publisher_hash, :config, :created, :updated)'
    );
    $statement->execute([
        'id' => $sessionId,
        'title' => $title,
        'viewer_hash' => password_hash($viewerPassword, PASSWORD_DEFAULT),
        'publisher_hash' => hash('sha256', $publishToken),
        'config' => '{}',
        'created' => $now,
        'updated' => $now,
    ]);
    $response = [
        'session_id' => $sessionId,
        'publish_token' => $publishToken,
        'viewer_enabled' => !$private,
    ];
    if (!$private) $response['viewer_url'] = base_url() . '/viewer.php?id=' . rawurlencode($sessionId);
    json_response($response, 201);
}

if ($action === 'enable_viewer' || $action === 'disable_viewer') {
    require_host();
    require_csrf();
    $session = require_live_session_publisher($payload);
    $now = (int) round(microtime(true) * 1000);
    if ($action === 'enable_viewer') {
        $title = trim((string) ($payload['title'] ?? 'Live pressure tests'));
        $title = substr($title !== '' ? $title : 'Live pressure tests', 0, 100);
        $viewerPassword = trim((string) ($payload['viewer_password'] ?? ''));
        if (strlen($viewerPassword) < 4) json_response(['error' => 'Use a viewer password with at least four characters.'], 400);
        $update = db()->prepare('UPDATE live_sessions SET title = :title, viewer_password_hash = :viewer_hash, updated_at = :updated WHERE id = :id');
        $update->execute(['title' => $title, 'viewer_hash' => password_hash($viewerPassword, PASSWORD_DEFAULT),
            'updated' => $now, 'id' => $session['id']]);
        json_response(['ok' => true, 'viewer_enabled' => true,
            'viewer_url' => base_url() . '/viewer.php?id=' . rawurlencode((string) $session['id'])]);
    }
    // Rotate the password so an already-open viewer loses access immediately,
    // while the private test/temperature session remains available to the host.
    $update = db()->prepare('UPDATE live_sessions SET viewer_password_hash = :viewer_hash, updated_at = :updated WHERE id = :id');
    $update->execute(['viewer_hash' => password_hash(random_hex(32), PASSWORD_DEFAULT),
        'updated' => $now, 'id' => $session['id']]);
    json_response(['ok' => true, 'viewer_enabled' => false]);
}

if ($action === 'publish') {
    $sessionId = (string) ($payload['session_id'] ?? '');
    $publishToken = (string) ($payload['publish_token'] ?? '');
    if (!preg_match('/^[a-f0-9]{16}$/', $sessionId) || !preg_match('/^[a-f0-9]{64}$/', $publishToken)) {
        json_response(['error' => 'Missing publishing credentials.'], 400);
    }
    $sessionStatement = db()->prepare('SELECT publisher_token_hash FROM live_sessions WHERE id = :id LIMIT 1');
    $sessionStatement->execute(['id' => $sessionId]);
    $session = $sessionStatement->fetch();
    if (!$session || !hash_equals((string) $session['publisher_token_hash'], hash('sha256', $publishToken))) {
        json_response(['error' => 'Publishing was not authorized.'], 403);
    }

    $gauges = is_array($payload['gauges'] ?? null) ? $payload['gauges'] : [];
    $insert = db()->prepare(
        'INSERT INTO live_readings (session_id, slot, captured_at, pressure, unit)
         VALUES (:session_id, :slot, :captured_at, :pressure, :unit)
         ON DUPLICATE KEY UPDATE pressure = VALUES(pressure), unit = VALUES(unit)'
    );
    $config = [];
    $notesInput = is_array($payload['notes'] ?? null) ? array_slice($payload['notes'], -200) : [];
    $notes = [];
    foreach ($notesInput as $note) {
        if (!is_array($note) || !is_numeric($note['at'] ?? null)) continue;
        $text = trim((string) ($note['text'] ?? ''));
        if ($text === '') continue;
        $notes[] = [
            'at' => (int) round((float) $note['at']),
            'text' => substr($text, 0, 500),
        ];
    }
    $accepted = 0;
    db()->beginTransaction();
    try {
        // Preserve the other slot, and prevent an older host tab from reverting a new job.
        $currentConfig = db()->prepare('SELECT config_json FROM live_sessions WHERE id = :id FOR UPDATE');
        $currentConfig->execute(['id' => $sessionId]);
        $savedConfig = json_decode((string) $currentConfig->fetchColumn(), true);
        $config = is_array($savedConfig) ? $savedConfig : [];
        $staleJob = false;
        $processed = 0;
        foreach ($gauges as $gauge) {
            if (!is_array($gauge)) continue;
            $slot = ($gauge['slot'] ?? '') === 'B' ? 'B' : (($gauge['slot'] ?? '') === 'A' ? 'A' : '');
            if ($slot === '') continue;
            $incomingConfig = is_array($gauge['config'] ?? null) ? $gauge['config'] : [];
            $jobStart = max(0, (int) ($incomingConfig['jobStartedAt'] ?? 0));
            if ($jobStart < (int) ($config[$slot]['jobStartedAt'] ?? 0)) { $staleJob = true; continue; }
            $config[$slot] = $incomingConfig;
            $readings = is_array($gauge['readings'] ?? null) ? $gauge['readings'] : [];
            if (!$readings && is_array($gauge['reading'] ?? null)) $readings = [$gauge['reading']];
            foreach ($readings as $reading) {
                if ($processed >= 5000) break 2;
                if (!is_array($reading) || !is_numeric($reading['at'] ?? null) || !is_numeric($reading['pressure'] ?? null)) continue;
                if ((float) $reading['at'] < $jobStart) continue;
                $insert->execute([
                    'session_id' => $sessionId,
                    'slot' => $slot,
                    'captured_at' => (int) round((float) $reading['at']),
                    'pressure' => (float) $reading['pressure'],
                    'unit' => clean_unit($reading['unit'] ?? 'PSI'),
                ]);
                $accepted += $insert->rowCount();
                $processed++;
            }
        }
        if (!$staleJob) $config['notes'] = $notes;
        $now = (int) round(microtime(true) * 1000);
        $update = db()->prepare('UPDATE live_sessions SET config_json = :config, updated_at = :updated WHERE id = :id');
        $update->execute([
            'config' => json_encode($config, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE),
            'updated' => $now,
            'id' => $sessionId,
        ]);
        db()->commit();
    } catch (Throwable $error) {
        if (db()->inTransaction()) db()->rollBack();
        throw $error;
    }

    $retention = max(24, min(720, (int) app_config('retention_hours', 72)));
    if (random_int(1, 60) === 1) {
        $cutoff = (int) round((microtime(true) - $retention * 3600) * 1000);
        $cleanup = db()->prepare('DELETE FROM live_readings WHERE captured_at < :cutoff');
        $cleanup->execute(['cutoff' => $cutoff]);
    }
    json_response(['ok' => true, 'accepted' => $accepted, 'updated_at' => $now]);
}

if ($action === 'view') {
    $sessionId = (string) ($payload['session_id'] ?? '');
    $viewerPassword = (string) ($payload['viewer_password'] ?? '');
    if (!preg_match('/^[a-f0-9]{16}$/', $sessionId) || $viewerPassword === '') {
        json_response(['error' => 'Enter the viewer password.'], 400);
    }
    $sessionStatement = db()->prepare(
        'SELECT title, viewer_password_hash, config_json, updated_at FROM live_sessions WHERE id = :id LIMIT 1'
    );
    $sessionStatement->execute(['id' => $sessionId]);
    $session = $sessionStatement->fetch();
    if (!$session || !password_verify($viewerPassword, (string) $session['viewer_password_hash'])) {
        usleep(250000);
        json_response(['error' => 'That viewer password is not correct.'], 403);
    }
    $sinceId = is_numeric($payload['since_id'] ?? null) ? max(0, (int) $payload['since_id']) : 0;
    if ($sinceId > 0) {
        $readingStatement = db()->prepare(
            'SELECT id, slot, captured_at AS at, pressure, unit
             FROM live_readings WHERE session_id = :session_id AND id > :since_id
             ORDER BY id ASC LIMIT 25001'
        );
        $readingStatement->execute(['session_id' => $sessionId, 'since_id' => $sinceId]);
    } else {
        $cutoff = (int) round((microtime(true) - 36 * 3600) * 1000);
        $readingStatement = db()->prepare(
            'SELECT id, slot, captured_at AS at, pressure, unit
             FROM live_readings WHERE session_id = :session_id AND captured_at > :cutoff
             ORDER BY id ASC LIMIT 25001'
        );
        $readingStatement->execute(['session_id' => $sessionId, 'cutoff' => $cutoff]);
    }
    $readings = $readingStatement->fetchAll();
    $hasMore = count($readings) > 25000;
    if ($hasMore) array_pop($readings);
    $lastId = $sinceId;
    if ($readings) $lastId = (int) $readings[count($readings) - 1]['id'];
    $config = json_decode((string) $session['config_json'], true);
    json_response([
        'title' => (string) $session['title'],
        'updated_at' => (int) $session['updated_at'],
        'server_time' => (int) round(microtime(true) * 1000),
        'config' => is_array($config) ? $config : [],
        'readings' => $readings,
        'last_id' => $lastId,
        'has_more' => $hasMore,
    ]);
}

json_response(['error' => 'Unknown API action.'], 404);
