/* The host's presentation layer. Recording and workflow engines stay independent
   of navigation; changing a screen never starts or stops a device. */
(function () {
  'use strict';
  let gauges = [];
  function navigate(view) {
    document.querySelector(`[data-dashboard-tab="${view}"]`)?.click();
  }
  function openSection(node, title) {
    if (!node) return;
    node.open = true;
    node.classList.add('always-open');
    const summary = node.querySelector(':scope > summary');
    if (summary) {
      const heading = document.createElement('h3');
      heading.textContent = title || summary.querySelector('span')?.textContent || summary.textContent;
      summary.after(heading);
      summary.hidden = true;
      node.addEventListener('toggle', () => { if (!node.open) node.open = true; });
    }
  }
  function render() {
    const app = document.getElementById('hostApp'), view = app.dataset.dashboardView;
    app.querySelectorAll('[data-workspace-panel]').forEach(node => {
      node.hidden = node.dataset.workspacePanel !== view;
    });
    app.querySelectorAll('[data-dashboard-tab]').forEach(button => {
      button.setAttribute('aria-current', button.dataset.dashboardTab === view ? 'page' : 'false');
    });
    document.getElementById('testBar').hidden = ['tools', 'sharing'].includes(view);
    document.getElementById('hostGaugeGrid').hidden = ['tools', 'sharing'].includes(view);
    requestAnimationFrame(() => gauges.forEach(g => { g.draw(); g.drawTemperature(); }));
  }
  function attach(items) {
    gauges = items;
    const app = document.getElementById('hostApp');
    for (const gauge of gauges) {
      const root = gauge.root;
      const panels = {};
      for (const view of ['pressure', 'temperature', 'setup', 'logs']) {
        const panel = document.createElement('section');
        panel.dataset.workspacePanel = view;
        panel.className = `workspace-page page-${view}`;
        root.append(panel); panels[view] = panel;
      }
      const move = (selector, view) => root.querySelectorAll(selector).forEach(node => panels[view].append(node));
      const toolbar = root.querySelector('.gauge-toolbar');
      const side = document.createElement('div'); side.className = 'readout-side';
      side.append(toolbar.querySelector('.connection-status'), root.querySelector('.gauge-actions'), root.querySelector('.rate-target-control'));
      toolbar.append(side, root.querySelector('.pressure-state'));
      move('.demo-pressure-panel', 'pressure');
      move('.workflow-card', 'pressure');
      const deck = document.createElement('section'); deck.className = 'pressure-deck';
      const heading = document.createElement('header'); heading.className = 'chart-heading';
      heading.innerHTML = '<h3>Recorder chart</h3>';
      const controls = document.createElement('div'); controls.className = 'chart-controls';
      controls.append(root.querySelector('.live-scale-control'), root.querySelector('.live-pen-control'), root.querySelector('.live-window-control'));
      heading.append(controls);
      deck.append(heading, root.querySelector('.chart-wrap'), root.querySelector('.stat-row'));
      const notes = panels.pressure.querySelector('.workflow-card');
      panels.pressure.insertBefore(deck, notes);
      move('.temperature-panel', 'temperature');
      const temperature = root.querySelector('.temperature-panel');
      temperature.querySelector('.temperature-header').after(temperature.querySelector('.temperature-bridge-panel'));
      temperature.append(temperature.querySelector('.manual-temperature-panel'));
      openSection(root.querySelector('.temperature-bridge-panel'), 'Connect & record');
      const temperatureBody = document.createElement('div'); temperatureBody.className = 'controlroom-temperature-body';
      const temperatureChart = document.createElement('div'); temperatureChart.className = 'controlroom-temperature-chart';
      const devices = document.createElement('aside'); devices.className = 'controlroom-devices';
      devices.append(temperature.querySelector('.temperature-bridge-panel'));
      const probes = temperature.querySelector('.enabled-probes'); if (probes) devices.append(probes);
      for (const node of [...temperature.children]) {
        if (node.matches('.temperature-controls,.temp-zoom-controls,.temp-chart-expand,.temperature-canvas-wrap,.temperature-inspector')) temperatureChart.append(node);
      }
      temperatureBody.append(temperatureChart, devices);
      temperature.querySelector('.manual-temperature-panel').before(temperatureBody);
      const expand = temperatureChart.querySelector('.temp-chart-expand');
      if (expand) temperatureChart.querySelector('.temperature-controls').append(expand);
      move('.test-operations', 'setup');
      move('.workflow-config', 'setup');
      move('.settings-panel', 'setup');
      panels.setup.querySelectorAll('details').forEach(node => openSection(node));
      const finish = document.createElement('section'); finish.className = 'finish-test settings-panel';
      finish.innerHTML = '<h3>Finish test</h3><p><b>Start new test</b> saves this job to history and clears the screen for the next one.</p><div class="finish-actions"></div>';
      finish.querySelector('.finish-actions').append(root.querySelector('[data-act="new-job"]'));
      panels.setup.append(finish);
      move('.workflow-records', 'logs');
      const records = root.querySelector('.workflow-records');
      records.querySelector('a[href="history.php"]')?.closest('p')?.remove();
      const downloads = records.querySelector('.workflow-record-actions');
      const ramp = records.querySelector('.ramp-panel');
      ramp.querySelectorAll('.ramp-actions > *').forEach(node => downloads.append(node));
      ramp.querySelector('.ramp-actions').remove();
      ramp.querySelector('h3').textContent = 'Field log';
      records.querySelector('.event-table-wrap').after(records.querySelector('.paperwork-sync-panel'), downloads, ramp);
      const more = document.createElement('div'); more.className = 'records-more';
      records.querySelectorAll(':scope > details').forEach(node => more.append(node));
      records.append(more);
    }
    const main = app.querySelector('.console-main');
    const remote = document.getElementById('remotePanel'); main.append(remote);
    remote.dataset.workspacePanel = 'sharing'; openSection(remote, 'Share a read-only view');
    const library = document.getElementById('equipmentLibrary');
    library.dataset.workspacePanel = 'setup';
    app.querySelector('.tools-workspace').dataset.workspacePanel = 'tools';
    const practice = document.createElement('p'); practice.className = 'practice-sharing-note'; practice.dataset.workspacePanel = 'sharing';
    practice.textContent = 'Sharing is turned off in the practice demo.';
    main.append(practice);
    app.querySelectorAll('[data-dashboard-tab]').forEach(button => button.addEventListener('click', render));
    render();
  }
  window.HydroWorkspace = { attach, navigate, render };
})();
