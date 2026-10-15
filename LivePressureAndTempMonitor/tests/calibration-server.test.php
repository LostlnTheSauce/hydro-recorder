<?php
declare(strict_types=1);
require __DIR__ . '/../inc/calibration.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function rejects(callable $f, string $message): void { try { $f(); } catch (InvalidArgumentException $e) { return; } throw new RuntimeException($message); }
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
calibration_schema($db); calibration_schema($db);
$pdf = "%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n" . random_bytes(64);
$jpeg = "\xFF\xD8\xFF\xE0" . random_bytes(200);
$png = "\x89PNG\r\n\x1A\n" . random_bytes(50);
$saved = calibration_save($db, 'deadweight-5496', 'C:\\scans\\Deadweight 5496 cert.pdf', $pdf, 1000);
check($saved['mime'] === 'application/pdf' && $saved['file_name'] === 'Deadweight 5496 cert.pdf' && $saved['size'] === strlen($pdf), 'PDF saved with clean name');
check(calibration_save($db, 'b30e1fc4-763e-4c99-bd32-5138a91a082e', 'photo.heic.jpg', $jpeg, 2000)['mime'] === 'image/jpeg', 'JPEG by content');
check(calibration_save($db, 'pump-pdq', '', $png, 3000)['file_name'] === 'calibration.png', 'Blank name gets a default');
check(calibration_get($db, 'deadweight-5496')['data'] === $pdf, 'Bytes come back unchanged');
// A new paper replaces the old one for that equipment.
calibration_save($db, 'deadweight-5496', "new\x07 cert\".pdf", $pdf . 'v2', 4000);
$list = calibration_list($db);
check(count($list) === 3, 'One paper per equipment');
$dw = array_values(array_filter($list, fn ($r) => $r['equipment_id'] === 'deadweight-5496'))[0];
check($dw['file_name'] === 'new cert.pdf' && $dw['uploaded_at'] === 4000 && !isset($dw['data']), 'Replaced; list has no file bytes');
check(calibration_get($db, 'deadweight-5496')['data'] === $pdf . 'v2', 'Newest bytes');
rejects(fn () => calibration_save($db, 'x', 'a.exe', "MZ\x90\x00", 1), 'Executable refused');
rejects(fn () => calibration_save($db, 'x', 'page.html', '<html>%PDF-', 1), 'HTML refused even with PDF marker inside');
rejects(fn () => calibration_save($db, 'x', 'a.pdf', '', 1), 'Empty refused');
rejects(fn () => calibration_save($db, '../etc/passwd', 'a.pdf', $pdf, 1), 'Bad ID refused');
rejects(fn () => calibration_save($db, ['a'], 'a.pdf', $pdf, 1), 'Non-string ID refused');
rejects(fn () => calibration_save($db, 'big', 'a.pdf', '%PDF-' . str_repeat('a', CALIBRATION_MAX_BYTES), 1), 'Over 8 MB refused');
rejects(fn () => calibration_get($db, 'a b'), 'Bad ID on read refused');
check(calibration_get($db, 'missing') === null, 'Missing paper is null');
check(calibration_delete($db, 'pump-pdq') && !calibration_delete($db, 'pump-pdq'), 'Delete once');
check(count(calibration_list($db)) === 2, 'Deleted paper gone');
check(calibration_limit() > 0 && calibration_limit() <= CALIBRATION_MAX_BYTES, 'Limit within the cap');
// Shared equipment list: newest save wins, fields cleaned, bad entries refused.
equipment_schema($db); equipment_schema($db);
check(equipment_get($db) === ['updatedAt' => 0, 'items' => []], 'Empty list before the first save');
$items = [['id' => 'pump-pdq', 'type' => 'pump', 'name' => "PDQ\tPump", 'capacity' => '0.0043', 'isDefault' => true, 'extra' => 'dropped'],
    ['id' => 'b30e1fc4-763e-4c99-bd32-5138a91a082e', 'type' => 'deadweight', 'name' => 'T1 Deadweights', 'serial' => '5496', 'calibrationDate' => '2026-05-07', 'intervalMonths' => 6]];
$saved = equipment_save($db, $items, 5000);
check($saved['updatedAt'] === 5000 && count($saved['items']) === 2, 'First save stored');
check($saved['items'][0]['name'] === 'PDQ Pump' && !isset($saved['items'][0]['extra']) && $saved['items'][0]['isDefault'] === true, 'Cleaned');
check($saved['items'][1]['calibrationDate'] === '2026-05-07' && $saved['items'][1]['intervalMonths'] === 6, 'Dates kept');
check(equipment_save($db, [], 4000)['updatedAt'] === 5000 && count(equipment_get($db)['items']) === 2, 'Older copy does not overwrite');
check(count(equipment_save($db, [$items[1]], 6000)['items']) === 1, 'Newer copy (with a removal) wins');
rejects(fn () => equipment_save($db, [['id' => 'x', 'type' => 'rocket', 'name' => 'a']], 7000), 'Unknown type refused');
rejects(fn () => equipment_save($db, [['id' => '../x', 'type' => 'pump']], 7000), 'Bad ID refused');
rejects(fn () => equipment_save($db, ['a' => []], 7000), 'Not a list refused');
rejects(fn () => equipment_save($db, [], 'soon'), 'Bad time refused');
check(equipment_get($db)['updatedAt'] === 6000, 'Refusals change nothing');
echo "Calibration papers: PDF/JPEG/PNG by content, clean names, one per equipment (replace), list without bytes, refusals, delete passed.\n";
