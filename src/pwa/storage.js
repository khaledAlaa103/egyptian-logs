// Storage helpers: ask the browser to keep the local database (IndexedDB) from being evicted, and report usage.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch { return false; }
}

export async function getStorageInfo() {
  const info = { supported: !!navigator.storage?.estimate, persisted: false, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); info.usage = e.usage ?? null; info.quota = e.quota ?? null; }
  } catch { /* storage API unavailable */ }
  return info;
}

export const formatBytes = (n) => {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
