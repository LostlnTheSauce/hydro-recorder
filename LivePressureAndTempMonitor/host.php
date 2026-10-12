<?php
declare(strict_types=1);
require __DIR__ . '/inc/bootstrap.php';

if (isset($_GET['logout'])) {
    forget_host();
    $_SESSION = [];
    session_destroy();
    header('Location: host.php');
    exit;
}

$loginError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['host_password'])) {
    if (verify_host_password((string) $_POST['host_password'])) {
        session_regenerate_id(true);
        $_SESSION['pressure_host_authenticated'] = true;
        csrf_token();
        remember_host();
        header('Location: host.php');
        exit;
    }
    usleep(300000);
    $loginError = 'That host password is not correct.';
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Field recorder · Grant G Solutions</title>
  <link rel="stylesheet" href="assets/workspace.css?v=1">
  <link rel="stylesheet" href="assets/field-power.css?v=1">
  <link rel="stylesheet" href="assets/temperature-zoom.css?v=2">
  <link rel="stylesheet" href="assets/control-room.css?v=1">
</head>
<body>
<?php if (!is_host_signed_in()): ?>
  <main class="lock-shell">
    <form class="lock-card" method="post" autocomplete="off">
      <div class="brand-mark"><img src="assets/grant-g-logo.png" alt=""></div>
      <p>Grant G Solutions</p>
      <h1>Gauge host sign-in</h1>
      <span>This page controls the laptop’s USB gauge connections.</span>
      <input type="password" name="host_password" placeholder="Host password" required autofocus>
      <button type="submit" class="primary">Sign in</button>
      <?php if ($loginError !== ''): ?><div class="error-box"><?= htmlspecialchars($loginError) ?></div><?php endif; ?>
    </form>
  </main>
<?php else: ?>
  <main class="monitor-shell" id="hostApp" data-api="api.php" data-csrf="<?= htmlspecialchars(csrf_token()) ?>" data-dashboard-view="pressure">
    <header class="app-header">
      <div class="brand-lockup"><div class="brand-mark"><img src="assets/grant-g-logo.png" alt=""></div><div><p>Grant G Solutions</p><h1>Field recorder</h1></div></div>
      <div class="header-actions"><a class="small-link" href="history.php" target="_blank" rel="noopener">Test history &amp; replay ↗</a><a class="small-link demo-launch" href="host.php?demo=1" target="_blank" rel="noopener">Practice demo ↗</a><span class="pill amber" id="remoteHeaderStatus">Remote viewing off</span><a class="small-link" href="?logout=1">Sign out</a></div>
    </header>
    <p id="cloudSaveStatus" role="status">Preparing automatic online history…</p>
    <p id="localSaveAlert" class="save-alert" role="alert" hidden></p>

    <div class="console-layout">
    <aside class="console-sidebar">
      <div class="sidebar-heading"><span>WORKSPACE</span></div>
    <details class="remote-panel" id="remotePanel">
      <summary><span>Remote viewer</span><small><?= htmlspecialchars(base_url()) ?></small></summary>
      <div class="remote-start" id="remoteStart">
        <label>Viewer title<input id="remoteTitle" value="Live pressure tests" maxlength="100"></label>
        <label>Viewer password<input id="viewerPassword" type="password" placeholder="At least 4 characters"></label>
        <button class="primary" id="startRemote" type="button">Start remote viewing</button>
      </div>
      <div class="remote-active hidden" id="remoteActive">
        <div class="remote-link-details"><span>Private viewer link</span><a id="viewerLink" href="#" target="_blank" rel="noreferrer"></a><small>Read-only; chart updates approximately every second.</small></div>
        <div class="remote-link-actions"><button id="copyViewerLink" type="button">Copy link</button><button id="stopRemote" type="button">Stop publishing</button></div>
        <a class="viewer-qr-card" id="viewerQrLink" href="#" target="_blank" rel="noreferrer" aria-label="Open the private remote viewer"><canvas id="viewerQrCode"></canvas><span>Scan with phone</span></a>
      </div>
      <label class="remote-visibility-toggle">
        <input id="viewerShowTemperatures" type="checkbox">
        <span><strong>Show temperatures to viewers</strong><small>Off by default. The host temperature workspace always remains available.</small></span>
      </label>
      <div class="error-box hidden" id="remoteError"></div>
    </details>

    <nav class="dashboard-tabs" aria-label="Host dashboard sections">
      <button class="active" type="button" data-dashboard-tab="pressure"><i>01</i><span><strong>Live test</strong><small>Pressure & field log</small></span></button>
      <button type="button" data-dashboard-tab="temperature"><i>02</i><span><strong>Temperatures</strong><small>Field logger & history</small></span></button>
      <button type="button" data-dashboard-tab="setup"><i>03</i><span><strong>Setup</strong><small>Job, equipment & settings</small></span></button>
      <button type="button" data-dashboard-tab="logs"><i>04</i><span><strong>Records</strong><small>Logbook & Google Sheet</small></span></button>
      <button type="button" data-dashboard-tab="tools"><i>05</i><span><strong>Tools</strong><small>Calculator & reports</small></span></button>
      <button type="button" data-dashboard-tab="sharing"><i>06</i><span><strong>Sharing</strong><small>Read-only viewer link</small></span></button>
    </nav>
    </aside>

    <section class="console-main">
    <div class="workspace-heading">
      <div><span id="workspaceEyebrow">Live operations</span><h2 id="workspaceTitle">Pressure monitoring</h2><p id="workspaceDescription">Connect the gauge, watch the test window, and record the official run.</p></div>
      <div class="field-clock"><span>Local time</span><strong id="fieldClock">--:--:--</strong></div>
    </div>

    <div class="test-bar" id="testBar">
      <div class="test-bar-heading"><span>Active test</span><strong id="activeTestLabel">Test 1</strong></div>
      <nav class="view-controls" aria-label="Active tests">
        <button class="active" type="button" data-layout-mode="A">Test 1</button>
        <button class="second-test-control hidden" type="button" data-layout-mode="B">Test 2</button>
        <button class="second-test-control hidden" type="button" data-layout-mode="both">Both</button>
      </nav>
      <button class="add-test-button" id="addSecondTest" type="button">+ Add second test</button>
      <button class="remove-test-button ghost hidden" id="hideSecondTest" type="button">Hide Test 2</button>
    </div>

    <section class="gauge-grid" id="hostGaugeGrid" data-view-mode="A">
      <?php foreach (['A' => '#d43b3b', 'B' => '#9b3ec2'] as $slot => $color): ?>
      <?php $testNumber = $slot === 'A' ? 1 : 2; ?>
      <article class="gauge-card<?= $slot === 'B' ? ' inactive-test' : '' ?>" data-gauge="<?= $slot ?>" data-color="<?= $color ?>">
        <div class="gauge-toolbar">
          <div><div class="eyebrow">Test <?= $testNumber ?></div><input class="gauge-name" value="Test <?= $testNumber ?>" aria-label="Test <?= $testNumber ?> name"></div>
          <div class="current-readout"><span>Current pressure</span><strong><b class="current-pressure">---.-</b> <small class="current-unit">PSI</small></strong><em class="pressure-trend"></em></div>
          <label class="live-scale-control"><span>Chart maximum</span><strong><input class="live-chart-max" type="number" min="1" step="100" value="1000" inputmode="decimal" aria-label="Live chart maximum pressure"> <small>PSI</small></strong></label>
          <label class="pen-control live-pen-control"><span>Pen size</span><input class="pen-size" type="range" min="0.1" max="5" step="0.1" value="1" aria-label="Pressure trace pen size"><strong>1.0</strong></label>
          <span class="pill connection-status"><i></i> Not connected</span>
        </div>

        <div class="chart-wrap"><canvas class="pressure-chart" width="700" height="700"></canvas></div>
        <div class="pressure-state monitor"><strong>Waiting for gauge</strong><span>Connect by USB or load a demo trace.</span></div>
        <div class="stat-row">
          <div><span>Last update</span><strong class="stat-last">No readings</strong></div>
          <div><span>Peak</span><strong class="stat-peak">—</strong></div>
          <div><span>Lowest</span><strong class="stat-low">—</strong></div>
          <div><span>Readings</span><strong class="stat-count">0</strong></div>
        </div>
        <section class="test-operations" data-test-operations>
          <header class="operations-header">
            <div><span class="eyebrow">Atmos paperwork setup</span><h3>Test <?= $testNumber ?> details</h3></div>
            <span class="pill test-save-status">Saved on this laptop</span>
          </header>
          <section class="test-design-importer" aria-label="Atmos test design PDF import">
            <div class="test-design-import-heading">
              <div><strong>Import Atmos test design</strong><small>Reads the PDF on this laptop, then lets you review every value before applying it.</small></div>
              <div class="test-design-heading-actions"><button class="review-saved-design hidden" type="button">Review saved values</button><label class="test-design-file-button">Choose PDF<input class="test-design-file" type="file" accept="application/pdf,.pdf"></label></div>
            </div>
            <div class="test-design-status" role="status">No test design has been selected.</div>
            <div class="test-design-review hidden">
              <div class="design-review-grid">
                <label>Project name<input data-design-field="projectName" autocomplete="off"></label>
                <label>PO / AFE (project number)<input data-design-field="projectNumber" autocomplete="off"></label>
                <label>Line name<input data-design-field="lineName" autocomplete="off"></label>
                <label>Project location<input data-design-field="projectLocation" autocomplete="off"></label>
                <label>County, state<input data-design-field="countyState" autocomplete="off"></label>
                <label>Beginning GPS<input data-design-field="beginGps" autocomplete="off"></label>
                <label>Ending GPS<input data-design-field="endGps" autocomplete="off"></label>
                <label>Recorder GPS<input data-design-field="recorderGps" autocomplete="off"></label>
                <label>Desired MAOP (psi)<input data-design-field="desiredMaop" inputmode="decimal"></label>
                <label>Recorder minimum (psi)<input data-design-field="windowBottom" inputmode="decimal"></label>
                <label>Recorder maximum (psi)<input data-design-field="windowTop" inputmode="decimal"></label>
                <label>Recorder target (psi)<input data-design-field="targetPressure" inputmode="decimal"></label>
                <label>Test duration (hours)<input data-design-field="testDurationHours" inputmode="decimal"></label>
                <label>Estimated fill (gal)<input data-design-field="estimatedFillGallons" inputmode="decimal"></label>
                <label>Section length (ft)<input data-design-field="sectionLengthFt" inputmode="decimal"></label>
                <label>Test medium<input data-design-field="testMedium" autocomplete="off"></label>
              </div>
              <div class="design-pipe-wrap">
                <div class="design-pipe-heading"><strong>Limiting pipe determination</strong><small>Matching OD, wall and grade are combined and their footage is totaled. Grade is derived from SMYS.</small></div>
                <div class="event-table-wrap"><table class="design-pipe-table"><thead><tr><th>Start</th><th>End</th><th>Length</th><th>OD</th><th>SMYS / Grade</th><th>Wall</th><th>Class</th><th>Yield</th><th>Reassess.</th></tr></thead><tbody></tbody></table></div>
              </div>
              <div class="test-design-review-actions"><button class="primary apply-test-design" type="button">Apply reviewed values</button><button class="ghost close-test-design-review" type="button">Hide review</button></div>
            </div>
          </section>
          <section class="paperwork-sync-panel" aria-label="Google Sheet paperwork">
            <div class="paperwork-sync-heading">
              <div><strong>Google Sheet paperwork</strong><small>Writes adjusted pressure and imports temperatures entered in the copied Sheet. The master template is never changed.</small></div>
              <span class="pill amber sheet-sync-status">Sheet not created</span>
            </div>
            <div class="paperwork-sync-actions">
              <button class="primary create-google-sheet" type="button">Create Google Sheet</button>
              <button class="open-google-sheet" type="button" disabled>Open Google Sheet</button>
              <button class="sync-google-sheet" type="button" disabled>Sync to Sheet</button>
            </div>
            <div class="sheet-sync-message">Manual-only: the site will not update this Sheet until you press Sync to Sheet. Local gauge recording continues independently.</div>
          </section>
          <div class="operations-grid job-fields">
            <label>Job number<input class="job-number" autocomplete="off"></label>
            <label>PO / AFE<input class="po-afe" autocomplete="off"></label>
            <label>Location<input class="job-location" autocomplete="off"></label>
            <label>Owner<input class="asset-owner" value="Atmos Energy" autocomplete="off"></label>
            <label>Contractor<input class="contractor" value="Bobcat Contracting" autocomplete="off"></label>
            <label>Owner's rep / inspector<input class="owner-rep" autocomplete="off"></label>
          </div>
          <div class="operations-grid equipment-fields">
            <label>Deadweight<select class="equipment-select" data-equipment-role="deadweight"></select></label>
            <label>Pressure recorder<select class="equipment-select" data-equipment-role="pressure_recorder"></select></label>
            <label>Digital gauge<select class="equipment-select" data-equipment-role="digital_gauge"></select></label>
            <label>Ambient temperature chart<select class="equipment-select" data-equipment-role="ambient_chart"></select></label>
            <label>Pipe temperature chart<select class="equipment-select" data-equipment-role="pipe_chart"></select></label>
            <label>Ground temperature chart<select class="equipment-select" data-equipment-role="ground_chart"></select></label>
            <label>Pump<select class="equipment-select pump-select" data-equipment-role="pump"></select></label>
            <label>Pressure offset (psi)<input class="pressure-offset" type="number" step="0.1" value="0" inputmode="decimal"><small>One recorded pressure series; applied before display, logging and export.</small></label>
          </div>
          <div class="calibration-summary" aria-live="polite"></div>
          <div class="ramp-panel">
            <h3>Timestamped field entries</h3>
            <div class="ramp-actions">
              <button type="button" class="download-atmos-log">Download Atmos log rows</button>
              <button type="button" class="download-test-backup">Download test backup</button>
              <label class="backup-import-button">Restore backup<input class="restore-test-backup" type="file" accept="application/json,.json"></label>
            </div>
            <div class="event-table-wrap">
              <table class="test-event-table"><thead><tr><th>Time</th><th>Event</th><th>Pressure</th></tr></thead><tbody><tr><td colspan="3" class="event-empty">No pressurization events recorded.</td></tr></tbody></table>
            </div>
          </div>
        </section>
        <section class="temperature-panel" data-temperature-panel>
          <header class="temperature-header">
            <div><span class="eyebrow">Test <?= $testNumber ?></span><h3>Temperature recording</h3><small>Pipe, soil, ambient and extra probe</small></div>
            <span class="pill amber temperature-status">No temperature data</span>
          </header>
          <div class="temperature-current-grid">
            <?php foreach (['ambient' => 'Ambient', 'pipe' => 'Pipe', 'soil' => 'Soil', 'aux' => 'Auxiliary'] as $key => $label): ?>
            <div class="temperature-current inactive" data-temp-current="<?= $key ?>"><span data-temp-label="<?= $key ?>"><?= $label ?></span><strong><b data-temp-value="<?= $key ?>">—</b><small>°F</small></strong></div>
            <?php endforeach; ?>
          </div>
          <details class="temperature-bridge-panel" open>
            <summary><span>Field logger</span><small>Open MadgeTech and the bridge on the field laptop. Start recording here.</small></summary>
            <div class="temperature-bridge-body">
              <label>Field logger<select class="temperature-device-select"><option value="">Waiting for field app…</option></select></label>
              <label class="temperature-interval-control"><span>Website reading interval</span><input class="temperature-sample-interval" type="range" min="2" max="60" step="1" value="2"><strong><b class="temperature-sample-interval-value">2</b> sec</strong></label>
              <label class="temperature-whole-control"><input class="temperature-whole-degrees" type="checkbox"><span><strong>Whole degrees</strong><small>Round website readings to the nearest °F</small></span></label>
              <button class="primary temperature-device-connect" type="button">Start recording temps</button>
              <button class="temperature-device-disconnect" type="button" disabled>Stop recording temps</button>
              <button class="temperature-device-refresh" type="button">Refresh loggers</button>
              <p class="temperature-bridge-status" role="status">Start the field app. Your logger will appear when it is online.</p>
              <p class="temperature-laptop-power" role="status">Field laptop: waiting for battery status.</p>
              <small>Keep MadgeTech and the field app open. Only readings between Start and Stop are recorded here.</small>
              <p class="temperature-connection-error" role="alert" hidden></p>
            </div>
          </details>
          <details class="manual-temperature-panel">
            <summary><span>Enter temperatures manually</span><small>Choose the actual reading time; entries can be corrected or removed.</small></summary>
            <div class="manual-temperature-body">
              <div class="manual-temperature-grid">
                <label>Date &amp; time<input class="manual-temperature-time" type="datetime-local"></label>
                <label>Ambient °F<input class="manual-temperature-ambient" type="number" step="0.1" inputmode="decimal" placeholder="—"></label>
                <label>Pipe °F<input class="manual-temperature-pipe" type="number" step="0.1" inputmode="decimal" placeholder="—"></label>
                <label>Ground °F<input class="manual-temperature-ground" type="number" step="0.1" inputmode="decimal" placeholder="—"></label>
                <button class="primary save-manual-temperature" type="button">Save reading</button>
              </div>
              <div class="manual-temperature-status" role="status">No manual temperature readings saved for this test.</div>
              <div class="manual-temperature-history">
                <table>
                  <thead><tr><th>Date &amp; time</th><th>Ambient</th><th>Pipe</th><th>Ground</th><th></th></tr></thead>
                  <tbody><tr><td colspan="5" class="event-empty">Manual readings will appear here.</td></tr></tbody>
                </table>
              </div>
            </div>
          </details>
          <div class="temperature-controls">
            <div class="temperature-channel-toggles" aria-label="Chart lines">
              <label class="temp-toggle"><input class="temp-pressure-toggle" type="checkbox" value="pressure" checked><i style="--channel-color:#c83d3d"></i><span>Pressure</span></label>
              <?php foreach (['ambient' => ['Ambient', '#3f7fbe'], 'pipe' => ['Pipe', '#e07832'], 'soil' => ['Soil', '#77624c'], 'aux' => ['Auxiliary', '#8a55ae']] as $key => $channel): ?>
              <label class="temp-toggle"><input type="checkbox" value="<?= $key ?>" <?= $key !== 'aux' ? 'checked' : '' ?>><i style="--channel-color:<?= $channel[1] ?>"></i><span data-temp-label="<?= $key ?>"><?= $channel[0] ?></span></label>
              <?php endforeach; ?>
            </div>
            <label>History<select class="temp-history-range"><option value="all">Entire job</option><option value="pretest">Pre-test</option><option value="official">Official test</option><option value="recent">Last 6 hours</option></select></label>
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
        <div class="error-box hidden gauge-error"></div>
        <div class="gauge-actions">
          <button class="primary connect-button" type="button">Connect gauge</button>
          <button class="download-button" type="button" disabled>Download CSV</button>
          <button class="clear-button ghost" type="button" disabled>Clear readings</button>
        </div>
        <details class="settings-panel utility-panel">
          <summary>Import, demo and chart appearance</summary>
          <div class="button-row">
          <button class="demo-button" type="button">Field demo</button>
          <button class="paste-test-button" type="button">Paste old test</button>
          </div>
        </details>

        <details class="settings-panel">
          <summary>Chart scale and warning limits</summary>
          <div class="settings-grid">
            <label>Chart maximum (psi)<input class="chart-max" inputmode="decimal" value="1000"></label>
            <label>Bottom of window (psi)<input class="window-bottom" inputmode="decimal" placeholder="Blank"></label>
            <label>Top of window (psi)<input class="window-top" inputmode="decimal" placeholder="Blank"></label>
            <label>Official test start<input class="test-start" type="datetime-local"></label>
            <label>Official test end<input class="test-end" type="datetime-local"></label>
            <label>Early warning distance (psi)<input class="warning-margin" type="number" min="1" max="100" value="10"></label>
            <label>Test-window line size<div class="settings-range"><input class="window-thickness" type="range" min="0.5" max="5" step="0.5" value="1"><strong>1</strong></div></label>
            <label class="check-field"><input class="show-window" type="checkbox" checked> Show pressure test window</label>
          </div>
        </details>
        <details class="settings-panel temperature-setup-panel">
          <summary>Temperature channel names</summary>
          <div class="settings-grid temperature-name-grid">
            <label>Probe 3 · Ambient<input class="temp-name" data-temp-name="ambient" value="Ambient" maxlength="30"></label>
            <label>Probe 1 · Pipe<input class="temp-name" data-temp-name="pipe" value="Pipe" maxlength="30"></label>
            <label>Probe 2 · Soil<input class="temp-name" data-temp-name="soil" value="Soil" maxlength="30"></label>
            <label>Probe 4<input class="temp-name" data-temp-name="aux" value="Auxiliary" maxlength="30"></label>
          </div>
          <p class="temperature-setup-note">Connect your logger on the Temperatures screen. These labels do not change the physical probe wiring.</p>
        </details>
        <details class="settings-panel paste-test-panel">
          <summary>Paste an old test from Excel or Google Sheets</summary>
          <div class="paste-test-body">
            <div class="paste-test-heading"><label>Test date<input class="paste-test-date" type="date"></label><p>Copy the spreadsheet cells—including the header row—then paste them below. Expected columns are Time, Pressure, Ambient, Pipe, Ground/Soil, and Comments/Remarks.</p></div>
            <textarea class="paste-test-input" rows="9" spellcheck="false" placeholder="Time&#9;Pressure&#9;Ambient&#9;Pipe&#9;Ground&#9;Comments / Remarks&#10;9:30 AM&#9;4160&#9;76&#9;72&#9;83&#9;Begin 8 hour test"></textarea>
            <div class="paste-test-actions"><button class="primary import-paste-button" type="button">Import pasted test</button><button class="bleed-demo-button" type="button">Load bleed-off example</button><button class="ghost paste-clear-button" type="button">Clear pasted text</button></div>
            <div class="paste-test-status hidden"></div>
            <small>Repeated spreadsheet headers are ignored. Tests that pass midnight automatically continue onto the next date.</small>
          </div>
        </details>
      </article>
      <?php endforeach; ?>
    </section>
    <details class="equipment-library" id="equipmentLibrary">
      <summary class="library-summary"><span><b>Equipment library</b><small>Serial numbers, defaults and calibration dates</small></span></summary>
      <p class="library-intro">Defaults are selected automatically for new tests. Calibration warnings stay inside this program and do not alter Atmos paperwork.</p>
      <form class="equipment-form" id="equipmentForm">
        <input id="equipmentEditId" type="hidden">
        <label>Type<select id="equipmentType">
          <option value="deadweight">Deadweight</option>
          <option value="digital_gauge">Digital gauge</option>
          <option value="pressure_recorder">Pressure recorder</option>
          <option value="ambient_chart">Ambient temperature chart</option>
          <option value="pipe_chart">Pipe temperature chart</option>
          <option value="ground_chart">Ground temperature chart</option>
          <option value="pump">Pump</option>
        </select></label>
        <label>Name<input id="equipmentName" required autocomplete="off" placeholder="Example: PDQ Pump"></label>
        <label>Serial number<input id="equipmentSerial" autocomplete="off"></label>
        <label>Manufacturer<input id="equipmentManufacturer" autocomplete="off"></label>
        <label>Range<input id="equipmentRange" autocomplete="off" placeholder="Example: 0–5000 psi"></label>
        <label>Calibration date<input id="equipmentCalibration" type="date"></label>
        <label>Calibration interval (months)<input id="equipmentInterval" type="number" min="1" max="60" value="6"></label>
        <label>Pump capacity (gal/stroke)<input id="equipmentCapacity" type="number" min="0" step="0.0001"></label>
        <label class="check-field"><input id="equipmentDefault" type="checkbox"> Use as default for this type</label>
        <div class="equipment-form-actions"><button class="primary" id="saveEquipment" type="submit">Add equipment</button><button class="ghost hidden" id="cancelEquipmentEdit" type="button">Cancel</button></div>
      </form>
      <div class="equipment-table-wrap"><table><thead><tr><th>Type</th><th>Name / serial</th><th>Range or capacity</th><th>Calibration</th><th>Default</th><th></th></tr></thead><tbody id="equipmentTableBody"></tbody></table></div>
    </details>
    <section class="tools-workspace" data-tool-section="tools">
      <nav class="tool-tabs" aria-label="Hydrotest tools">
        <button class="active" type="button" data-tool-tab="calculator">Calculator</button>
        <button type="button" data-tool-tab="reports">Recorder report</button>
      </nav>
      <div class="tool-frame-section" data-tool-frame="calculator"><iframe src="calculator.html" title="Hydrotest calculator"></iframe></div>
      <div class="tool-frame-section hidden" data-tool-frame="reports"><iframe src="recorder-report.html" title="Pressure recorder report"></iframe></div>
    </section>
    <details class="event-notes" open>
      <summary><span>Test notes</span><small>Choose the event time and share it with remote viewers</small></summary>
      <form class="note-entry-form" id="hostNoteForm">
        <div class="note-entry-grid">
          <label>Test<select id="hostNoteTest"><option value="A">Test 1</option><option value="B">Test 2</option></select></label>
          <label>Event date<input id="hostNoteDate" type="date"></label>
          <label>Event time<input id="hostNoteTime" type="time" step="60"></label>
          <button id="hostNoteUseNow" type="button">Use current time</button>
          <label class="note-text-field">Note<input id="hostNoteText" maxlength="500" placeholder="Example: Swapped pumps or bled pressure due to temperature" autocomplete="off"></label>
          <button class="primary" type="submit">Add note</button>
        </div>
      </form>
      <div class="event-note-list" id="hostNotesList"><p class="note-empty">No notes have been added.</p></div>
      <div class="note-footer"><span>Notes remain on this laptop until cleared.</span><button class="ghost" id="clearHostNotes" type="button" disabled>Clear notes</button></div>
    </details>
    <details class="pressure-log">
      <summary><span>Detailed pressure history</span><small id="hostLogDescription">Every 15 seconds • newest recording first • chart continues recording every second</small></summary>
      <div class="log-interval-controls" aria-label="Host pressure log interval">
        <span>Show recordings every</span>
        <button class="active" type="button" data-host-log-interval="15000">15 sec</button>
        <button type="button" data-host-log-interval="60000">1 min</button>
        <button type="button" data-host-log-interval="300000">5 min</button>
        <button type="button" data-host-log-interval="900000">15 min</button>
      </div>
      <div class="log-table-wrap">
        <table><thead><tr><th>Date</th><th>Time</th><th>Test 1</th><th>Test 2</th></tr></thead><tbody id="hostPressureLog"><tr><td class="log-empty" colspan="4">Pressure readings will appear here as the tests record.</td></tr></tbody></table>
      </div>
    </details>
    <footer><span>XP2i / XP3i compatible • 9600 baud • one-second local and remote chart readings</span><span>The selected pressure offset is applied before display, logging and export.</span></footer>
    </section>
    </div>
  </main>
  <script src="assets/chart.js?v=13"></script>
<script src="assets/temperature.js?v=25"></script>
  <script src="assets/qrcode.js?v=7"></script>
  <script src="assets/test-design-parser.js?v=4"></script>
  <script src="assets/test-design.js?v=2"></script>
  <script src="assets/workflow.js?v=3"></script>
  <script src="assets/demo.js?v=2"></script>
  <script src="assets/jobs.js?v=2"></script>
  <script src="assets/cloud-history.js?v=2"></script>
  <script src="assets/workflow-ui.js?v=7"></script>
  <script src="assets/workspace.js?v=2"></script>
  <script src="assets/field-power.js?v=1"></script>
  <script src="assets/host.js?v=45"></script>
<?php endif; ?>
</body>
</html>
