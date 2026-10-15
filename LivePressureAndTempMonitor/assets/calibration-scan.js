/* Phone page for calibration papers: lists the equipment shared from the recording
   computer and scans each paper with the camera. Each picture is one page; pages can
   be turned or removed, get an optional black & white "scan look", and are saved as
   one PDF for that piece of equipment. A PDF or picture already on the phone can be
   uploaded instead. */
(function (root) {
  'use strict';
  const app = document.getElementById('calibrationApp');
  if (!app) return;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LABELS = { deadweight: 'Deadweight', digital_gauge: 'Digital gauge', pressure_recorder: 'Pressure recorder', ambient_chart: 'Ambient temperature chart', pipe_chart: 'Pipe temperature chart', ground_chart: 'Ground temperature chart', pump: 'Pump' };
  const ORDER = Object.keys(LABELS);
  const C = root.HydroCalibration;
  let items = [], shared = false;

  function render() {
    const status = $('calStatus'), list = $('calList');
    if (C.loadError()) { status.textContent = `Could not load calibration papers: ${C.loadError()}`; return; }
    if (!shared) { status.textContent = 'Loading equipment…'; return; }
    if (!items.length) { status.textContent = 'No equipment list yet. Open the Live recorder on the field laptop once (signed in) so it shares its equipment library.'; list.innerHTML = ''; return; }
    const papers = C.papers();
    const sorted = [...items].sort((a, b) => (ORDER.indexOf(a.type) - ORDER.indexOf(b.type)) || String(a.name).localeCompare(String(b.name)));
    const missing = sorted.filter((i) => i.type !== 'pump' && !papers.has(i.id)).length;
    status.textContent = missing ? `${missing} piece${missing === 1 ? '' : 's'} of equipment still need${missing === 1 ? 's' : ''} a paper.` : 'Every piece of equipment has its paper.';
    list.innerHTML = sorted.map((item) => {
      const paper = papers.get(item.id), due = C.due(item);
      const dueText = due.state === 'past' ? `<b class="cal-missing">Calibration past due ${esc(due.text)}</b>` : due.dueAt ? `Due ${esc(due.text)}` : due.state === 'na' ? '' : '<span class="cal-missing">No calibration date</span>';
      return `<article class="cal-card${paper ? ' has-paper' : ''}"><div><span class="eyebrow">${esc(LABELS[item.type] || item.type)}</span><h3>${esc(item.name)}${item.serial ? ` <small>S/N ${esc(item.serial)}</small>` : ''}</h3>
        <p>${paper ? `<a href="calibration-api.php?action=file&amp;equipment=${encodeURIComponent(item.id)}" target="_blank" rel="noopener">View paper</a> · ${esc(new Date(paper.uploaded_at).toLocaleDateString())}` : '<span class="cal-missing">No paper yet</span>'}${dueText ? ` · ${dueText}` : ''}</p></div>
        <div class="cal-card-actions"><button type="button" class="primary" data-scan="${esc(item.id)}">${paper ? 'Rescan' : 'Scan'}</button><button type="button" data-file="${esc(item.id)}">Upload file</button></div></article>`;
    }).join('');
  }

  // ---- Scanner ----
  let target = null, pages = [];
  const MAX_DIM = 2000;

  // Draws one page: turned, shrunk, and with the scan look, white paper and dark ink.
  async function draw(page, maxDim = MAX_DIM) {
    const bitmap = page.source;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale), turned = page.rotation % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = turned ? h : w; canvas.height = turned ? w : h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(page.rotation * Math.PI / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    if ($('calScanLook').checked) {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height), d = image.data, hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
      const total = d.length / 4, at = (share) => { let sum = 0; for (let v = 0; v < 256; v++) { sum += hist[v]; if (sum >= total * share) return v; } return 255; };
      const lo = at(0.02), hi = Math.max(lo + 30, at(0.6));
      for (let i = 0; i < d.length; i += 4) {
        const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
        const v = Math.max(0, Math.min(255, ((y - lo) / (hi - lo)) * 255));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(image, 0, 0);
    }
    return canvas;
  }

  async function renderPages() {
    const box = $('calPages');
    box.innerHTML = pages.map((p, i) => `<figure class="cal-page-thumb"><img alt="Page ${i + 1}"><figcaption>Page ${i + 1}<span><button type="button" data-turn="${i}" aria-label="Turn page ${i + 1}">↻</button><button type="button" data-drop="${i}" aria-label="Remove page ${i + 1}">✕</button></span></figcaption></figure>`).join('');
    $('calTakeLabel').textContent = `Take picture of page ${pages.length + 1}`;
    $('calSave').disabled = !pages.length;
    $('calSave').textContent = pages.length ? `Save ${pages.length} page${pages.length === 1 ? '' : 's'}` : 'Save';
    const imgs = box.querySelectorAll('img');
    for (let i = 0; i < pages.length; i++) {
      try { imgs[i].src = (await draw(pages[i], 600)).toDataURL('image/jpeg', 0.8); } catch (_) { imgs[i].alt = 'This picture could not be read'; }
    }
  }

  function openScanner(item) {
    target = item; pages = [];
    $('calScanTitle').textContent = C.title(item);
    $('calScanSub').textContent = item.serial ? `S/N ${item.serial}` : '';
    $('calScanMessage').textContent = C.papers().has(item.id) ? 'Saving replaces the paper on file.' : '';
    renderPages();
    $('calScanner').showModal();
  }

  // Each picture is shrunk once when added (a full camera photo is ~50 MB in memory).
  async function addPhotos(files) {
    for (const file of [...files]) {
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|heic|webp)$/i.test(file.name)) continue;
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
        const source = document.createElement('canvas');
        source.width = Math.round(bitmap.width * scale); source.height = Math.round(bitmap.height * scale);
        source.getContext('2d').drawImage(bitmap, 0, 0, source.width, source.height);
        bitmap.close?.();
        pages.push({ source, rotation: 0 });
      } catch (_) { $('calScanMessage').textContent = 'That picture could not be read. Try again, or use JPEG/PNG.'; }
    }
    renderPages();
  }

  async function buildPdf(maxDim, quality) {
    const { PDFDocument } = await C.loadPdfLib();
    const doc = await PDFDocument.create();
    doc.setTitle(`${C.title(target)}${target.serial ? ` S/N ${target.serial}` : ''} calibration`.replace(/[^\x20-\x7E -ÿ]/g, ''));
    for (const page of pages) {
      const canvas = await draw(page, maxDim);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      const image = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const landscape = image.width > image.height;
      const [pw, ph] = landscape ? [792, 612] : [612, 792];
      const s = Math.min((pw - 36) / image.width, (ph - 36) / image.height);
      doc.addPage([pw, ph]).drawImage(image, { x: (pw - image.width * s) / 2, y: (ph - image.height * s) / 2, width: image.width * s, height: image.height * s });
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  async function save() {
    if (!target || !pages.length) return;
    const message = $('calScanMessage'), button = $('calSave');
    button.disabled = true; message.textContent = 'Making the PDF…';
    try {
      let pdf = await buildPdf(MAX_DIM, 0.82);
      if (pdf.size > C.maxBytes()) pdf = await buildPdf(1500, 0.7);
      if (pdf.size > C.maxBytes()) throw new Error(`Those ${pages.length} pages are too large to save together (${(pdf.size / 1e6).toFixed(1)} MB). Save fewer pages.`);
      message.textContent = 'Uploading…';
      const name = `${C.title(target)}${target.serial ? ` ${target.serial}` : ''} calibration.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
      await C.upload(target, new File([pdf], name, { type: 'application/pdf' }));
      $('calScanner').close();
      $('calStatus').textContent = `Saved ${pages.length} page${pages.length === 1 ? '' : 's'} for ${C.title(target)}.`;
    } catch (error) { message.textContent = error.message || String(error); }
    finally { button.disabled = !pages.length; }
  }

  $('calCamera').addEventListener('change', (event) => { addPhotos(event.target.files); event.target.value = ''; });
  $('calLibrary').addEventListener('change', (event) => { addPhotos(event.target.files); event.target.value = ''; });
  $('calScanLook').addEventListener('change', renderPages);
  $('calPages').addEventListener('click', (event) => {
    const turn = event.target.closest('[data-turn]'), drop = event.target.closest('[data-drop]');
    if (turn) { pages[Number(turn.dataset.turn)].rotation = (pages[Number(turn.dataset.turn)].rotation + 90) % 360; renderPages(); }
    if (drop) { pages.splice(Number(drop.dataset.drop), 1); renderPages(); }
  });
  $('calSave').addEventListener('click', save);
  $('calCancel').addEventListener('click', () => $('calScanner').close());

  let fileTarget = null;
  $('calList').addEventListener('click', (event) => {
    const scan = event.target.closest('[data-scan]'), file = event.target.closest('[data-file]');
    if (scan) openScanner(items.find((i) => i.id === scan.dataset.scan));
    if (file) { fileTarget = items.find((i) => i.id === file.dataset.file); $('calFile').click(); }
  });
  $('calFile').addEventListener('change', async (event) => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || !fileTarget) return;
    $('calStatus').textContent = 'Uploading…';
    try { await C.upload(fileTarget, file); $('calStatus').textContent = `Saved the paper for ${C.title(fileTarget)}.`; }
    catch (error) { $('calStatus').textContent = error.message || String(error); }
  });
  $('calRefresh').addEventListener('click', () => C.refresh());

  C.init({ csrf: app.dataset.csrf, inventory: () => items, labels: LABELS, onChange: render,
    onEquipment: (list) => { items = Array.isArray(list.items) ? list.items : []; shared = true; } });
})(window);
