<?php
declare(strict_types=1);
require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/calibration.php';
require_host();
try {
    $db = db(); calibration_schema($db); equipment_schema($db);
    $action = (string) ($_GET['action'] ?? 'list');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_csrf();
        if ($action === 'upload') {
            // The file is the raw request body (not a form upload), so only post_max_size applies.
            $limit = calibration_limit();
            if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) json_response(['error' => sprintf('The file is larger than this server accepts (%.1f MB). Scan it at a lower resolution and try again.', $limit / 1000000)], 413);
            $bytes = (string) file_get_contents('php://input', false, null, 0, CALIBRATION_MAX_BYTES + 1);
            session_write_close();
            $paper = calibration_save($db, $_SERVER['HTTP_X_EQUIPMENT_ID'] ?? null, rawurldecode((string) ($_SERVER['HTTP_X_FILE_NAME'] ?? '')), $bytes);
            unset($paper['sha256']);
            json_response(['ok' => true, 'paper' => $paper]);
        }
        if ($action === 'equipment') {
            if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 500000) json_response(['error' => 'Equipment list too large.'], 413);
            $p = json_input();
            session_write_close();
            json_response(['ok' => true] + equipment_save($db, $p['items'] ?? null, $p['savedAt'] ?? null));
        }
        if ($action === 'delete') {
            $p = json_input();
            session_write_close();
            json_response(['ok' => true, 'deleted' => calibration_delete($db, $p['equipment'] ?? null)]);
        }
        json_response(['error' => 'Unknown calibration action.'], 400);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_response(['error' => 'Unsupported request.'], 405);
    session_write_close();
    if ($action === 'list') json_response(['ok' => true, 'papers' => calibration_list($db), 'maxBytes' => calibration_limit(), 'equipment' => equipment_get($db)]);
    if ($action === 'file') {
        $paper = calibration_get($db, $_GET['equipment'] ?? null);
        if (!$paper) json_response(['error' => 'No calibration paper for that equipment.'], 404);
        header('Content-Type: ' . $paper['mime']);
        header('Content-Length: ' . strlen((string) $paper['data']));
        header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode((string) $paper['file_name']));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        echo $paper['data'];
        exit;
    }
    json_response(['error' => 'Unknown calibration action.'], 400);
} catch (InvalidArgumentException $e) { json_response(['error' => $e->getMessage()], 400); }
catch (PDOException $e) {
    error_log('Hydro calibration database: ' . $e->getMessage());
    json_response(['error' => 'Calibration papers are unavailable right now. Try again in a moment.'], 503);
}
catch (Throwable $e) { json_response(['error' => $e->getMessage()], 409); }
