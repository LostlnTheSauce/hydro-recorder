(function (global) {
  'use strict';

  const scriptUrl = document.currentScript.src;
  const pdfLibraryUrl = new URL('pdf.min.mjs', scriptUrl).href;
  const pdfWorkerUrl = new URL('pdf.worker.min.mjs', scriptUrl).href;
  let pdfLibraryPromise = null;

  function pageLines(items, viewport) {
    const transform = Array.isArray(viewport?.transform) ? viewport.transform : [1, 0, 0, -1, 0, Number(viewport?.height) || 0];
    const positioned = items
      .filter((item) => String(item.str || '').trim())
      .map((item) => {
        const x = Number(item.transform?.[4]) || 0;
        const y = Number(item.transform?.[5]) || 0;
        return {
          text: String(item.str).trim(),
          x: (transform[0] * x) + (transform[2] * y) + transform[4],
          y: (transform[1] * x) + (transform[3] * y) + transform[5],
        };
      })
      .sort((a, b) => Math.abs(a.y - b.y) > 2.5 ? a.y - b.y : a.x - b.x);
    const lines = [];
    positioned.forEach((item) => {
      let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
      if (!line) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    });
    return lines
      .sort((a, b) => a.y - b.y)
      .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
      .join('\n');
  }

  async function loadPdfLibrary() {
    if (!pdfLibraryPromise) {
      pdfLibraryPromise = import(pdfLibraryUrl).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        return pdfjs;
      });
    }
    return pdfLibraryPromise;
  }

  async function extract(file) {
    if (!file || !/\.pdf$/i.test(file.name || '')) throw new Error('Choose an Atmos test design PDF.');
    if (!global.AtmosTestDesignParser) throw new Error('The test design parser did not load. Refresh this page and try again.');
    const pdfjs = await loadPdfLibrary();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const documentHandle = await task.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber += 1) {
      const page = await documentHandle.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(pageLines(content.items, page.getViewport({ scale: 1 })));
    }
    const parsed = global.AtmosTestDesignParser.parse(pages.join('\n'));
    return {
      ...parsed,
      data: { ...parsed.data, sourceFileName: file.name, importedAt: new Date().toISOString() },
      pageCount: documentHandle.numPages,
    };
  }

  global.AtmosTestDesignImporter = { extract };
})(window);
