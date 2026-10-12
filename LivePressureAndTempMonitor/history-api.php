<?php
declare(strict_types=1);
require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/job-history.php';
require_host();
try {
    $db = db(); history_schema($db);
    $action = (string) ($_GET['action'] ?? 'list');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_csrf();
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 3000000) json_response(['error' => 'Upload batch too large.'], 413);
        $p = json_input();
        session_write_close();
        $result = in_array($action, ['rename', 'move', 'trash', 'restore'], true) ? history_manage($db, $action, $p) : history_write($db, $action, $p);
        json_response(['ok' => true] + $result);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_response(['error' => 'Unsupported request.'], 405);
    session_write_close();
    if ($action === 'list') {
        json_response(['ok' => true, 'jobs' => history_list($db)]);
    }
    $id = history_id($_GET['id'] ?? null); $job = history_get($db, $id);
    if (!$job || (int) $job['revision'] === 0) json_response(['error' => 'Test not found.'], 404);
    if ($action === 'read') json_response(['ok' => true, 'metadata' => json_decode($job['metadata_json'], true), 'manifest' => json_decode($job['manifest_json'], true), 'updatedAt' => (int) $job['updated_at']]);
    if ($action === 'chunk') {
        $hash = (string) ($_GET['hash'] ?? '');
        // Chunks remain immutable so a replay opened during an upload stays consistent.
        $q = $db->prepare('SELECT data_json FROM hydro_job_chunks WHERE job_id = ? AND hash = ?'); $q->execute([$id, $hash]);
        $data = $q->fetchColumn();
        if ($data === false) json_response(['error' => 'Reading batch not found.'], 404);
        json_response(['ok' => true, 'data' => $data]);
    }
    json_response(['error' => 'Unknown history action.'], 400);
} catch (InvalidArgumentException $e) { json_response(['error' => $e->getMessage()], 400); }
catch (PDOException $e) { error_log('Hydro history database: ' . $e->getMessage()); json_response(['error' => 'Online history is unavailable. The local copy is retained and will retry.'], 503); }
catch (Throwable $e) { json_response(['error' => $e->getMessage()], 409); }
