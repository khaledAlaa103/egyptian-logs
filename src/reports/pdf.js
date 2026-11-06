// PDF generation helpers.
//  * computeBreaks(): pure page-break planner (keeps blocks and heading+first block together).
//  * assemblePdf(): builds the PDF file with jsPDF from page images.
//  * elementToPdf(): renders a report DOM element to page images (html2canvas: the browser shapes the
//    Arabic text correctly) and assembles them. For vector text use the browser print path instead.
import { jsPDF } from 'jspdf';

/**
 * blocks: [{top, bottom, heading?, forceBefore?}] in px, sorted by top. pageH: usable page height in px.
 * Returns [{y0, y1}] slices covering [0, last bottom]. Blocks taller than a page are cut mid-block.
 */
export function computeBreaks(blocks, pageH) {
  if (!blocks.length) return [];
  const end = Math.max(...blocks.map((b) => b.bottom));
  const pages = [];
  let start = 0;
  const cut = (y) => { pages.push({ y0: start, y1: y }); start = y; };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.forceBefore && b.top > start + 1) cut(b.top);
    let guard = 0;
    while (b.bottom - start > pageH + 0.5 && guard++ < 1000) {
      if (b.top > start + 1) {
        // move the cut up to the heading that precedes this block, if any
        const prev = blocks[i - 1];
        const y = prev && prev.heading && prev.top > start + 1 ? prev.top : b.top;
        cut(y);
      } else cut(start + pageH); // block taller than a page: forced cut
    }
  }
  if (end > start + 0.5) pages.push({ y0: start, y1: end });
  return pages;
}

/** pages: [{dataUrl, w, h}] (px of the source image). Returns a Blob (application/pdf). */
export function assemblePdf(pages, { title = '', footerText = '', margin = 8, jpeg = true } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: title || 'Report', creator: 'WellLog Pro' });
  const pw = 210, ph = 297, usableW = pw - 2 * margin;
  pages.forEach((p, i) => {
    if (i > 0) doc.addPage();
    const h = (p.h / p.w) * usableW;
    doc.addImage(p.dataUrl, jpeg ? 'JPEG' : 'PNG', margin, margin, usableW, Math.min(h, ph - 2 * margin - 4), undefined, 'FAST');
    doc.setFontSize(8); doc.setTextColor(110);
    // footer uses Latin characters/digits only (the built-in PDF fonts cannot shape Arabic)
    doc.text(`${footerText}`, margin, ph - 4);
    doc.text(`${i + 1} / ${pages.length}`, pw - margin, ph - 4, { align: 'right' });
  });
  return doc.output('blob');
}

/** Render `root` (a laid-out DOM element, ideally 794 px wide) to a paginated PDF Blob. */
export async function elementToPdf(root, { title, footerText, scale = 2, usableMm = [194, 281] } = {}) {
  const { default: html2canvas } = await import('html2canvas');
  const rootRect = root.getBoundingClientRect();
  const canvas = await html2canvas(root, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: Math.ceil(rootRect.width) });
  const pageHcss = (usableMm[1] / usableMm[0]) * rootRect.width; // usable page height in css px at this width
  const blocks = [...root.querySelectorAll('[data-keep]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - rootRect.top, bottom: r.bottom - rootRect.top, heading: el.hasAttribute('data-heading'), forceBefore: el.hasAttribute('data-pagebreak') };
  }).sort((a, b) => a.top - b.top);
  const plan = computeBreaks(blocks, pageHcss);
  const pages = plan.map(({ y0, y1 }) => {
    const sy = Math.round(y0 * scale), sh = Math.max(1, Math.round((y1 - y0) * scale));
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = sh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
    return { dataUrl: c.toDataURL('image/jpeg', 0.92), w: c.width, h: c.height };
  });
  return { blob: assemblePdf(pages, { title, footerText }), pageCount: pages.length };
}
