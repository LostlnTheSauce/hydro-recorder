(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STALE_MS = 30000;
  let selected = Number(localStorage.getItem('selected')) || null;
  const prefs = Object.assign({ window: true, lift: true, step: 900 }, JSON.parse(localStorage.getItem('prefs') || '{}'));
  let site = '';
  let points = [], cursor = 0, current = null, openTests = [], editing = null, beeped = false, busy = false;

  // ---- helpers
  function el(tag, props, ...kids) {
    const node = Object.assign(document.createElement(tag), props || {});
    kids.forEach((kid) => node.append(kid));
    return node;
  }
  async function call(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  const time = (ms, seconds) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined });
  const date = (ms) => new Date(ms).toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' });
  const whole = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
  const span = (ms) => `${Math.floor(ms / 3600000)} h ${Math.floor((ms % 3600000) / 60000)} min`;
  const toField = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  // Rebuild a section only when what it shows has changed, so buttons are never swapped out mid-click.
  function fresh(node, key) {
    if (node.dataset.key === key) return false;
    node.dataset.key = key;
    return true;
  }
  const quarter = (ms) => { const d = new Date(ms); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15); return d.getTime(); };

  function select(id) {
    selected = id;
    localStorage.setItem('selected', id || '');
    points = []; cursor = 0; current = null;
    tick();
  }
  function reload() { points = []; cursor = 0; tick(); }
  function beep() {
    try {
      const audio = new AudioContext(), tone = audio.createOscillator();
      tone.frequency.value = 880; tone.connect(audio.destination); tone.start(); tone.stop(audio.currentTime + 0.5);
    } catch (e) { /* sound needs a click on the page first */ }
  }

  // ---- once a second
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const state = await call(`/api/state?test=${selected || ''}&since=${cursor}&step=${prefs.step}`);
      openTests = state.tests;
      site = state.site;
      if (!state.selected && openTests.length) { busy = false; return select(openTests[0].id); }
      current = state.selected;
      if (current) {
        if (current.points.length) {
          points = points.concat(current.points);
          cursor = points[points.length - 1][0];
        }
        if (points.length > 14000) { points = []; cursor = 0; }
      }
      render(state.now);
      $('alert').dataset.offline = '';
    } catch (e) {
      showAlert('The recorder program is not answering. Check that its window is still open on this computer.', false);
    }
    busy = false;
  }

  function showAlert(text, warn) {
    $('alert').hidden = !text;
    $('alert').textContent = text || '';
    $('alert').classList.toggle('warn', !!warn);
  }

  // ---- drawing the screen
  function render(now) {
    $('clock').textContent = time(now, true);
    $('welcome').hidden = !!current;
    $('test').hidden = !current;
    renderTabs();
    renderAlert(now);
    if (!current) return;
    const t = current, d = t.details, closed = !!t.closed_at;
    $('name').textContent = t.name;
    $('jobLine').textContent = [d.job && `Job ${d.job}`, d.po && `PO/AFE ${d.po}`, d.location, d.inspector && `Inspector: ${d.inspector}`,
      closed && `Finished ${date(t.closed_at)} ${time(t.closed_at)}`].filter(Boolean).join(' · ');
    $('psi').textContent = t.latest ? t.latest.pressure.toFixed(1) : '—';
    $('low').textContent = whole(t.low);
    $('high').textContent = whole(t.high);
    $('offsetBtn').textContent = (t.offset > 0 ? '+' : '') + t.offset;
    renderGauge(t, closed);
    renderShare(t);
    renderOfficial(t, now, closed);
    renderMarks(t, closed);
    renderRows(t);
    $('markForm').hidden = closed;
    $('finishBtn').hidden = closed;
    for (const [id, kind] of [['dlLog', 'log'], ['dlNotes', 'notes'], ['dlPressure', 'pressure']]) $(id).href = `/api/tests/${t.id}/${kind}.csv`;
    RecorderChart.draw($('chart'), points, {
      max: t.chart_max, pen: 1, title: t.name, lift: prefs.lift,
      low: prefs.window ? t.window_low : null, high: prefs.window ? t.window_high : null,
      start: t.official_start, end: t.official_end || (t.official_start ? t.official_start + t.duration_hours * 3600000 : null),
    });
  }

  function renderTabs() {
    if (!fresh($('tabs'), JSON.stringify([selected, current && current.closed_at, openTests.map((t) => [t.id, t.name, t.gauge && t.gauge.status])]))) return;
    const tabs = openTests.map((t) => el('button', { className: t.id === selected ? 'on' : '', onclick: () => select(t.id) },
      el('span', { className: `dot ${t.gauge ? t.gauge.status : ''}` }), t.name));
    if (current && current.closed_at) tabs.push(el('button', { className: 'on' }, `${current.name} (finished)`));
    tabs.push(el('button', { onclick: () => openDetails(null) }, '+ New test'));
    $('tabs').replaceChildren(...tabs);
  }

  function renderAlert(now) {
    const problems = [];
    openTests.forEach((t) => {
      if (!t.gauge) return;
      const quiet = now - (t.latest ? t.latest.at : t.created_at);
      if (quiet > STALE_MS) problems.push(`${t.name}: no pressure reading for ${Math.round(quiet / 1000)} seconds. Check the gauge and its cable.`);
      else if (t.latest && t.latest.unit !== 'PSI') problems.push(`${t.name}: the gauge is reporting ${t.latest.unit}, not PSI. Set the gauge to PSI.`);
    });
    showAlert(problems.join('  '), false);
    if (problems.length && !beeped) beep();
    beeped = problems.length > 0;
  }

  function renderGauge(t, closed) {
    const box = $('gauge');
    if (!fresh(box, JSON.stringify([t.id, closed, t.gauge]))) return;
    if (closed) return box.replaceChildren(el('span', { className: 'muted' }, 'Finished. Nothing is being recorded.'));
    if (!t.gauge) return box.replaceChildren(el('button', { className: 'primary', onclick: openPorts }, 'Connect gauge'));
    const port = t.gauge.port === 'DEMO' ? 'practice gauge' : t.gauge.port;
    const text = {
      live: `Recording from ${port}. Saved on this computer.`,
      connecting: `Opening ${port}…`,
      silent: `${port} is open but the gauge is not answering.`,
      lost: `Lost ${port}. Trying again every 2 seconds.`,
    }[t.gauge.status];
    box.replaceChildren(el('span', { className: `dot ${t.gauge.status}` }), el('span', {}, text),
      el('button', { className: 'link', onclick: () => post(`/api/tests/${t.id}/disconnect`, {}) }, 'Disconnect'));
  }

  function shareText(share) {
    if (share.error) return `Shared, but the website cannot be reached right now. ${share.pending.toLocaleString()} readings waiting; they send by themselves when the internet is back.`;
    return share.pending > 5 ? `Shared. Sending ${share.pending.toLocaleString()} earlier readings.` : 'Shared. Viewers are up to date.';
  }
  function renderShare(t) {
    $('shareBtn').textContent = t.share ? 'Sharing…' : 'Share live';
    $('shareLine').hidden = !t.share;
    if (!t.share) return;
    $('shareLine').textContent = shareText(t.share);
    $('shareLine').classList.toggle('behind', !!t.share.error);
    $('shareStatus').textContent = shareText(t.share);
  }
  function openShare() {
    const share = current.share;
    $('shareOff').hidden = !!share;
    $('shareOn').hidden = !share;
    $('shareError').textContent = '';
    if (share) { $('shareLink').value = share.link; $('shareQr').src = `/api/tests/${current.id}/qr.svg?${encodeURIComponent(share.link)}`; } else $('shareSite').value = site;
    $('shareDlg').open || $('shareDlg').showModal();
  }
  $('shareBtn').onclick = openShare;
  $('shareStart').onclick = async () => {
    $('shareStart').disabled = true;
    try { await call(`/api/tests/${current.id}/share`, { site: $('shareSite').value }); await tick(); openShare(); } catch (e) { $('shareError').textContent = e.message; }
    $('shareStart').disabled = false;
  };
  $('shareStop').onclick = async () => {
    if (!confirm('Stop sharing? The link stops working for everyone.')) return;
    await post(`/api/tests/${current.id}/unshare`, {});
    $('shareDlg').close();
  };
  $('shareCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('shareLink').value); } catch (e) { $('shareLink').select(); document.execCommand('copy'); }
    $('shareCopy').textContent = 'Copied';
    setTimeout(() => { $('shareCopy').textContent = 'Copy link'; }, 1500);
  };

  function renderOfficial(t, now, closed) {
    const box = $('official'), start = t.official_start, end = t.official_end;
    const hint = !start ? 'Until you set a start time, the 15-minute record runs from the first reading.'
      : end ? `${date(start)} · ${span(end - start)}`
        : now < start ? `Starts in ${span(start - now)}` : `${span(now - start)} elapsed · ${t.duration_hours} hours is up at ${time(start + t.duration_hours * 3600000)}`;
    if (!fresh(box, JSON.stringify([t.id, start, end, closed]))) { box.querySelector('.hint').textContent = hint; return; }
    const setStart = el('button', { className: start ? '' : 'primary', onclick: () => askTime('official_start') }, start ? 'Change start' : 'Start official test');
    const setEnd = el('button', { className: end ? '' : 'primary', onclick: () => askTime('official_end') }, end ? 'Change end' : 'End test');
    const kids = [];
    if (!start) {
      kids.push(el('div', { className: 'big-line' }, 'Not started'), el('p', { className: 'hint' }, hint));
      if (!closed) kids.push(el('div', { className: 'row' }, setStart));
    } else {
      kids.push(el('div', { className: 'big-line' }, end ? `${time(start)} – ${time(end)}` : `Started ${time(start)}`), el('p', { className: 'hint' }, hint));
      if (!closed) kids.push(el('div', { className: 'row' }, setEnd, setStart));
    }
    box.replaceChildren(...kids);
  }

  function renderMarks(t, closed) {
    if (!fresh($('marks'), JSON.stringify([closed, t.marks]))) return;
    const items = t.marks.map((m) => {
      const body = el('span', {});
      if (m.kind === 'stroke') body.append(el('b', {}, `${m.strokes.toLocaleString()} strokes`), m.pressure == null ? '' : ` at ${whole(m.pressure)} psi`, m.text ? ` · ${m.text}` : '');
      else body.append(m.text);
      const remove = el('button', { className: 'x', title: 'Remove', onclick: () => confirm('Remove this entry?') && post(`/api/marks/${m.id}/delete`, {}) }, '×');
      return el('li', {}, el('time', {}, time(m.at)), body, closed ? '' : remove);
    });
    $('marks').replaceChildren(...(items.length ? items : [el('li', { className: 'empty' }, 'Nothing added yet.')]));
  }

  function renderRows(t) {
    if (!fresh($('rows'), JSON.stringify([prefs.step, t.official]))) return;
    const fine = prefs.step < 900, list = fine ? t.official.slice().reverse() : t.official;
    const psi = (p) => (fine ? p.toFixed(1) : whole(p));
    const rows = list.map((r) => el('tr', {}, el('td', {}, date(r.at)), el('td', {}, time(r.at, prefs.step < 60)),
      el('td', { className: r.pressure == null ? 'blank' : '' }, r.pressure == null ? 'No reading' : `${psi(r.pressure)} psi`), el('td', {}, r.remark)));
    $('rows').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 4, className: 'muted' }, 'Rows appear once the gauge is recording.'))]));
    $('rowsNote').textContent = fine ? `Newest first, latest ${list.length} rows. The download is always the 15-minute record; "Every reading" has everything.` : '';
  }

  // ---- actions
  async function post(path, body) {
    try { const result = await call(path, body); await tick(); return result; } catch (e) { alert(e.message); return null; }
  }

  function openDetails(test) {
    editing = test;
    const form = $('detailsForm'), d = test ? test.details : {};
    form.reset();
    $('detailsTitle').textContent = test ? 'Test details' : 'New test';
    $('detailsSave').textContent = test ? 'Save' : 'Start test';
    $('detailsError').textContent = '';
    if (test) {
      for (const key of ['name', 'chart_max', 'duration_hours', 'window_low', 'window_high']) form.elements[key].value = test[key] == null ? '' : test[key];
      for (const key of ['job', 'po', 'location', 'inspector']) form.elements[key].value = d[key] || '';
    }
    $('detailsDlg').showModal();
  }
  $('detailsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = event.target.elements, v = (k) => f[k].value.trim();
    const body = { name: v('name'), chart_max: v('chart_max'), duration_hours: v('duration_hours'), window_low: v('window_low'), window_high: v('window_high'),
      details: { job: v('job'), po: v('po'), location: v('location'), inspector: v('inspector') } };
    try {
      if (editing) { await call(`/api/tests/${editing.id}`, body); $('detailsDlg').close(); reload(); }
      else { const made = await call('/api/tests', body); $('detailsDlg').close(); select(made.id); openPorts(); }
    } catch (e) { $('detailsError').textContent = e.message; }
  });

  async function openPorts() {
    $('portError').textContent = '';
    $('portDlg').open || $('portDlg').showModal();
    const found = await call('/api/ports');
    $('ports').replaceChildren(...found.map((p) => el('button', {
      disabled: !!p.used_by,
      onclick: async () => {
        try { await call(`/api/tests/${selected}/connect`, { port: p.port }); $('portDlg').close(); tick(); } catch (e) { $('portError').textContent = e.message; }
      },
    }, p.port === 'DEMO' ? 'Practice gauge' : p.port, el('small', {}, p.used_by ? `In use by ${p.used_by}` : p.label))));
  }
  $('portRefresh').onclick = openPorts;

  function ask({ title, help, type, value, clearable }) {
    return new Promise((resolve) => {
      $('askTitle').textContent = title;
      $('askHelp').textContent = help;
      $('askError').textContent = '';
      Object.assign($('askInput'), { type, value });
      $('askInput').step = type === 'number' ? 'any' : '';
      $('askClear').hidden = !clearable;
      const done = (result) => { $('askDlg').close(); $('askForm').onsubmit = null; resolve(result); };
      $('askForm').onsubmit = (event) => { event.preventDefault(); done($('askInput').value); };
      $('askClear').onclick = () => done('');
      $('askDlg').onclose = () => resolve(null);
      $('askDlg').showModal();
      $('askInput').focus();
    });
  }
  async function askTime(field) {
    const isStart = field === 'official_start', now = Date.now();
    const answer = await ask({
      title: isStart ? 'Official test start' : 'Official test end', type: 'datetime-local', clearable: !!current[field],
      value: toField(current[field] || (isStart ? quarter(now) : now)),
      help: isStart ? 'Set to the next quarter hour. Change it to the time the test really started.' : 'Set to right now. Change it if the test ended earlier.',
    });
    if (answer === null) return;
    post(`/api/tests/${current.id}`, { [field]: answer ? new Date(answer).getTime() : null });
  }
  $('offsetBtn').onclick = async () => {
    const answer = await ask({ title: 'Pressure offset (psi)', type: 'number', value: current.offset,
      help: 'Deadweight minus gauge. Example: gauge reads 110, deadweight reads 108, offset is -2. It applies to the whole test; the untouched gauge readings are kept too.' });
    if (answer === null || answer === '') return;
    if (await post(`/api/tests/${current.id}`, { offset: answer })) reload();
  };

  $('markForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await post(`/api/tests/${current.id}/marks`, { text: $('markText').value, strokes: $('markStrokes').value })) event.target.reset();
  });
  $('finishBtn').onclick = async () => {
    if (!confirm(`Finish "${current.name}"?\n\nRecording stops. Everything stays saved under Past tests.`)) return;
    await post(`/api/tests/${current.id}/finish`, {});
  };
  function savePrefs() { localStorage.setItem('prefs', JSON.stringify(prefs)); tick(); }
  $('optWindow').checked = prefs.window;
  $('optLift').checked = prefs.lift;
  $('step').value = String(prefs.step);
  $('optWindow').onchange = (e) => { prefs.window = e.target.checked; savePrefs(); };
  $('optLift').onchange = (e) => { prefs.lift = e.target.checked; savePrefs(); };
  $('step').onchange = (e) => { prefs.step = Number(e.target.value); savePrefs(); };
  $('detailsBtn').onclick = () => openDetails(current);
  $('printBtn').onclick = () => window.print();
  $('demoBtn').onclick = async () => {
    const made = await post('/api/tests', { name: 'Practice test', chart_max: 1000, window_low: 880, window_high: 920 });
    if (!made) return;
    await call(`/api/tests/${made.id}/connect`, { port: 'DEMO' });
    select(made.id);
  };
  $('pastBtn').onclick = async () => {
    const tests = await call('/api/history');
    $('past').replaceChildren(...(tests.length ? tests.map((t) => el('div', { className: 'item' },
      el('b', {}, t.name), el('div', { className: 'muted' }, `${date(t.created_at)} ${time(t.created_at)} to ${time(t.closed_at)} · ${t.count.toLocaleString()} readings${t.details.job ? ` · Job ${t.details.job}` : ''}`),
      el('div', { className: 'row' },
        el('button', { onclick: () => { $('pastDlg').close(); select(t.id); } }, 'Open'),
        el('a', { className: 'button', href: `/api/tests/${t.id}/log.csv` }, 'Record'),
        el('a', { className: 'button', href: `/api/tests/${t.id}/notes.csv` }, 'Notes & strokes'),
        el('a', { className: 'button', href: `/api/tests/${t.id}/pressure.csv` }, 'Every reading'))))
      : [el('p', { className: 'muted' }, 'Finished tests will be listed here.')]));
    $('pastDlg').showModal();
  };
  document.querySelectorAll('[data-new]').forEach((b) => { b.onclick = () => openDetails(null); });
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });

  tick();
  setInterval(tick, 1000);
})();
