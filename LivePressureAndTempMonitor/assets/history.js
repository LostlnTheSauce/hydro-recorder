(function () {
  'use strict';
  const $ = s => document.querySelector(s), status = $('#historyStatus'), panel = $('[data-temperature-panel]');
  let jobs = [], record, options, activeJob, editPending, editing = false, playing = false, lastTick = 0, playAt = 0, loadGeneration = 0;
  const stamp = at => new Date(Number(at)).toLocaleString();
  let logData, logPage = 0;
  const logPageSize = 100;
  const logProbes = ['pipe','ambient','soil','aux'];
  const probeNames = {pipe:'Pipe',ambient:'Ambient',soil:'Soil',aux:'Auxiliary'};
  const preferenceKey = () => 'grantg-history-log-view-v1:' + activeJob.id;
  function saveLogPreferences() {
    if (!activeJob) return;
    try { localStorage.setItem(preferenceKey(), JSON.stringify({
      probes:logProbes.filter(key=>$(`[data-log-probe="${key}"]`).checked),
      interval:$('#historyLogInterval').value, period:$('#historyLogPeriod').value
    })); } catch (_) { /* Viewing still works when browser storage is unavailable. */ }
  }
  function applyLogPreferences() {
    let saved; try { saved=JSON.parse(localStorage.getItem(preferenceKey())); } catch (_) {}
    const enabled=Array.isArray(record.test.enabledProbes) ? record.test.enabledProbes : ['ambient','pipe','soil'];
    const probes=Array.isArray(saved?.probes) ? saved.probes : enabled.filter(key=>key!=='aux');
    for (const key of logProbes) {
      $(`[data-log-probe="${key}"]`).checked=probes.includes(key);
      panel.querySelector(`.temperature-channel-toggles input[value="${key}"]`).checked=probes.includes(key);
    }
    for (const [id,value,fallback] of [['historyLogInterval',saved?.interval,'900000'],['historyLogPeriod',saved?.period,'all']]) {
      const select=$('#'+id); select.value=[...select.options].some(o=>o.value===value)?value:fallback;
    }
    logPage=0;
  }
  function showHistoryView(view) {
    if (view!=='graph') stop();
    document.querySelectorAll('[data-history-section]').forEach(section=>section.hidden=section.dataset.historySection!==view);
    document.querySelectorAll('[data-history-view]').forEach(button=>button.setAttribute('aria-current',button.dataset.historyView===view?'page':'false'));
    if (view==='graph') render(); else if (view==='log') renderLog();
  }
  function renderLog() {
    if (!logData) return;
    const plan=HydroHistoryLog.plan(logData,{interval:Number($('#historyLogInterval').value),period:$('#historyLogPeriod').value,
      testStart:options.testStart ? Date.parse(options.testStart) : 0, testEnd:options.testEnd ? Date.parse(options.testEnd) : 0});
    const selected=logProbes.filter(key=>$(`[data-log-probe="${key}"]`).checked);
    const keys=['pressure',...selected], table=$('#historyLogTable'), head=document.createElement('tr');
    for (const title of ['Date','Log time','Pressure PSI',...selected.map(key=>probeNames[key]+' °F')]) {
      const cell=document.createElement('th'); cell.scope='col'; cell.textContent=title; head.append(cell);
    }
    table.tHead.replaceChildren(head); table.tBodies[0].replaceChildren();
    const pages=Math.max(1,Math.ceil(plan.count/logPageSize)); logPage=Math.min(logPage,pages-1);
    const first=logPage*logPageSize, last=Math.min(plan.count,first+logPageSize), fragment=document.createDocumentFragment();
    for(let i=first;i<last;i++) {
      const sample=plan.row(i), row=document.createElement('tr'); row.dataset.at=String(sample.at);
      for(const value of [new Date(sample.at).toLocaleDateString(),new Date(sample.at).toLocaleTimeString()]) {
        const cell=document.createElement('td'); cell.textContent=value; row.append(cell);
      }
      for(const key of keys) {
        const cell=document.createElement('td'), reading=sample.values[key]; cell.dataset.column=key;
        if (!reading) cell.textContent='—';
        else {
          const detail=document.createElement('details'), value=document.createElement('summary'), source=document.createElement('small');
          value.textContent=key==='pressure' ? String(Math.round(reading.value)) : reading.value.toFixed(1);
          value.setAttribute('aria-label',`${key==='pressure'?'Pressure':probeNames[key]} ${value.textContent}; show recorded time`);
          cell.title=`Recorded ${stamp(reading.at)}`; source.textContent=cell.title; detail.append(value,source); cell.append(detail);
        }
        row.append(cell);
      }
      fragment.append(row);
    }
    if (!plan.count) { const row=document.createElement('tr'), cell=document.createElement('td'); cell.colSpan=keys.length+2; cell.textContent=plan.reason; row.append(cell); fragment.append(row); }
    table.tBodies[0].append(fragment);
    $('#historyLogSummary').textContent=plan.count ? `${plan.count.toLocaleString()} log rows · ${stamp(plan.start)} – ${stamp(plan.end)} · Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}` : plan.reason;
    $('#historyLogPage').textContent=plan.count ? `Rows ${(first+1).toLocaleString()}–${last.toLocaleString()} of ${plan.count.toLocaleString()}` : 'No rows';
    $('#historyLogPrevious').disabled=logPage===0; $('#historyLogNext').disabled=logPage>=pages-1;
  }
  document.querySelectorAll('[data-history-view]').forEach(button=>button.addEventListener('click',()=>showHistoryView(button.dataset.historyView)));
  for(const id of ['historyLogInterval','historyLogPeriod']) $('#'+id).addEventListener('change',()=>{ logPage=0; saveLogPreferences(); renderLog(); });
  document.querySelectorAll('[data-log-probe]').forEach(input=>input.addEventListener('change',()=>{
    panel.querySelector(`.temperature-channel-toggles input[value="${input.dataset.logProbe}"]`).checked=input.checked;
    saveLogPreferences(); renderLog();
  }));
  for(const [id,direction] of [['historyLogPrevious',-1],['historyLogNext',1]]) $('#'+id).addEventListener('click',()=>{
    logPage+=direction; renderLog(); $('.history-log-table-wrap').scrollTop=0;
  });
  async function get(action, params = {}) {
    const response = await fetch('history-api.php?' + new URLSearchParams({ action, ...params }), { signal: AbortSignal.timeout(45000) });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 403 ? 'Please sign in again to open history.' : data.error || 'Could not load history.');
    return data;
  }
  function list() {
    const box = $('#historyList'); box.replaceChildren();
    const search = $('#historySearch').value.toLowerCase();
    const folder = $('#historyFolder').value;
    const visible = jobs.filter(j => j.label.toLowerCase().includes(search) &&
      (folder === 'trash' ? Number(j.deleted_at) > 0 : !Number(j.deleted_at) &&
        (folder === 'all' || folder === 'unfiled' && !j.folder || folder === 'folder:' + j.folder)));
    for (const job of visible) {
      const card = document.createElement('article'); card.className = 'history-job';
      const title = document.createElement('h3'); title.textContent = job.label;
      const info = document.createElement('p'); info.textContent = `${Number(job.deleted_at) ? 'In Trash' : job.status === 'archived' ? 'Archived test' : 'Current job snapshot'} · ${job.folder || 'Unfiled'} · Last saved ${stamp(job.updated_at)}`;
      const button = document.createElement('button'); button.textContent = 'Open & replay'; button.addEventListener('click', () => open(job));
      const actions = document.createElement('div'); actions.className = 'history-job-actions';
      const menu = document.createElement('details'); menu.className = 'history-action-menu';
      const summary = document.createElement('summary'); summary.textContent = 'Actions'; summary.setAttribute('aria-label', 'Actions for ' + job.label); menu.append(summary);
      const menuItems = document.createElement('div'); menu.append(menuItems); actions.append(button, menu);
      for (const [action, label] of Number(job.deleted_at) ? [['restore','Restore']] : [['rename','Rename'],['move','Move'],['trash','Delete']]) {
        const control = document.createElement('button'); control.type = 'button'; control.textContent = label;
        if (action === 'trash') control.className = 'history-delete';
        control.addEventListener('click', () => manage(job, action));
        menuItems.append(control);
      }
      const description = document.createElement('div'); description.className = 'history-job-description'; description.append(title, info);
      card.append(description, actions); box.append(card);
    }
    if (!visible.length) { const empty = document.createElement('p'); empty.textContent = folder === 'trash' ? 'Trash is empty.' : 'No tests match this folder or search.'; box.append(empty); }
  }
  function folders() {
    const select = $('#historyFolder'), current = select.value;
    select.replaceChildren();
    const entries = [['all','All tests'],['unfiled','Unfiled'],['trash','Trash'],
      ...[...new Set(jobs.map(j=>j.folder).filter(Boolean))].sort().map(name=>['folder:'+name,name])];
    for (const [value,label] of entries) { const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option); }
    select.value = entries.some(([v])=>v===current) ? current : 'all';
  }
  function syncActiveJob() {
    if (!activeJob) return;
    activeJob = jobs.find(j => j.id === activeJob.id) || activeJob;
    $('#replayTitle').textContent = activeJob.label;
    $('#replayFolder').textContent = `${Number(activeJob.deleted_at) ? 'TRASH' : 'SAVED RECORDING'} / ${activeJob.folder || 'Unfiled'}`;
    if (record) { record.historyName = activeJob.label; record.historyFolder = activeJob.folder || ''; }
    $('#replayActions').querySelectorAll('[data-manage]').forEach(b => b.hidden = b.dataset.manage === 'restore' ? !Number(activeJob.deleted_at) : !!Number(activeJob.deleted_at));
  }
  function closeReplay() {
    stop(); ++loadGeneration; activeJob = null;
    $('#replay').hidden = true; $('#historyLibrary').hidden = false;
    status.textContent = `${jobs.filter(j=>!Number(j.deleted_at)).length} tests saved online`;
    $('#historySearch').focus({preventScroll:true});
  }
  function manage(job, action) {
    editPending = { job, action };
    const names = {rename:'Rename test',move:'Move test',trash:'Move to Trash?',restore:'Restore test?'};
    $('#historyEditTitle').textContent = names[action];
    $('#historyEditHelp').textContent = ({rename:'Change the history name. Original paperwork stays unchanged.',move:'Choose or type a folder. Leave blank for Unfiled.',trash:`“${job.label}” can be restored from Trash. This does not stop recording or remove the laptop backup.`,restore:`Return “${job.label}” to its folder.`})[action];
    $('#historyEditField').hidden = !['rename','move'].includes(action);
    $('#historyEditLabel').textContent = action === 'rename' ? 'Test name' : 'Folder';
    const input = $('#historyEditValue'); input.value = action === 'rename' ? job.label : job.folder || '';
    input.required = action === 'rename'; input.disabled = $('#historyEditField').hidden;
    if (action === 'move') input.setAttribute('list','historyFolderNames'); else input.removeAttribute('list');
    $('#historyFolderNames').replaceChildren(...[...new Set(jobs.map(j=>j.folder).filter(Boolean))].sort().map(name => { const option=document.createElement('option'); option.value=name; return option; }));
    $('#historyEditError').textContent = '';
    $('#historyEditSave').textContent = ({rename:'Save name',move:'Move test',trash:'Move to Trash',restore:'Restore'})[action];
    $('#historyEditSave').classList.toggle('danger', action === 'trash');
    $('#historyEdit').showModal();
    if (!input.disabled) { input.focus(); input.select(); } else $('#historyEditCancel').focus();
  }
  $('#historyEditCancel').addEventListener('click', () => $('#historyEdit').close());
  $('#historyEdit').addEventListener('cancel', e => { if (editing) e.preventDefault(); });
  $('#historyEditForm').addEventListener('submit', async event => {
    event.preventDefault(); if (editing || !editPending) return;
    const {job, action} = editPending, value = $('#historyEditValue').value.trim();
    if (action === 'rename' && !value) { $('#historyEditError').textContent = 'Enter a test name.'; return; }
    editing = true;
    $('#historyEditForm').querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const response = await fetch('history-api.php?action='+action, {
        method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':$('#historyApp').dataset.csrf},
        body:JSON.stringify({id:job.id,version:Number(job.organization_version)||0,value}), signal:AbortSignal.timeout(45000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status===403 ? 'Please sign in again before changing history.' : result.error || 'Could not save changes.');
      await refresh();
      if (action === 'trash' && activeJob?.id === job.id) closeReplay();
      $('#historyEdit').close();
      status.textContent = ({rename:'Test renamed.',move:'Test moved.',trash:'Moved to Trash. Select Trash to restore it.',restore:'Test restored to its folder.'})[action];
    } catch(e) {
      await refresh();
      editPending.job = jobs.find(j => j.id === job.id) || job;
      $('#historyEditError').textContent = e.message + ' Check the test and try again.';
    } finally { editing = false; $('#historyEditForm').querySelectorAll('button').forEach(b=>b.disabled=false); }
  });
  $('#replayActions').querySelectorAll('[data-manage]').forEach(b => b.addEventListener('click', () => { if(activeJob) manage(activeJob,b.dataset.manage); }));
  async function refresh() {
    try { jobs = (await get('list')).jobs; folders(); list(); syncActiveJob(); status.textContent = jobs.length ? `${jobs.filter(j=>!Number(j.deleted_at)).length} tests saved online` : 'No online tests yet. Open the recorder on your original laptop to upload its saved tests.'; }
    catch (e) { status.textContent = e.message; }
  }
  function gapLimit(rows, minimum) {
    const deltas = [];
    for (let i = 1; i < Math.min(rows.length, 2000); i++) if (rows[i].at > rows[i-1].at) deltas.push(rows[i].at-rows[i-1].at);
    deltas.sort((a,b) => a-b);
    return Math.max(minimum, (deltas[Math.floor(deltas.length/2)] || minimum) * 3);
  }
  function stop() { playing = false; $('#playReplay').textContent = '▶ Play'; }
  function render() {
    if (!options) return;
    TemperatureChartRenderer.renderPanel(panel, options);
    for(const key of logProbes) {
      panel.querySelector(`[data-temp-inspector-value="${key}"]`).parentElement.hidden=!panel.querySelector(`.temperature-channel-toggles input[value="${key}"]`).checked;
    }
    const m = panel.querySelector('canvas')._temperatureMeta;
    $('#playReplay').disabled = !m;
    if (m) { playAt = m.selectedAt; $('#replayClock').textContent = stamp(playAt); }
  }
  // Keep the readings next to the graph, with playback controls below it.
  panel.prepend(panel.querySelector('.temperature-inspector-readout'));
  TemperatureChartRenderer.bindPanel(panel, () => { stop(); render(); });
  panel.querySelector('.temperature-controls').append(panel.querySelector('.temp-chart-expand'));
  panel.querySelectorAll('.temperature-channel-toggles input:not(.temp-pressure-toggle)').forEach(input=>input.addEventListener('change',()=>{
    $(`[data-log-probe="${input.value}"]`).checked=input.checked; saveLogPreferences();
  }));
  async function open(job) {
    const generation = ++loadGeneration; stop(); status.textContent = 'Loading complete recording…';
    try {
      const data = await get('read', { id: job.id });
      const snapshot = { ...data.metadata, readings: [], temperatureReadings: [] };
      const hashes = [...new Set(Object.values(data.manifest).flat())], chunks = new Map(); let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, hashes.length) }, async () => {
        while (index < hashes.length && generation === loadGeneration) {
          const checksum = hashes[index++], chunk = await get('chunk', { id: job.id, hash: checksum });
          const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chunk.data)))].map(b => b.toString(16).padStart(2,'0')).join('');
          if (actual !== checksum) throw new Error('Recording checksum did not match. Reload this test.');
          chunks.set(checksum, JSON.parse(chunk.data));
        }
      }));
      if (generation !== loadGeneration) return;
      for (const kind of ['readings', 'temperatureReadings']) snapshot[kind] = data.manifest[kind].flatMap(h => chunks.get(h)).sort((a,b) => a.at-b.at);
      record = snapshot;
      activeJob = jobs.find(j => j.id === job.id) || job;
      record.historyName = job.label; record.historyFolder = job.folder || '';
      const test = record.test;
      // Numeric epoch timestamps avoid interpreting trailer-local text in the phone's timezone.
      const start = test.workflow?.officialStart || (test.officialStart ? new Date(test.officialStart).getTime() : 0);
      const end = test.workflow?.officialEnd || (test.officialEnd ? new Date(test.officialEnd).getTime() : 0);
      options = { pressureReadings: record.readings, temperatureReadings: record.temperatureReadings,
        testStart: start ? new Date(start).toISOString() : '', testEnd: end ? new Date(end).toISOString() : '',
        notes: [...(test.events || []).map(e => ({ at:e.at, text:e.label })), ...(record.notes || [])],
        replay: true, gapLimits: { pressure:gapLimit(record.readings,30000), temperature:gapLimit(record.temperatureReadings,30000) } };
      logData=HydroHistoryLog.prepare(record); applyLogPreferences();
      syncActiveJob();
      $('#replaySummary').textContent = `${record.readings.length.toLocaleString()} pressure readings · ${record.temperatureReadings.length.toLocaleString()} temperature readings · Snapshot saved ${stamp(data.updatedAt)}`;
      $('#jobDetails').textContent = [test.design?.projectName, test.location, test.poAfe ? `PO/AFE ${test.poAfe}` : '', test.jobNumber ? `Job ${test.jobNumber}` : ''].filter(Boolean).join(' · ') || 'No job details entered.';
      const tbody = $('#replayEvents'); tbody.replaceChildren();
      const highlights = $('#replayHighlights'); highlights.replaceChildren();
      const allEvents = [...(test.events || []), ...(record.notes || []).map(n => ({ ...n,label:n.text }))].sort((a,b) => a.at-b.at);
      for (const event of allEvents.slice(-6)) {
        const item=document.createElement('li'), time=document.createElement('time'), text=document.createElement('p');
        time.textContent=stamp(event.at); text.textContent=event.label; item.append(time,text); highlights.append(item);
      }
      if (!allEvents.length) { const empty=document.createElement('li'); empty.textContent='No notes recorded.'; highlights.append(empty); }
      for (const event of allEvents) {
        const row = document.createElement('tr');
        const detail = [event.enteredAt ? `Entered ${stamp(event.enteredAt)}` : '', event.correctsTime ? `Corrected from ${stamp(event.correctsTime)}` : '', event.pressureSource || ''].filter(Boolean).join(' · ');
        for (const value of [stamp(event.at),event.label,event.pressure ?? '',detail]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
        tbody.append(row);
      }
      panel._temperatureZoom = null; panel._temperatureSelection = { followLive:false, at:Math.min(record.readings[0]?.at ?? Infinity,record.temperatureReadings[0]?.at ?? Infinity) };
      $('.temp-history-range').value = 'all'; $('#replay').hidden = false; $('#historyLibrary').hidden = true;
      showHistoryView('graph'); status.textContent = 'Saved recording · Read-only playback';
      $('#replay').scrollIntoView({ block:'start' });
    } catch (e) { if (generation === loadGeneration) status.textContent = e.message; }
  }
  $('#playReplay').addEventListener('click', () => {
    if (playing) { stop(); return; }
    const m = panel.querySelector('canvas')._temperatureMeta; if (!m) return;
    playAt = m.selectedAt >= m.end ? m.start : m.selectedAt;
    playing = true; lastTick = performance.now(); $('#playReplay').textContent = '❚❚ Pause';
  });
  $('.temp-scrubber').addEventListener('input', event => {
    stop(); const m = panel.querySelector('canvas')._temperatureMeta;
    if (m) playAt = m.start + Number(event.target.value)/Number(event.target.max)*(m.end-m.start);
  });
  setInterval(() => {
    if (!playing) return;
    const m = panel.querySelector('canvas')._temperatureMeta; if (!m) { stop(); return; }
    const now = performance.now(); playAt = Math.min(m.end, playAt+(now-lastTick)*Number($('#replaySpeed').value)); lastTick = now;
    panel._temperatureSelection = { followLive:false, at:playAt }; render();
    $('#replayClock').textContent = stamp(playAt);
    if (playAt >= m.end) stop();
  }, 200);
  $('#downloadReplay').addEventListener('click', () => {
    if (!record) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(record)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `Hydrotest_${record.id}_backup.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  $('#closeReplay').addEventListener('click', closeReplay);
  $('#refreshHistory').addEventListener('click', refresh); $('#historySearch').addEventListener('input', list);
  $('#historyFolder').addEventListener('change', list); refresh();
})();
