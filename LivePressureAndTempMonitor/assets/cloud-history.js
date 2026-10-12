(function () {
  'use strict';
  const encoder = new TextEncoder();
  async function hash(text) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function request(action, payload) {
    const csrf = document.getElementById('hostApp')?.dataset.csrf;
    const response = await fetch(`history-api.php?action=${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(45000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 403 ? 'Sign in again in another tab; local recording continues. Uploads will retry.' : result.error || 'Upload failed.');
    return result;
  }
  async function upload(record) {
    const id = record.id, key = `grantg-cloud-writer-${id}`;
    let writer = localStorage.getItem(key);
    if (!writer) {
      writer = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, writer);
    }
    const claim = await request('claim', { id, writer });
    const known = new Set(Object.values(claim.manifest || {}).flat());
    const manifest = { readings: [], temperatureReadings: [] };
    for (const kind of Object.keys(manifest)) {
      const rows = record[kind] || [];
      for (let i = 0; i < rows.length; i += 2000) {
        const data = JSON.stringify(rows.slice(i, i + 2000)), checksum = await hash(data);
        manifest[kind].push(checksum);
        if (!known.has(checksum)) await request('chunk', { id, writer, hash: checksum, data });
      }
    }
    const { readings, temperatureReadings, localRevision, cloudSyncedRevision, ...metadata } = record;
    await request('commit', { id, writer, revision: claim.revision, manifest, metadata });
    await HydroJobs.markSynced(id, record.localRevision);
  }
  let gauges = [], snapshot, busy = false, queued = false, timer, leader = false;
  function status(text, error = false) {
    const element = document.getElementById('cloudSaveStatus');
    if (element) { element.textContent = text; element.classList.toggle('amber', error); }
  }
  async function cycle() {
    if (!leader || busy || window.HydroDemo?.enabled) return;
    busy = true; queued = false;
    try {
      for (const gauge of gauges) {
        if (gauge.jobTransition || gauge.restoringBackup || gauge.importingDesign || !gauge.checkJobCurrent()) continue;
        const record = await snapshot(gauge);
        if (!record) continue;
        const previous = await HydroJobs.get(record.id);
        // Live logger history may still be reloading after a page refresh.
        const live = new Map((previous?.temperatureReadings || []).filter(r => r.source === 'live').map(r => [`${r.sourceId || ''}:${r.at}`, r]));
        record.temperatureReadings.filter(r => r.source === 'live').forEach(r => live.set(`${r.sourceId || ''}:${r.at}`, r));
        record.temperatureReadings = [...live.values(), ...record.temperatureReadings.filter(r => r.source !== 'live')].sort((a,b) => a.at-b.at);
        await HydroJobs.save(record);
      }
      const pending = await HydroJobs.pending();
      if (!pending.length) { status('Online history ready'); return; }
      status('Saving online…');
      const failed = [];
      for (const summary of pending) {
        try {
          let record = await HydroJobs.get(summary.id);
          if (!record.localRevision) { await HydroJobs.save(record); record = await HydroJobs.get(summary.id); }
          await upload(record);
        }
        catch (e) { failed.push(e.message); if (!navigator.onLine) break; }
      }
      if (failed.length) throw new Error(failed[0]);
      status(`Saved online · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    } catch (e) { status(`Online save pending · keep this laptop’s data. ${e.message}`, true); }
    finally { busy = false; if (queued) schedule(); }
  }
  function schedule() {
    if (!leader) return;
    if (busy) { queued = true; return; }
    clearTimeout(timer); timer = setTimeout(cycle, 1500);
  }
  window.HydroCloud = {
    schedule,
    attach(items, makeSnapshot) {
      if (window.HydroDemo?.enabled) return;
      gauges = items; snapshot = makeSnapshot;
      const start = () => { leader = true; schedule(); window.addEventListener('online', schedule); return setInterval(cycle, 30000); };
      if (navigator.locks) {
        status('Online saves will run in one host tab. Keep the recording tab open.');
        navigator.locks.request('grantg-cloud-history-uploader', async () => {
          const interval = start();
          // The browser releases this leadership lock when the tab closes.
          await new Promise(resolve => {
            const changedJob = event => {
              if (event.key?.startsWith('grantg-hydro-test-v1-') && gauges.some(g => !g.checkJobCurrent())) {
                window.removeEventListener('storage', changedJob); resolve();
              }
            };
            window.addEventListener('storage', changedJob);
          });
          leader = false; clearInterval(interval); clearTimeout(timer);
          window.removeEventListener('online', schedule);
          status('Online saving moved to the current host tab.');
        });
      } else start();
    },
  };
})();
