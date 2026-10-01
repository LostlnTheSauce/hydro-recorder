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
        CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, rev INTEGER NOT NULL, meta TEXT, updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS readings (token TEXT NOT NULL, at INTEGER NOT NULL, psi REAL NOT NULL, PRIMARY KEY (token, at)) WITHOUT ROWID;');
    return $db;
}

function valid_token($token): bool
{
    return is_string($token) && preg_match('/^[A-Za-z0-9_-]{20,40}$/', $token) === 1;
}

// Only the first recorder to connect may publish here; its key is remembered from then on.
function require_recorder(PDO $db, array $body): void
{
    $key = $body['key'] ?? '';
    if (!is_string($key) || !preg_match('/^[a-f0-9]{64}$/', $key)) out(['error' => 'This recorder is not set up for sharing.'], 400);
    $saved = $db->query("SELECT value FROM kv WHERE key='recorder'")->fetchColumn();
    if ($saved === false) {
        $db->prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('recorder', ?)")->execute([hash('sha256', $key)]);
        $saved = $db->query("SELECT value FROM kv WHERE key='recorder'")->fetchColumn();
    }
    if (!hash_equals((string) $saved, hash('sha256', $key))) out(['error' => 'This website is already paired with a different recorder.'], 403);
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
        out(['rev' => $rev, 'fresh' => $since === 0, 'meta' => json_decode($share['meta'], true), 'points' => thin($points),
            'updated' => (int) $share['updated'], 'now' => now_ms()]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['error' => 'Not found.'], 404);
    $body = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($body)) out(['error' => 'That request could not be read.'], 400);
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
