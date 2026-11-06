// JSON-safe (de)serialisation of records that may contain Blobs (log images, PDFs).
// A Blob field becomes { __blob: "data:<mime>;base64,..." } and is restored on import.

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const mime = /data:([^;]*)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function encodeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Blob ? { __blob: await blobToDataUrl(v) } : v;
  }
  return out;
}

export function decodeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === 'object' && typeof v.__blob === 'string' ? dataUrlToBlob(v.__blob) : v;
  }
  return out;
}

export const encodeRows = (rows) => Promise.all(rows.map(encodeRow));
export const decodeRows = (rows) => rows.map(decodeRow);
