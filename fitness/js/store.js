// On-device storage: IndexedDB (falls back to localStorage). All data is loaded
// into memory at startup and written back per key on change. No server, no accounts.

const DB_NAME = 'liftlog';
const STORE = 'kv';
const KEYS = ['days', 'library', 'checkins', 'settings', 'report'];
const DEFAULTS = () => ({ days: {}, library: {}, checkins: [], settings: {}, report: null });

export const state = DEFAULTS();
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbPut(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function load() {
  try {
    db = await openDB();
    for (const k of KEYS) {
      const v = await idbGet(k);
      if (v !== undefined && v !== null) state[k] = v;
    }
  } catch {
    db = null;
    for (const k of KEYS) {
      try { const v = localStorage.getItem('liftlog:' + k); if (v) state[k] = JSON.parse(v); } catch { /* ignore */ }
    }
  }
  // Ask the browser not to evict our data under storage pressure.
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
}

const timers = {};
export function save(key) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => saveNow(key), 250);
}

export async function saveNow(key) {
  clearTimeout(timers[key]);
  // Structured clone strips any accidental non-serialisable values.
  const value = JSON.parse(JSON.stringify(state[key] ?? null));
  if (db) {
    try { await idbPut(key, value); return; } catch { /* fall through */ }
  }
  try { localStorage.setItem('liftlog:' + key, JSON.stringify(value)); } catch { /* quota */ }
}

export function flush() { for (const k of Object.keys(timers)) saveNow(k); }
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// ---------- Backup / restore ----------
export function exportData() {
  const { apiKey, ...settings } = state.settings || {}; // never put the API key in a backup file
  return {
    app: 'liftlog', version: 1, exportedAt: new Date().toISOString(),
    data: { days: state.days, library: state.library, checkins: state.checkins, settings, report: state.report },
  };
}

export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!obj || obj.app !== 'liftlog' || typeof obj.data !== 'object' || !obj.data) throw new Error('That file is not a Lift Log backup.');
  const d = obj.data;
  if (d.days && typeof d.days !== 'object') throw new Error('Backup is damaged (days).');
  if (d.checkins && !Array.isArray(d.checkins)) throw new Error('Backup is damaged (check-ins).');
  return obj;
}

export async function restoreData(obj) {
  const d = obj.data;
  const apiKey = state.settings?.apiKey;
  const fresh = DEFAULTS();
  state.days = d.days || fresh.days;
  state.library = d.library || fresh.library;
  state.checkins = d.checkins || fresh.checkins;
  state.settings = { ...(d.settings || {}), ...(apiKey ? { apiKey } : {}) };
  state.report = d.report || null;
  for (const k of KEYS) await saveNow(k);
}
