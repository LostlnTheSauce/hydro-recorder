<?php
declare(strict_types=1);
// Feed check storage: per-minute laptop check-ins (with first-use table creation)
// and per-minute readings with late arrivals, against an in-memory database.
require __DIR__.'/../inc/feed-check.php';
$fixture = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
function db(): PDO { return $GLOBALS['fixture']; }
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$fixture->exec('CREATE TABLE temperature_sources (id TEXT PRIMARY KEY,session_id TEXT,slot TEXT,serial TEXT,token_hash TEXT,active INTEGER,sample_interval_seconds INTEGER,whole_degrees INTEGER,created_at INTEGER);
CREATE TABLE temperature_device_runs (source_id TEXT PRIMARY KEY,device_id TEXT,stopped_at INTEGER);
CREATE TABLE temperature_readings (id INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT,session_id TEXT,slot TEXT,captured_at INTEGER,received_at INTEGER,pipe REAL,soil REAL,ambient REAL,aux REAL,UNIQUE(source_id,captured_at));');
$session = str_repeat('a', 16); $source = str_repeat('b', 16); $device = str_repeat('c', 16);
$start = 1790000000000 - 1790000000000 % 60000; // a minute boundary
$fixture->prepare('INSERT INTO temperature_sources VALUES (?,?,?,?,?,?,?,?,?)')->execute([$source, $session, 'A', 'T1', '', 1, 2, 0, $start]);
$fixture->prepare('INSERT INTO temperature_device_runs VALUES (?,?,?)')->execute([$source, $device, null]);

// Before any check-in the table does not exist: the check still answers.
$empty = feed_check($session, 'A', $start + 600000);
check($empty['checkins'] === [] && $empty['checkins_since'] === null && $empty['recordings'][0]['interval_seconds'] === 2, 'works before the check-in table exists');

// Minute 0: on time. Minute 1: arrived 10 minutes late. Minute 2: nothing.
$insert = $fixture->prepare('INSERT INTO temperature_readings (source_id,session_id,slot,captured_at,received_at,pipe) VALUES (?,?,?,?,?,70)');
for ($s = 0; $s < 60; $s += 2) $insert->execute([$source, $session, 'A', $start + $s * 1000, $start + $s * 1000 + 3000]);
for ($s = 60; $s < 120; $s += 2) $insert->execute([$source, $session, 'A', $start + $s * 1000, $start + 720000]);
// Check-ins: minute 0 twelve with MadgeTech ready, minute 2 twelve without, temperatures kept as the hottest.
for ($i = 0; $i < 12; $i++) save_field_checkin($device, true, $i === 3 ? 151 : 120, $start + $i * 5000);
for ($i = 0; $i < 12; $i++) save_field_checkin($device, false, $i === 0 ? 'hot' : null, $start + 120000 + $i * 5000);
$result = feed_check($session, 'A', $start + 600000);
check($result['minutes'] === [['at' => $start, 'readings' => 30, 'late' => 0], ['at' => $start + 60000, 'readings' => 30, 'late' => 30]], 'readings per minute with late arrivals');
check($result['checkins'] === [
    ['at' => $start, 'checkins' => 12, 'ready' => 12, 'laptop_temp_f' => 151],
    ['at' => $start + 120000, 'checkins' => 12, 'ready' => 0, 'laptop_temp_f' => null],
], 'check-ins per minute: count, MadgeTech ready and hottest laptop temperature');
check($result['checkins_since'] === $start, 'first logged check-in');
check(feed_check($session, 'B', $start)['recordings'] === [], 'other test is separate');
// An earlier job's stopped recording is left out; a running one starts at the job start.
$older = str_repeat('d', 16);
$fixture->prepare('INSERT INTO temperature_sources VALUES (?,?,?,?,?,?,?,?,?)')->execute([$older, $session, 'A', 'T1', '', 0, 2, 0, $start - 86400000]);
$fixture->prepare('INSERT INTO temperature_device_runs VALUES (?,?,?)')->execute([$older, $device, $start - 80000000]);
check(count(feed_check($session, 'A', $start + 600000)['recordings']) === 2, 'all recordings without a job start');
$job = feed_check($session, 'A', $start + 600000, $start + 30000);
check(count($job['recordings']) === 1 && $job['recordings'][0]['from'] === $start + 30000, 'current job only, from its start');
// Rows older than 30 days are pruned when a new minute starts.
save_field_checkin($device, true, null, $start + 31 * 86400000);
check(count(feed_check($session, 'A', $start)['checkins']) === 1, 'old check-ins pruned');
echo "Feed check storage passed: works before first check-in, readings per minute with late arrivals, check-ins with MadgeTech state and laptop temperature, separate tests, pruning.\n";
