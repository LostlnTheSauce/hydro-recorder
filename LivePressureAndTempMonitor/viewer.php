<?php
declare(strict_types=1);
$sessionId = strtolower((string) ($_GET['id'] ?? ''));
$validId = preg_match('/^[a-f0-9]{16}$/', $sessionId) === 1;
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Live test viewer · Grant G Solutions</title>
  <link rel="stylesheet" href="assets/workspace.css?v=1">
  <link rel="stylesheet" href="assets/viewer-workspace.css?v=1">
  <link rel="stylesheet" href="assets/temperature-zoom.css?v=2">
  <link rel="stylesheet" href="assets/control-room.css?v=1">
</head>
<body>
<?php if (!$validId): ?>
  <main class="lock-shell"><section class="lock-card"><div class="brand-mark"><img src="assets/grant-g-logo.png" alt=""></div><p>Grant G Solutions</p><h1>Invalid viewer link</h1><span>Ask the test operator for the complete live-view link.</span></section></main>
<?php else: ?>
  <main id="viewerApp" data-api="api.php" data-session-id="<?= htmlspecialchars($sessionId) ?>">
    <section class="lock-shell" id="viewerLock">
      <form class="lock-card" id="viewerLogin">
        <div class="brand-mark"><img src="assets/grant-g-logo.png" alt=""></div><p>Grant G Solutions</p><h1>Private live pressure test</h1><span>Enter the password provided by the test operator.</span>
        <input id="viewerLoginPassword" type="password" placeholder="Viewer password" required autofocus>
        <button type="submit" class="primary">View live charts</button>
        <div class="error-box hidden" id="viewerLoginError"></div>
      </form>
    </section>

    <div class="monitor-shell hidden" id="viewerDashboard" data-dashboard-view="pressure">
      <header class="app-header">
        <div class="brand-lockup"><div class="brand-mark"><img src="assets/grant-g-logo.png" alt=""></div><div><p>Grant G Solutions · Live field feed</p><h1 id="viewerTitle">Live pressure tests</h1></div></div>
        <div class="header-actions"><span class="pill" id="feedStatus">Connecting…</span><span class="pill">Read-only viewer</span></div>
      </header>
      <div class="error-box hidden" id="viewerFeedError"></div>
      <nav class="dashboard-tabs" aria-label="Viewer dashboard sections">
        <button class="active" type="button" data-dashboard-tab="pressure"><span><strong>Live pressure</strong><small>Current test feed</small></span></button>
        <button type="button" data-dashboard-tab="temperature"><span><strong>Temperatures</strong><small>Pressure correlation</small></span></button>
        <button type="button" data-dashboard-tab="logs"><span><strong>Logbook</strong><small>Notes + readings</small></span></button>
      </nav>
      <nav class="view-controls" aria-label="Chart layout">
        <span>Test</span>
        <button class="active" type="button" data-layout-mode="A">Test 1</button>
        <button class="second-test-control hidden" type="button" data-layout-mode="B">Test 2</button>
        <button class="second-test-control hidden" type="button" data-layout-mode="both">Both</button>
      </nav>
      <section class="gauge-grid" id="viewerGaugeGrid" data-view-mode="A">
        <?php foreach (['A', 'B'] as $slot): ?>
        <?php $testNumber = $slot === 'A' ? 1 : 2; ?>
        <article class="gauge-card remote-gauge<?= $slot === 'B' ? ' inactive-test' : '' ?>" data-view-gauge="<?= $slot ?>">
          <div class="gauge-toolbar"><div><div class="eyebrow">Test <?= $testNumber ?></div><h2 class="viewer-gauge-name">Test <?= $testNumber ?></h2></div><div class="current-readout"><span>Current pressure</span><strong><b class="current-pressure">---.-</b> <small class="current-unit">PSI</small></strong></div></div>
          <div class="chart-wrap"><canvas class="pressure-chart" width="700" height="700"></canvas></div>
          <div class="stat-row"><div><span>Last update</span><strong class="stat-last">No readings</strong></div><div><span>Peak</span><strong class="stat-peak">—</strong></div><div><span>Lowest</span><strong class="stat-low">—</strong></div><div><span>Pressure recordings</span><strong class="stat-count">0</strong></div></div>
          <section class="temperature-panel" data-temperature-panel>
            <header class="temperature-header"><div><span class="eyebrow">Live temperatures</span><h3>Pressure &amp; temperature</h3><small>Four probe inputs assigned to Test <?= $testNumber ?></small></div><span class="pill amber temperature-status">No temperature data</span></header>
            <div class="temperature-current-grid">
              <?php foreach (['ambient' => 'Ambient', 'pipe' => 'Pipe', 'soil' => 'Soil', 'aux' => 'Auxiliary'] as $key => $label): ?>
              <div class="temperature-current inactive" data-temp-current="<?= $key ?>"><span data-temp-label="<?= $key ?>"><?= $label ?></span><strong><b data-temp-value="<?= $key ?>">—</b><small>°F</small></strong></div>
              <?php endforeach; ?>
            </div>
            <div class="temperature-controls">
              <div class="temperature-channel-toggles" aria-label="Chart lines">
                <label class="temp-toggle"><input class="temp-pressure-toggle" type="checkbox" value="pressure" checked><i style="--channel-color:#c83d3d"></i><span>Pressure</span></label>
                <?php foreach (['ambient' => ['Ambient', '#3f7fbe'], 'pipe' => ['Pipe', '#e07832'], 'soil' => ['Soil', '#77624c'], 'aux' => ['Auxiliary', '#8a55ae']] as $key => $channel): ?>
                <label class="temp-toggle"><input type="checkbox" value="<?= $key ?>" <?= $key !== 'aux' ? 'checked' : '' ?>><i style="--channel-color:<?= $channel[1] ?>"></i><span data-temp-label="<?= $key ?>"><?= $channel[0] ?></span></label>
                <?php endforeach; ?>
              </div>
              <label class="temperature-official-toggle"><input class="temp-official-only" type="checkbox" checked> Official test only</label>
              <label class="temperature-notes-toggle"><input class="temp-show-notes" type="checkbox"> Show notes</label>
            </div>
            <div class="temperature-canvas-wrap"><canvas class="temperature-chart" width="900" height="330"></canvas><canvas class="temperature-selection-overlay" width="900" height="330" aria-hidden="true"></canvas><div class="temperature-tooltip hidden"></div></div>
            <div class="temperature-analysis">
              <div><span>Pressure change</span><strong class="temp-pressure-change">—</strong></div>
              <div><span><b class="temp-analysis-name">Pipe</b> change</span><strong class="temp-temperature-change">—</strong></div>
            </div>
            <div class="temperature-inspector">
              <div class="temperature-inspector-readout">
                <div class="inspector-time"><span>Selected time</span><strong class="temp-inspector-time">Live</strong></div>
                <div><span>Pressure</span><strong class="temp-inspector-pressure">—</strong></div>
                <?php foreach (['ambient' => 'Ambient', 'pipe' => 'Pipe', 'soil' => 'Soil', 'aux' => 'Auxiliary'] as $key => $label): ?>
                <div><span data-temp-label="<?= $key ?>"><?= $label ?></span><strong data-temp-inspector-value="<?= $key ?>">—</strong></div>
                <?php endforeach; ?>
              </div>
              <div class="temperature-scrubber-controls">
                <time class="temp-scrubber-start">—</time>
                <input class="temp-scrubber" type="range" min="0" max="1000" step="1" value="1000" aria-label="Select a time on the temperature graph">
                <time class="temp-scrubber-end">Live</time>
                <button class="temp-return-live" type="button" disabled>Return to live</button>
              </div>
            </div>
          </section>
        </article>
        <?php endforeach; ?>
      </section>
      <details class="event-notes" open>
        <summary><span>Test notes</span><small>Updates entered by the test operator</small></summary>
        <div class="event-note-list" id="viewerNotesList"><p class="note-empty">No notes have been added.</p></div>
      </details>
      <details class="pressure-log" open>
        <summary><span>Pressure &amp; temperature log</span><small id="viewerLogDescription">Latest value in each 15-second interval · newest first · latest 2,000 rows · missing values stay blank</small></summary>
        <div class="log-interval-controls" aria-label="Viewer pressure log interval">
          <span>Show recordings every</span>
          <button class="active" type="button" data-viewer-log-interval="15000">15 sec</button>
          <button type="button" data-viewer-log-interval="60000">1 min</button>
          <button type="button" data-viewer-log-interval="300000">5 min</button>
          <button type="button" data-viewer-log-interval="900000">15 min</button>
        </div>
        <div class="log-table-wrap">
          <table><thead><tr><th>Date</th><th>Time</th><th>Test 1</th><th>Test 2</th></tr></thead><tbody id="viewerPressureLog"><tr><td class="log-empty" colspan="4">Waiting for pressure readings.</td></tr></tbody></table>
        </div>
      </details>
      <footer><span>Remote chart updates approximately every second.</span><span>Displayed pressure includes the offset selected on the host laptop.</span></footer>
    </div>
  </main>
  <script src="assets/chart.js?v=13"></script>
<script src="assets/temperature.js?v=25"></script>
  <script src="assets/jobs.js?v=1"></script>
  <script src="assets/viewer.js?v=22"></script>
<?php endif; ?>
</body>
</html>
