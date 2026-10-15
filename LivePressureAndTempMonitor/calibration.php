<?php
declare(strict_types=1);
require __DIR__ . '/inc/bootstrap.php';
$loginError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['host_password'])) {
    if (verify_host_password((string) $_POST['host_password'])) {
        session_regenerate_id(true); $_SESSION['pressure_host_authenticated'] = true; remember_host();
        header('Location: calibration.php'); exit;
    }
    usleep(300000); $loginError = 'That host password is not correct.';
}
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Calibration papers · Grant G Solutions</title>
<link rel="stylesheet" href="assets/workspace.css?v=1"><link rel="stylesheet" href="assets/history.css?v=3"><link rel="stylesheet" href="assets/control-room.css?v=5"></head><body>
<?php if (!is_host_signed_in()): ?>
<main class="login-shell"><form method="post" class="login-card"><h1>Calibration papers</h1><p>Sign in with your host password to scan calibration papers.</p><input name="host_password" type="password" placeholder="Host password" required autofocus><button class="primary">Sign in</button><p><?= htmlspecialchars($loginError) ?></p><small>This device stays signed in. Sign out when using a shared device.</small></form></main>
<?php else: ?>
<main id="calibrationApp" data-csrf="<?= htmlspecialchars(csrf_token()) ?>"><header class="app-header"><div class="brand-lockup"><span class="brand-mark"><img src="assets/grant-g-logo.png" alt=""></span><div><p>Grant G Solutions</p><h1>Field recorder</h1></div></div><nav class="header-actions" aria-label="Main navigation"><a href="host.php">Live recorder</a><a href="history.php">Test history</a><a href="calibration.php" aria-current="page">Calibration papers</a><a href="host.php?logout=1">Sign out</a></nav></header>
<section class="cal-page"><header class="library-heading"><div><span class="eyebrow">EQUIPMENT</span><h2>Calibration papers</h2><p>Tap <b>Scan</b> and take a picture of each page. The pages are saved together as one PDF for that piece of equipment.</p></div><button id="calRefresh" type="button">Refresh</button></header>
<p id="calStatus" role="status">Loading equipment…</p>
<div id="calList" class="cal-list"></div></section>
<dialog id="calScanner" class="cal-scanner" aria-labelledby="calScanTitle"><div class="cal-scan-inner">
  <header><span class="eyebrow">SCAN CALIBRATION PAPER</span><h2 id="calScanTitle"></h2><p id="calScanSub"></p></header>
  <div id="calPages" class="cal-pages"></div>
  <label class="button-link primary cal-take"><input id="calCamera" type="file" accept="image/*" capture="environment" hidden><span id="calTakeLabel">Take picture of page 1</span></label>
  <label class="button-link cal-take-library"><input id="calLibrary" type="file" accept="image/*" multiple hidden>Choose from photos</label>
  <label class="check-field"><input id="calScanLook" type="checkbox" checked> Black &amp; white scan look</label>
  <p class="cal-tip">Lay the paper flat in good light and fill the screen with the page.</p>
  <p id="calScanMessage" class="cal-scan-message" role="status"></p>
  <div class="dialog-actions"><button type="button" id="calCancel">Cancel</button><button type="button" id="calSave" class="primary" disabled>Save</button></div>
</div></dialog>
<input id="calFile" type="file" accept="application/pdf,image/*" hidden>
</main>
<script src="assets/calibration-papers.js?v=1"></script>
<script src="assets/calibration-scan.js?v=1"></script>
<?php endif; ?>
</body></html>
