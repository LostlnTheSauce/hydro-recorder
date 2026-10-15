/* Calibration papers. Each piece of equipment in the library can hold its current
   calibration certificate (PDF or a photo/scan), stored on the website so every
   signed-in device has it. "Print calibration papers" puts a cover sheet listing the
   chosen equipment and every chosen paper into one PDF to print for the inspectors. */
(function (root) {
  'use strict';
  const API = 'calibration-api.php';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let options = null, papers = new Map(), maxBytes = 8000000, loaded = false, loadError = '';

  const demo = () => Boolean(root.HydroDemo?.enabled);
  const inventory = () => (options?.inventory?.() || []);
  const label = (type) => options?.labels?.[type] || type;
  // "Deadweight 5496" rather than "Deadweight: Deadweight" when the name already says the type.
  const title = (item) => (String(item.name || '').toLowerCase().includes(String(label(item.type)).toLowerCase()) ? item.name : `${label(item.type)}: ${item.name}`);

  async function refresh() {
    if (demo()) { loaded = true; return; }
    try {
      const response = await fetch(`${API}?action=list`, { headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Calibration papers are unavailable.');
      papers = new Map(result.papers.map((p) => [p.equipment_id, p]));
      if (result.equipment) options?.onEquipment?.(result.equipment);
      maxBytes = Number(result.maxBytes) || maxBytes;
      loadError = '';
    } catch (error) { loadError = error.message || String(error); }
    loaded = true;
    options?.onChange?.();
  }

  // Calibration due date and status for an equipment item on a given day.
  function due(item, at = Date.now()) {
    if (item.type === 'pump') return { text: 'Not applicable', state: 'na' };
    if (!item.calibrationDate) return { text: 'Date needed', state: 'missing' };
    const calibrated = new Date(`${item.calibrationDate}T12:00:00`);
    if (Number.isNaN(calibrated.getTime())) return { text: 'Date needed', state: 'missing' };
    const dueAt = new Date(calibrated); dueAt.setMonth(dueAt.getMonth() + (Number(item.intervalMonths) || 6));
    return { calibrated, dueAt, text: dueAt.toLocaleDateString(), state: dueAt.getTime() < at ? 'past' : 'current' };
  }

  function cell(item) {
    if (!loaded) return '<span class="cal-paper-none">Checking…</span>';
    const paper = papers.get(item.id), id = esc(item.id);
    if (paper) {
      return `<span class="cal-paper"><a href="${API}?action=file&amp;equipment=${encodeURIComponent(item.id)}" target="_blank" rel="noopener" title="${esc(paper.file_name)}">View paper</a>`
        + `<button type="button" class="ghost" data-cal-action="upload" data-cal-equipment="${id}">Replace</button>`
        + `<button type="button" class="ghost" data-cal-action="remove" data-cal-equipment="${id}">Remove</button></span>`;
    }
    return `<span class="cal-paper">${loadError ? `<span class="cal-paper-none" title="${esc(loadError)}">Unavailable</span>` : ''}<button type="button" class="ghost" data-cal-action="upload" data-cal-equipment="${id}">Add paper</button></span>`;
  }

  // Photos are shrunk to a sharp, printable JPEG so a phone picture uploads quickly.
  async function prepare(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { body: file, name: file.name };
    if (!/^image\//.test(file.type)) throw new Error('Choose a PDF or a photo of the calibration paper.');
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error('That picture could not be read. Try a JPEG or PNG.');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 2500000 && /^image\/(jpeg|png)$/.test(file.type)) return { body: file, name: file.name };
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return { body: blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  }

  async function upload(item, file) {
    if (demo()) throw new Error('Calibration papers are not saved in demo mode.');
    const { body, name } = await prepare(file);
    if (body.size > maxBytes) throw new Error(`That file is ${(body.size / 1e6).toFixed(1)} MB; the limit is ${(maxBytes / 1e6).toFixed(1)} MB. Scan it at a lower resolution and try again.`);
    const response = await fetch(`${API}?action=upload`, { method: 'POST', body,
      headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': options.csrf, 'X-Equipment-Id': item.id, 'X-File-Name': encodeURIComponent(name) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The calibration paper could not be saved.');
    papers.set(item.id, result.paper);
    options?.onChange?.();
  }

  async function remove(item) {
    const response = await fetch(`${API}?action=delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': options.csrf }, body: JSON.stringify({ equipment: item.id }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The calibration paper could not be removed.');
    papers.delete(item.id);
    options?.onChange?.();
  }

  function bindLibrary(table) {
    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'application/pdf,image/*'; picker.hidden = true;
    table.closest('details, section, div')?.append(picker);
    let target = null;
    picker.addEventListener('change', async () => {
      const file = picker.files[0]; picker.value = '';
      if (!file || !target) return;
      const item = target; target = null;
      try { await upload(item, file); } catch (error) { root.alert(error.message || String(error)); }
    });
    table.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-cal-action]');
      if (!button) return;
      const item = inventory().find((entry) => entry.id === button.dataset.calEquipment);
      if (!item) return;
      if (button.dataset.calAction === 'upload') { target = item; picker.click(); }
      if (button.dataset.calAction === 'remove' && root.confirm(`Remove the calibration paper for ${item.name}${item.serial ? ` S/N ${item.serial}` : ''}?`)) {
        try { await remove(item); } catch (error) { root.alert(error.message || String(error)); }
      }
    });
  }

  // ---- The printable set -------------------------------------------------------------

  let pdfLib = null;
  function loadPdfLib() {
    if (root.PDFLib) return Promise.resolve(root.PDFLib);
    if (pdfLib) return pdfLib;
    pdfLib = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = options?.pdfLibUrl || 'assets/pdf-lib.min.js';
      script.onload = () => (root.PDFLib ? resolve(root.PDFLib) : reject(new Error('The PDF tool did not load.')));
      script.onerror = () => { pdfLib = null; reject(new Error('The PDF tool could not be loaded. Check the connection and try again.')); };
      document.head.append(script);
    });
    return pdfLib;
  }

  // Standard PDF fonts only cover Latin-1 and a few symbols.
  const pdfText = (value) => String(value ?? '').replace(/[^\x20-\x7E -ÿ–—‘’“”•…]/g, '?');

  async function buildSet(items, job) {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 612, H = 792, M = 50, ink = rgb(0.12, 0.14, 0.16), muted = rgb(0.34, 0.38, 0.42), line = rgb(0.82, 0.85, 0.87), red = rgb(0.71, 0.27, 0.1);
    const fit = (text, size, f, width) => { let t = pdfText(text); while (t && f.widthOfTextAtSize(t, size) > width) t = t.slice(0, -2) + '…'; return t; };
    doc.setTitle(pdfText(`Calibration papers${job.jobNumber ? ` - ${job.jobNumber}` : ''}`));
    doc.setCreator('Grant G Solutions hydrotest recorder');

    // Cover sheet: what is in the set and whether each item is in calibration today.
    let page = doc.addPage([W, H]), y = H - M;
    page.drawText('Calibration records', { x: M, y: y - 18, size: 20, font: bold, color: ink }); y -= 30;
    page.drawText(pdfText(`${job.company || 'Grant G Solutions'} · prepared ${new Date().toLocaleDateString()}`), { x: M, y: y - 10, size: 10, font, color: muted }); y -= 30;
    const facts = [['Job number', job.jobNumber], ['Line', job.line], ['Location', job.location], ['Owner', job.owner], ['Contractor', job.contractor], ["Owner's rep / inspector", job.ownerRep]].filter(([, v]) => v);
    facts.forEach(([k, v]) => { page.drawText(pdfText(`${k}:`), { x: M, y, size: 10, font, color: muted }); page.drawText(fit(v, 10, font, W - M * 2 - 130), { x: M + 130, y, size: 10, font, color: ink }); y -= 15; });
    y -= 12;
    const cols = [['Equipment', M, 150], ['Serial', M + 155, 60], ['Range', M + 220, 70], ['Calibrated', M + 295, 70], ['Due', M + 370, 70], ['Paper', M + 445, 67]];
    cols.forEach(([t, x]) => page.drawText(t, { x, y, size: 9, font: bold, color: muted }));
    y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line }); y -= 14;
    const fetched = [];
    for (const item of items) {
      const paper = papers.get(item.id), status = due(item);
      let bytes = null;
      if (paper) {
        const response = await fetch(`${API}?action=file&equipment=${encodeURIComponent(item.id)}`);
        if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      }
      fetched.push({ item, paper, bytes });
      if (y < M + 40) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(fit(title(item), 9, font, 150), { x: cols[0][1], y, size: 9, font, color: ink });
      page.drawText(fit(item.serial || '—', 9, font, 60), { x: cols[1][1], y, size: 9, font, color: ink });
      page.drawText(fit(item.range || (item.capacity ? `${item.capacity} gal/stroke` : '—'), 9, font, 70), { x: cols[2][1], y, size: 9, font, color: ink });
      page.drawText(fit(status.calibrated ? status.calibrated.toLocaleDateString() : status.state === 'na' ? 'n/a' : '—', 9, font, 70), { x: cols[3][1], y, size: 9, font, color: ink });
      page.drawText(fit(status.dueAt ? `${status.text}${status.state === 'past' ? ' (past)' : ''}` : status.state === 'na' ? 'n/a' : '—', 9, status.state === 'past' ? bold : font, 70), { x: cols[4][1], y, size: 9, font: status.state === 'past' ? bold : font, color: status.state === 'past' ? red : ink });
      page.drawText(bytes ? 'Attached' : paper ? 'Could not load' : 'Not on file', { x: cols[5][1], y, size: 9, font, color: bytes ? ink : red });
      y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: line }); y -= 14;
    }
    const missing = fetched.filter((f) => !f.bytes && f.item.type !== 'pump').length;
    if (missing) { y -= 6; page.drawText(pdfText(`${missing} item${missing === 1 ? ' has' : 's have'} no calibration paper on file in the recorder.`), { x: M, y, size: 9, font, color: red }); }

    // Then each paper, in the order listed.
    for (const { item, paper, bytes } of fetched) {
      if (!bytes) continue;
      const caption = `${title(item)}${item.serial ? ` · S/N ${item.serial}` : ''}`;
      if (paper.mime === 'application/pdf') {
        try {
          const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
          if (source.isEncrypted) throw new Error('protected');
          const copied = await doc.copyPages(source, source.getPageIndices());
          copied.forEach((p) => doc.addPage(p));
          continue;
        } catch (_) {
          const note = doc.addPage([W, H]);
          note.drawText(fit(caption, 14, bold, W - M * 2), { x: M, y: H - M - 14, size: 14, font: bold, color: ink });
          note.drawText(fit(`This paper (${paper.file_name}) is a protected PDF and could not be combined. Print it separately.`, 10, font, W - M * 2), { x: M, y: H - M - 40, size: 10, font, color: red });
          continue;
        }
      }
      const image = paper.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const landscape = image.width > image.height * 1.15;
      const [pw, ph] = landscape ? [H, W] : [W, H];
      const p = doc.addPage([pw, ph]);
      p.drawText(fit(caption, 10, bold, pw - 72), { x: 36, y: ph - 30, size: 10, font: bold, color: muted });
      const scale = Math.min((pw - 72) / image.width, (ph - 84) / image.height);
      const w = image.width * scale, h = image.height * scale;
      p.drawImage(image, { x: (pw - w) / 2, y: (ph - 42 - h) / 2, width: w, height: h });
    }
    return doc.save();
  }

  // Dialog: tick the equipment going on this test (the test's own selections start ticked).
  // `tests`: the running tests ({ name, gauge }); with more than one, the dialog asks which
  // test the set is for (its equipment starts ticked and its job details go on the cover).
  function openSet(tests) {
    const dialog = document.getElementById('calibrationSet');
    if (!dialog) return;
    tests = (Array.isArray(tests) ? tests : [{ name: '', gauge: tests }]).filter((t) => t?.gauge);
    if (!tests.length) return;
    const picker = dialog.querySelector('.cal-set-test'), select = picker.querySelector('select');
    select.innerHTML = tests.map((t, i) => `<option value="${i}">${esc(t.name || `Test ${i + 1}`)}${t.gauge.testState.jobNumber ? ` · ${esc(t.gauge.testState.jobNumber)}` : ''}</option>`).join('');
    picker.hidden = tests.length < 2;
    select.onchange = () => { gauge = tests[Number(select.value)].gauge; tick(); };
    let gauge = tests[0].gauge;
    const items = inventory();
    const order = ['deadweight', 'digital_gauge', 'pressure_recorder', 'ambient_chart', 'pipe_chart', 'ground_chart', 'pump'];
    const sorted = [...items].sort((a, b) => (order.indexOf(a.type) - order.indexOf(b.type)) || String(a.name).localeCompare(String(b.name)));
    const tick = () => {
      const chosen = new Set(Object.values(gauge.testState.equipment || {}).filter(Boolean));
      dialog.querySelectorAll('.cal-set-list input').forEach((box) => { const item = sorted.find((i) => i.id === box.value); box.checked = chosen.has(box.value) && item?.type !== 'pump'; });
    };
    dialog.querySelector('.cal-set-list').innerHTML = sorted.length ? sorted.map((item) => {
      const paper = papers.get(item.id), status = due(item);
      return `<label class="cal-set-item"><input type="checkbox" value="${esc(item.id)}">`
        + `<span><b>${esc(title(item))}</b>${item.serial ? ` · S/N ${esc(item.serial)}` : ''}</span>`
        + `<small class="${paper ? '' : 'cal-missing'}">${paper ? 'Paper on file' : item.type === 'pump' ? 'No calibration' : 'No paper'}${status.state === 'past' ? ' · <b class="cal-missing">past due</b>' : status.dueAt ? ` · due ${esc(status.text)}` : ''}</small></label>`;
    }).join('') : '<p>No equipment in the library yet.</p>';
    dialog.querySelector('.cal-set-message').textContent = loadError ? `Calibration papers could not be loaded: ${loadError}` : '';
    dialog.onsubmit = async (event) => {
      event.preventDefault();
      if (event.submitter?.value === 'cancel') { dialog.close(); return; }
      const ids = [...dialog.querySelectorAll('.cal-set-list input:checked')].map((box) => box.value);
      const picked = sorted.filter((item) => ids.includes(item.id));
      const message = dialog.querySelector('.cal-set-message');
      if (!picked.length) { message.textContent = 'Tick at least one piece of equipment.'; return; }
      // Open the tab now (a click), then fill it once the PDF is ready, so it is not blocked.
      const win = root.open('', '_blank');
      const button = dialog.querySelector('[value="build"]');
      button.disabled = true; message.textContent = 'Building the PDF…';
      try {
        const t = gauge.testState, design = t.design || {};
        const bytes = await buildSet(picked, { jobNumber: t.jobNumber, line: design.lineName, location: t.location || design.projectLocation, owner: t.owner, contractor: t.contractor, ownerRep: t.ownerRep });
        const name = `Calibration papers${t.jobNumber ? ` - ${t.jobNumber}` : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = dialog.querySelector('.cal-set-download');
        link.href = url; link.download = name; link.hidden = false;
        if (win) win.location.href = url;
        message.textContent = `Ready: ${picked.length} item${picked.length === 1 ? '' : 's'}. It opened in a new tab to print; or download it below.`;
      } catch (error) {
        if (win) win.close();
        message.textContent = error.message || String(error);
      } finally { button.disabled = false; }
    };
    tick();
    dialog.querySelector('.cal-set-download').hidden = true;
    dialog.showModal();
  }

  function init(config) {
    options = config;
    if (config.table) bindLibrary(config.table);
    refresh();
  }

  root.HydroCalibration = { init, refresh, cell, due, openSet, buildSet, upload, loadPdfLib, title: (item) => title(item), papers: () => papers, maxBytes: () => maxBytes, loadError: () => loadError };
})(window);
