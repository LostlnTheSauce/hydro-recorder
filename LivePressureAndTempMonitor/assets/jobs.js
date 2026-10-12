(function (root) {
  'use strict';
  let opening;
  const demoJobs = new Map();
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('grantg-hydrotest-job-archives', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('jobs', { keyPath: 'id' });
        request.result.createObjectStore('summaries', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opening = null; reject(request.error); };
      request.onblocked = () => { opening = null; reject(new Error('Close other host tabs and retry archiving.')); };
    });
    return opening;
  }
  function summary(record) {
    return { id: record.id, slot: record.test.slot, archivedAt: record.archivedAt,
      localRevision: record.localRevision, cloudSyncedRevision: record.cloudSyncedRevision,
      label: record.test.jobNumber || record.test.displayName || `Test ${record.test.slot}`,
      pressures: record.readings.length, temperatures: record.temperatureReadings.length };
  }
  async function save(record, demo = false) {
    if (demo) { demoJobs.set(record.id, structuredClone(record)); return; }
    record = { ...record, localRevision: crypto.randomUUID() };
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['jobs', 'summaries'], 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Archive could not be saved. No new test was started.'));
      tx.onerror = () => {}; // onabort is the authoritative failure; never clear before commit.
      const request = tx.objectStore('jobs').get(record.id);
      request.onsuccess = () => {
        // An in-flight active save must never reopen an already archived job.
        if (request.result?.archivedAt && !record.archivedAt) return;
        tx.objectStore('jobs').put(record);
        tx.objectStore('summaries').put(summary(record));
      };
    });
  }
  async function read(store, id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = id === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  const acceptsTemperature = (test, row) => Number(row.at) >= (Number(test.jobStartedAt) || 0)
    && (!Array.isArray(test.temperatureSourceIds) || test.temperatureSourceIds.includes(row.source_id ?? row.sourceId));
  root.HydroJobs = {
    save,
    pending: async () => (await read('summaries')).filter(r => r.localRevision !== r.cloudSyncedRevision || !r.cloudSyncedRevision),
    async markSynced(id, revision) {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['jobs', 'summaries'], 'readwrite');
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => {};
        const req = tx.objectStore('jobs').get(id);
        req.onsuccess = () => {
          const r = req.result;
          if (!r || r.localRevision !== revision) return;
          r.cloudSyncedRevision = revision;
          tx.objectStore('jobs').put(r); tx.objectStore('summaries').put(summary(r));
        };
      });
    },
    async list(slot, demo = false) {
      const rows = demo ? [...demoJobs.values()].map(summary) : await read('summaries');
      return rows.filter(r => r.slot === slot && r.archivedAt).sort((a, b) => b.archivedAt - a.archivedAt);
    },
    get: (id, demo = false) => demo ? Promise.resolve(demoJobs.get(id)) : read('jobs', id),
    pressureKey: test => test.jobId ? `${test.slot}:${test.jobId}` : test.slot,
    acceptsTemperature,
  };
})(window);
