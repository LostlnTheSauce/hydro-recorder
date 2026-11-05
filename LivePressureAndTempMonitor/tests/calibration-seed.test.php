<?php
// One-time setup of the MadgeTech field logger (S/N T88206) and its certificate in the shared
// equipment list: never on an empty list, never twice, no duplicate logger, keeps the rest.
declare(strict_types=1);
require __DIR__ . '/../inc/calibration.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$fresh = function (): PDO { $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); calibration_schema($db); equipment_schema($db); return $db; };
$dw = ['id' => 'deadweight-5496', 'type' => 'deadweight', 'name' => 'Deadweight', 'serial' => '5496'];

$db = $fresh();
check(calibration_seed_defaults($db, 10000) === false, 'Nothing shared yet: wait (would replace the laptop list)');
check(equipment_get($db)['items'] === [] && calibration_list($db) === [], 'Empty list left alone');

equipment_save($db, [$dw], 20000);
check(calibration_seed_defaults($db, 15000) === true, 'Seeds once a list is shared');
$list = equipment_get($db);
check(count($list['items']) === 2 && $list['items'][0]['id'] === 'deadweight-5496', 'Rest of the library kept');
$logger = $list['items'][1];
check($logger['type'] === 'temperature_logger' && $logger['serial'] === 'T88206' && $logger['manufacturer'] === 'MadgeTech' && $logger['calibrationDate'] === '2026-08-28' && $logger['intervalMonths'] === 6 && $logger['isDefault'] === true, 'Logger from the certificate');
check($list['updatedAt'] === 20001, 'Newer than the laptop list so the laptop adopts it');
$paper = calibration_get($db, $logger['id']);
check($paper !== null && $paper['mime'] === 'image/jpeg' && strlen((string) $paper['data']) > 100000, 'Certificate stored for the logger');
check(calibration_seed_defaults($db, 30000) === false, 'Never twice');
// Removed later by the user: stays removed.
equipment_save($db, [$dw], 40000);
check(calibration_seed_defaults($db, 50000) === false && count(equipment_get($db)['items']) === 1, 'A removal is respected');

// Logger already added by hand (another id) without a certificate: only the certificate is added.
$db = $fresh();
equipment_save($db, [$dw, ['id' => 'temperature-logger-t88206-abc', 'type' => 'temperature_logger', 'name' => 'RTDTempX4', 'serial' => 't88206']], 20000);
check(calibration_seed_defaults($db, 25000) === true, 'Seeds the certificate');
check(count(equipment_get($db)['items']) === 2 && equipment_get($db)['updatedAt'] === 20000, 'No duplicate logger, list unchanged');
check(calibration_get($db, 'temperature-logger-t88206-abc') !== null, 'Certificate on the existing logger');

// That logger already has a certificate: kept as it is.
$db = $fresh();
equipment_save($db, [['id' => 'lg', 'type' => 'temperature_logger', 'name' => 'RTDTempX4', 'serial' => 'T88206']], 20000);
calibration_save($db, 'lg', 'mine.pdf', "%PDF-1.4\n%%EOF\n", 21000);
calibration_seed_defaults($db, 25000);
check(calibration_get($db, 'lg')['file_name'] === 'mine.pdf', 'An existing certificate is not replaced');
echo "Calibration seed: waits for a shared list, adds the T88206 logger and certificate once, keeps the library, no duplicates, respects removals and existing papers passed.\n";
