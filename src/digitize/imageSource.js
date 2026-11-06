// Browser-only helpers: decode images, render PDF pages (pdf.js, bundled locally, works offline).

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve({ img, url }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_DECODE')); };
    img.src = url;
  });
}

const canvasToBlob = (c, type = 'image/png') => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('ENCODE'))), type));

let pdfjsPromise = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      lib.GlobalWorkerOptions.workerSrc = worker;
      return lib;
    })();
  }
  return pdfjsPromise;
}

/** Renders one page of a PDF (1-based) to a PNG blob at ~200 dpi equivalent (scale 2.7). */
export async function renderPdfPage(file, pageNo = 1, scale = 2.7) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = doc.numPages;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), n));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const blob = await canvasToBlob(c);
  return { blob, width: c.width, height: c.height, pageCount: n, page: Math.min(Math.max(1, pageNo), n) };
}

/** Reads a user file into { blob, renderBlob, width, height, pageCount, page }. */
export async function readSourceFile(file, pageNo = 1) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const r = await renderPdfPage(file, pageNo);
    return { blob: file, renderBlob: r.blob, width: r.width, height: r.height, pageCount: r.pageCount, page: r.page, mime: 'application/pdf' };
  }
  const { img, url } = await loadImage(file);
  const out = { blob: file, renderBlob: null, width: img.naturalWidth, height: img.naturalHeight, pageCount: null, page: null, mime: file.type || 'image/png' };
  URL.revokeObjectURL(url);
  return out;
}
export { canvasToBlob };
