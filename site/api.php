<?php
// Live viewing for Hydro Recorder. The trailer computer pushes readings here; viewers read them.
declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-store');

const DAY_MS = 86400000;
const MAX_POINTS = 6000;

function out(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

function store(): PDO
{
    // Keep the database outside the public web folder where the host allows it.
    $web = strpos(__DIR__, '/public_html');
    $dir = $web === false ? __DIR__ . '/data' : substr(__DIR__, 0, $web) . '/hydro-live-data';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    if (!is_file("$dir/.htaccess")) file_put_contents("$dir/.htaccess", "Require all denied\n");
    $db = new PDO("sqlite:$dir/live.db", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    $db->exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS recorders (key_hash TEXT PRIMARY KEY, paired INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, rev INTEGER NOT NULL, meta TEXT, updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS readings (token TEXT NOT NULL, at INTEGER NOT NULL, psi REAL NOT NULL, PRIMARY KEY (token, at)) WITHOUT ROWID;');
    return $db;
}

function valid_token($token): bool
{
    return is_string($token) && preg_match('/^[A-Za-z0-9_-]{20,40}$/', $token) === 1;
}

function recorder_key(array $body): string
{
    $key = $body['key'] ?? '';
    if (!is_string($key) || !preg_match('/^[a-f0-9]{64}$/', $key)) out(['error' => 'This recorder is not set up for sharing.'], 400);
    return hash('sha256', $key);
}

function host_password(PDO $db)
{
    return $db->query("SELECT value FROM kv WHERE key='host_password'")->fetchColumn();
}

// A computer may publish once someone has typed the host password on it.
function require_recorder(PDO $db, array $body): void
{
    $known = $db->prepare('SELECT 1 FROM recorders WHERE key_hash = ?');
    $known->execute([recorder_key($body)]);
    if (!$known->fetchColumn()) {
        out(['error' => 'Enter the host password to let this computer share.', 'pair' => true, 'fresh' => host_password($db) === false], 403);
    }
}

// The first password anyone sets becomes the host password; after that it must match.
function pair_recorder(PDO $db, array $body): void
{
    $hash = recorder_key($body);
    $password = $body['password'] ?? '';
    if (!is_string($password) || strlen($password) < 6) out(['error' => 'The host password needs at least 6 characters.', 'pair' => true], 400);
    $saved = host_password($db);
    if ($saved === false) {
        $db->prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('host_password', ?)")->execute([password_hash($password, PASSWORD_DEFAULT)]);
        $saved = host_password($db);
    }
    if (!password_verify($password, (string) $saved)) {
        usleep(700000);
        out(['error' => 'That host password is not correct.', 'pair' => true], 403);
    }
    $db->prepare('INSERT OR IGNORE INTO recorders (key_hash, paired) VALUES (?, ?)')->execute([$hash, now_ms()]);
    out(['ok' => true]);
}

const STEPS = [15, 60, 300, 600];
const SCREEN_ROWS = 240;

// Rows for a viewer who picked a finer step than the 15-minute record. Same rule as the recorder:
// a row stays blank unless a reading sits within half a step of it.
function rows_for(PDO $db, string $token, array $meta, int $step): array
{
    $span = $db->prepare('SELECT MIN(at) AS first, MAX(at) AS last FROM readings WHERE token = ?');
    $span->execute([$token]);
    $have = $span->fetch();
    if ($have['first'] === null) return [];
    $ms = $step * 1000;
    $start = (int) ($meta['official_start'] ?? 0) ?: (int) (ceil($have['first'] / $ms) * $ms);
    $stop = min((int) ($meta['official_end'] ?? 0) ?: PHP_INT_MAX, (int) $have['last']);
    if ($stop < $start) return [];
    $count = intdiv($stop - $start, $ms) + 1;
    $near = (int) min(30000, $ms / 2);
    $find = $db->prepare('SELECT psi FROM readings WHERE token = ? AND at BETWEEN ? AND ? ORDER BY ABS(at - ?) LIMIT 1');
    $rows = [];
    for ($i = max(0, $count - SCREEN_ROWS); $i < $count; $i++) {
        $at = $start + $i * $ms;
        $find->execute([$token, $at - $near, $at + $near, $at]);
        $psi = $find->fetchColumn();
        $rows[] = ['at' => $at, 'pressure' => $psi === false ? null : round((float) $psi, 1), 'remark' => $psi === false ? 'no gauge reading' : ''];
    }
    return $rows;
}

// Keep each bucket's low and high so a short spike still shows on a thinned trace.
function thin(array $rows): array
{
    if (count($rows) <= MAX_POINTS) return $rows;
    $size = (int) ceil(count($rows) / (MAX_POINTS / 2));
    $result = [];
    foreach (array_chunk($rows, $size) as $bucket) {
        $low = $high = $bucket[0];
        foreach ($bucket as $row) {
            if ($row[1] < $low[1]) $low = $row;
            if ($row[1] > $high[1]) $high = $row;
        }
        if ($low[0] === $high[0]) $result[] = $low;
        elseif ($low[0] < $high[0]) array_push($result, $low, $high);
        else array_push($result, $high, $low);
    }
    return $result;
}

try {
    $action = $_GET['a'] ?? '';
    $db = store();

    if ($action === 'view') {
        $token = $_GET['t'] ?? '';
        if (!valid_token($token)) out(['error' => 'This link is not valid.'], 404);
        $find = $db->prepare('SELECT rev, meta, updated FROM shares WHERE token = ?');
        $find->execute([$token]);
        $share = $find->fetch();
        if (!$share || $share['meta'] === null) out(['error' => 'This test is no longer being shared.'], 404);
        $rev = (int) $share['rev'];
        $since = (int) ($_GET['rev'] ?? 0) === $rev ? max(0, (int) ($_GET['since'] ?? 0)) : 0;
        $last = $db->prepare('SELECT MAX(at) FROM readings WHERE token = ?');
        $last->execute([$token]);
        $floor = max($since, (int) $last->fetchColumn() - DAY_MS);
        $query = $db->prepare('SELECT at, psi FROM readings WHERE token = ? AND at > ? ORDER BY at');
        $query->execute([$token, $floor]);
        $points = array_map(fn($r) => [(int) $r['at'], (float) $r['psi']], $query->fetchAll());
        $meta = json_decode($share['meta'], true);
        $step = (int) ($_GET['step'] ?? 900);
        out(['rev' => $rev, 'fresh' => $since === 0, 'meta' => $meta, 'points' => thin($points),
            'rows' => in_array($step, STEPS, true) ? rows_for($db, $token, $meta, $step) : null,
            'updated' => (int) $share['updated'], 'now' => now_ms()]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['error' => 'Not found.'], 404);
    $body = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($body)) out(['error' => 'That request could not be read.'], 400);
    if ($action === 'pair') pair_recorder($db, $body);
    require_recorder($db, $body);
    $token = $body['token'] ?? '';
    if (!valid_token($token)) out(['error' => 'Invalid share link.'], 400);

    if ($action === 'stop') {
        $db->prepare('DELETE FROM readings WHERE token = ?')->execute([$token]);
        $db->prepare('DELETE FROM shares WHERE token = ?')->execute([$token]);
        out(['ok' => true]);
    }

    if ($action === 'push') {
        $rev = (int) ($body['rev'] ?? 1);
        $readings = is_array($body['readings'] ?? null) ? array_slice($body['readings'], 0, 5000) : [];
        $db->beginTransaction();
        $find = $db->prepare('SELECT rev FROM shares WHERE token = ?');
        $find->execute([$token]);
        $saved = $find->fetchColumn();
        if ($saved === false) {
            $db->prepare('INSERT INTO shares (token, rev, updated) VALUES (?, ?, ?)')->execute([$token, $rev, now_ms()]);
        } elseif ((int) $saved !== $rev) {
            // The offset changed on the recorder: every pressure is different, so start the trace over.
            $db->prepare('DELETE FROM readings WHERE token = ?')->execute([$token]);
            $readings = [];
        }
        $insert = $db->prepare('INSERT OR REPLACE INTO readings (token, at, psi) VALUES (?, ?, ?)');
        foreach ($readings as $reading) {
            if (is_array($reading) && is_numeric($reading[0] ?? null) && is_numeric($reading[1] ?? null)) {
                $insert->execute([$token, (int) $reading[0], (float) $reading[1]]);
            }
        }
        if (is_array($body['meta'] ?? null)) {
            $db->prepare('UPDATE shares SET meta = ? WHERE token = ?')->execute([json_encode($body['meta']), $token]);
        }
        $db->prepare('UPDATE shares SET rev = ?, updated = ? WHERE token = ?')->execute([$rev, now_ms(), $token]);
        $db->commit();

        if (random_int(1, 200) === 1) {
            $old = now_ms() - 30 * DAY_MS;
            $db->exec("DELETE FROM readings WHERE token IN (SELECT token FROM shares WHERE updated < $old)");
            $db->exec("DELETE FROM shares WHERE updated < $old");
        }
        $state = $db->prepare('SELECT (SELECT MAX(at) FROM readings WHERE token = :t) AS last, meta IS NOT NULL AS has_meta FROM shares WHERE token = :t');
        $state->execute(['t' => $token]);
        $row = $state->fetch();
        out(['ok' => true, 'last' => (int) $row['last'], 'has_meta' => (bool) $row['has_meta']]);
    }

    out(['error' => 'Not found.'], 404);
} catch (Throwable $e) {
    error_log('hydro live: ' . $e->getMessage());
    out(['error' => 'The live-viewing site hit a problem. Try again in a moment.'], 500);
}
