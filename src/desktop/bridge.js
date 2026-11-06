// Access to the desktop (Electron) features exposed by electron/preload.cjs. In a browser everything here is a no-op.
export const desktop = () => (typeof window !== 'undefined' && window.desktop && window.desktop.isDesktop ? window.desktop : null);
export const isDesktop = () => !!desktop();

const toBytes = async (content) => {
  if (typeof content === 'string') return content;
  if (content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return content;
};

/** Native Save dialog; resolves { ok, canceled, path }. Also notifies the UI ("desktop:saved"). */
export async function saveWithDesktop(filename, content) {
  const d = desktop();
  const res = await d.saveFile({ defaultName: filename, data: await toBytes(content) });
  if (res?.ok) window.dispatchEvent(new CustomEvent('desktop:saved', { detail: { path: res.path } }));
  return res;
}
