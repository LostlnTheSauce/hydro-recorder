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
      move('.demo-pressure-panel', 'pressure');
      move('.workflow-card', 'pressure');
      const deck = document.createElement('section'); deck.className = 'pressure-deck';
      const heading = document.createElement('header'); heading.className = 'chart-heading';
      heading.innerHTML = '<div><span class="eyebrow">LIVE PRESSURE</span><h3>Recorder chart</h3></div>';
      heading.append(root.querySelector('.gauge-actions'));
      deck.append(heading);
      const controls = document.createElement('div'); controls.className = 'chart-controls';
      controls.append(root.querySelector('.live-scale-control'), root.querySelector('.live-pen-control'));
      deck.append(controls, root.querySelector('.chart-wrap'), root.querySelector('.pressure-state'), root.querySelector('.stat-row'));
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
        if (node.matches('.temperature-controls,.temp-zoom-controls,.temp-chart-expand,.temperature-canvas-wrap,.temperature-analysis,.temperature-inspector')) temperatureChart.append(node);
      }
      temperatureBody.append(temperatureChart, devices);
      temperature.querySelector('.manual-temperature-panel').before(temperatureBody);
      const expand = temperatureChart.querySelector('.temp-chart-expand');
      if (expand) temperatureChart.querySelector('.temperature-controls').append(expand);
      move('.test-operations', 'setup');
      move('.workflow-config', 'setup');
      move('.settings-panel:not(.utility-panel):not(.paste-test-panel)', 'setup');
      move('.workflow-restart', 'setup');
      panels.setup.querySelectorAll('details').forEach(node => openSection(node));
      move('.workflow-records', 'logs');
      move('.utility-panel,.paste-test-panel', 'logs');
      // A single new-job action lives with job setup, not beside routine hold buttons.
      panels.setup.prepend(root.querySelector('[data-act="new-job"]'));
      const feedback = document.createElement('p'); feedback.className = 'setup-message'; feedback.setAttribute('role', 'status'); feedback.hidden = true;
      panels.setup.prepend(feedback);
      root.querySelector('.paste-test-button').addEventListener('click', () => navigate('logs'));
      const records = root.querySelector('.workflow-records');
      records.querySelector('header').after(records.querySelector('.paperwork-sync-panel'));
      root.querySelectorAll('.utility-panel summary').forEach(node => { node.textContent = 'Import a previous test'; });
      // Old in-place demo buttons remain wired for compatibility but are not entry points.
      root.querySelectorAll('.demo-button,.bleed-demo-button,.clear-button').forEach(node => { node.hidden = true; });
    }
    const main = app.querySelector('.console-main');
    const remote = document.getElementById('remotePanel'); main.append(remote);
    remote.dataset.workspacePanel = 'sharing'; openSection(remote, 'Share a read-only view');
    const library = document.getElementById('equipmentLibrary');
    library.dataset.workspacePanel = 'setup'; openSection(library, 'Equipment library');
    app.querySelector('.tools-workspace').dataset.workspacePanel = 'tools';
    app.querySelector('.event-notes').dataset.workspacePanel = 'logs';
    openSection(app.querySelector('.event-notes'), 'Timestamped notes');
    app.querySelector('.pressure-log').dataset.workspacePanel = 'logs';
    app.querySelectorAll('[data-dashboard-tab]').forEach(button => button.addEventListener('click', render));
    render();
  }
  window.HydroWorkspace = { attach, navigate, render };
})();
