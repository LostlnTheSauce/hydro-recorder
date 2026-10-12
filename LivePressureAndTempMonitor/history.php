<?php
declare(strict_types=1);
require __DIR__ . '/inc/bootstrap.php';
$loginError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['host_password'])) {
    if (verify_host_password((string) $_POST['host_password'])) {
        session_regenerate_id(true); $_SESSION['pressure_host_authenticated'] = true; remember_host();
        header('Location: history.php'); exit;
    }
    usleep(300000); $loginError = 'That host password is not correct.';
}
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test history · Grant G Solutions</title>
<link rel="stylesheet" href="assets/workspace.css?v=1"><link rel="stylesheet" href="assets/temperature-zoom.css?v=2"><link rel="stylesheet" href="assets/history.css?v=3"><link rel="stylesheet" href="assets/control-room.css?v=5"></head><body>
<?php if (!is_host_signed_in()): ?>
<main class="login-shell"><form method="post" class="login-card"><h1>Test history</h1><p>Sign in with your host password to view tests from any device.</p><input name="host_password" type="password" placeholder="Host password" required autofocus><button class="primary">Sign in</button><p><?= htmlspecialchars($loginError) ?></p><small>This device stays signed in. Sign out when using a shared device.</small></form></main>
<?php else: ?>
<main id="historyApp" data-csrf="<?= htmlspecialchars(csrf_token()) ?>"><header class="app-header"><div class="brand-lockup"><span class="brand-mark"><img src="assets/grant-g-logo.png" alt=""></span><div><p>Grant G Solutions</p><h1>Field recorder</h1></div></div><nav class="header-actions" aria-label="Main navigation"><a href="host.php">Live recorder</a><a href="history.php" aria-current="page">Test history</a><a href="host.php?logout=1">Sign out</a></nav></header>
<p id="historyStatus" role="status">Loading saved tests…</p>
<section id="historyLibrary"><header class="library-heading"><div><span class="eyebrow">YOUR RECORDINGS</span><h2>Test history</h2><p>Every recording. Available wherever you are.</p></div><button id="refreshHistory" type="button">Refresh</button></header>
<div class="history-toolbar library-filters"><label>Find a test<input id="historySearch" type="search" placeholder="Search test names…"></label><label>Folder<select id="historyFolder"><option value="all">All tests</option><option value="unfiled">Unfiled</option><option value="trash">Trash</option></select></label></div>
<section id="historyList" aria-label="Saved tests"></section></section>
<section id="replay" hidden><button id="closeReplay" type="button" class="back-link">← All tests</button><header class="replay-heading"><div><span id="replayFolder" class="eyebrow"></span><h2 id="replayTitle"></h2><p id="replaySummary"></p></div><div class="replay-actions" id="replayActions"><button type="button" data-manage="rename">Rename</button><button type="button" data-manage="move">Move</button><button id="downloadReplay" type="button" class="primary">Export backup</button><button type="button" data-manage="trash" class="history-delete">Delete</button><button type="button" data-manage="restore" hidden>Restore</button></div></header>
<nav class="history-view-tabs" aria-label="Saved test sections"><button type="button" data-history-view="graph" aria-current="page">Graph &amp; replay</button><button type="button" data-history-view="log" aria-current="false">Pressure &amp; temperature log</button><button type="button" data-history-view="events" aria-current="false">Events &amp; notes</button></nav>
<div class="replay-layout" data-history-section="graph">
<div class="temperature-panel" data-temperature-panel>
<div class="temperature-controls"><div class="temperature-channel-toggles" aria-label="Chart lines">
<label class="temp-toggle"><input class="temp-pressure-toggle" type="checkbox" value="pressure" checked><i style="--channel-color:#c83d3d"></i>Pressure</label>
<?php foreach (['ambient' => ['Ambient', '#3f7fbe'], 'pipe' => ['Pipe', '#e07832'], 'soil' => ['Soil', '#77624c'], 'aux' => ['Auxiliary', '#8a55ae']] as $key => $channel): ?>
<label class="temp-toggle"><input type="checkbox" value="<?= $key ?>" <?= $key !== 'aux' ? 'checked' : '' ?>><i style="--channel-color:<?= $channel[1] ?>"></i><span data-temp-label="<?= $key ?>"><?= $channel[0] ?></span></label>
<?php endforeach; ?></div>
<label>Replay period<select class="temp-history-range"><option value="all">Entire recording</option><option value="official">Official test</option><option value="pretest">Pre-test</option></select></label><label><input class="temp-show-notes" type="checkbox" checked>Show events</label></div>
<div class="temperature-canvas-wrap"><canvas class="temperature-chart"></canvas><canvas class="temperature-selection-overlay" aria-hidden="true"></canvas><div class="temperature-tooltip hidden"></div></div>
<div class="temperature-inspector"><div class="history-toolbar"><button id="playReplay" type="button">▶ Play</button><label>Speed<select id="replaySpeed"><option value="60">1 minute / sec</option><option value="600" selected>10 minutes / sec</option><option value="3600">1 hour / sec</option></select></label><span id="replayClock"></span></div>
<div class="temperature-scrubber-controls"><time class="temp-scrubber-start"></time><input class="temp-scrubber" type="range" min="0" max="10000" step="1" value="0" aria-label="Scrub through the recorded test"><time class="temp-scrubber-end"></time></div>
<div class="temperature-inspector-readout"><div><span>Selected time</span><strong class="temp-inspector-time"></strong></div><div><span>Pressure</span><strong class="temp-inspector-pressure"></strong></div>
<?php foreach (['ambient' => 'Ambient', 'pipe' => 'Pipe', 'soil' => 'Soil', 'aux' => 'Auxiliary'] as $key => $label): ?>
<div><span data-temp-label="<?= $key ?>"><?= $label ?></span><strong data-temp-inspector-value="<?= $key ?>"></strong></div>
<?php endforeach; ?></div></div></div>
<aside class="replay-notes"><span class="eyebrow">RECORDING DETAILS</span><h3>Job &amp; notes</h3><p id="jobDetails"></p><ol id="replayHighlights"></ol><small>Saved snapshot · Viewing does not affect a live recording.</small></aside></div>
<section id="historyReadingLog" class="history-reading-log" data-history-section="log" hidden aria-labelledby="readingLogTitle"><header><span class="eyebrow">RECORDED MEASUREMENTS</span><h3 id="readingLogTitle">Pressure &amp; temperature log</h3></header>
<div class="history-log-controls"><label>Reading interval<select id="historyLogInterval"><option value="1000">1 second</option><option value="5000">5 seconds</option><option value="15000">15 seconds</option><option value="30000">30 seconds</option><option value="60000">1 minute</option><option value="300000">5 minutes</option><option value="600000">10 minutes</option><option value="900000" selected>15 minutes</option><option value="1800000">30 minutes</option><option value="3600000">1 hour</option></select></label><label>Log period<select id="historyLogPeriod"><option value="all">Entire recording</option><option value="official">Official test</option><option value="pretest">Pre-test</option></select></label><fieldset><legend>Show temperatures</legend><label><input type="checkbox" data-log-probe="pipe" checked>Pipe</label><label><input type="checkbox" data-log-probe="ambient" checked>Ambient</label><label><input type="checkbox" data-log-probe="soil" checked>Soil</label><label><input type="checkbox" data-log-probe="aux">Auxiliary</label></fieldset></div>
<p class="history-log-help">Pressure is rounded to whole PSI. Rows use the nearest recorded readings, not averages. A dash means no nearby reading; hover or tap a value to see its recorded time. Probe choices also apply to the graph and are remembered for this test on this browser.</p>
<p id="historyLogSummary" role="status"></p><div class="history-log-table-wrap" tabindex="0" role="region" aria-label="Pressure and temperature readings"><table id="historyLogTable"><thead></thead><tbody></tbody></table></div>
<div class="history-log-pagination"><button type="button" id="historyLogPrevious">← Previous</button><span id="historyLogPage"></span><button type="button" id="historyLogNext">Next →</button></div></section>
<section class="replay-event-log" data-history-section="events" hidden><h3>Complete event log</h3><div class="event-table-wrap"><table><thead><tr><th>Actual time</th><th>Event / note</th><th>Pressure PSI</th><th>Entry details</th></tr></thead><tbody id="replayEvents"></tbody></table></div></section>
</section>
<dialog id="historyEdit" aria-labelledby="historyEditTitle" aria-describedby="historyEditHelp"><form id="historyEditForm"><span class="eyebrow">MANAGE RECORDING</span><h2 id="historyEditTitle"></h2><p id="historyEditHelp"></p><label id="historyEditField"><span id="historyEditLabel"></span><input id="historyEditValue" maxlength="200" autocomplete="off"><datalist id="historyFolderNames"></datalist></label><p id="historyEditError" role="alert"></p><div class="dialog-actions"><button type="button" id="historyEditCancel">Cancel</button><button type="submit" id="historyEditSave" class="primary">Save</button></div></form></dialog>
</main><script src="assets/temperature.js?v=26"></script><script src="assets/history-log.js?v=1"></script><script src="assets/history.js?v=4"></script>
<?php endif; ?></body></html>
