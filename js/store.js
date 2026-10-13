// Mémorisation locale (IndexedDB) des alignements et (localStorage) des paramètres.
const DB = 'nez-de-quai', STORE = 'files';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
}
export async function saveAlignments(files) {
  try { await tx('readwrite', (s) => s.put(files.map((f) => ({ name: f.name, bytes: f.bytes })), 'alignments')); } catch (e) { console.warn(e); }
}
export async function loadAlignments() {
  try { return (await tx('readonly', (s) => s.get('alignments'))) || []; } catch { return []; }
}
export async function forgetAlignments() {
  try { await tx('readwrite', (s) => s.delete('alignments')); } catch (e) { console.warn(e); }
}
export function loadParams(defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('ndq-params') || '{}') }; } catch { return { ...defaults }; }
}
export function saveParams(p) {
  try { localStorage.setItem('ndq-params', JSON.stringify(p)); } catch { /* stockage indisponible */ }
}
