<?php
declare(strict_types=1);
require __DIR__ . '/../inc/viewer-title.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('CREATE TABLE live_sessions (id CHAR(16) PRIMARY KEY, title VARCHAR(100))');
$db->exec("INSERT INTO live_sessions (id, title) VALUES ('0123456789abcdef', 'Alanreed to Merten hydrotest'), ('fedcba9876543210', 'Private job name')");
check(viewer_title_get($db, '0123456789abcdef') === null, 'Nothing shared yet');
viewer_title_set($db, '0123456789abcdef', 'Alanreed to Merten hydrotest', 1);
check(viewer_title_get($db, '0123456789abcdef') === 'Alanreed to Merten hydrotest', 'Shared title readable');
viewer_title_set($db, '0123456789abcdef', 'Renamed test', 2);
check(viewer_title_get($db, '0123456789abcdef') === 'Renamed test', 'Re-sharing updates the title');
check(viewer_title_get($db, 'fedcba9876543210') === null, 'A session never shared (private) shows nothing');
viewer_title_clear($db, '0123456789abcdef');
check(viewer_title_get($db, '0123456789abcdef') === null, 'Stopping sharing hides the title');
viewer_title_set($db, '0123456789abcdef', 'Back on', 3);
$db->exec("DELETE FROM live_sessions WHERE id = '0123456789abcdef'");
check(viewer_title_get($db, '0123456789abcdef') === null, 'Expired session shows nothing');
check(viewer_title_get($db, "x' OR 1=1 --") === null && viewer_title_get($db, '') === null, 'Bad IDs refused');
echo "Viewer title: only while shared, updated on re-share, hidden after stop, private and expired sessions show nothing, bad IDs refused passed.\n";
