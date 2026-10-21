import { emptyState, validateState } from './model.js';

export const LEGACY_KEY = 'hifz-qalun:v1';
export async function openStorage() {
  if (!globalThis.indexedDB)
    throw new Error('Device storage is unavailable. Open Hifz in a regular Chrome window.');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('hifz-qalun', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Hifz windows, then try again.'));
  });
  db.onversionchange = () => db.close();
  function read(key = 'current') {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly');
      const request = tx.objectStore('state').get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Could not read device storage.'));
    });
  }
  function write(value, { expectedRevision = value.revision, restore = false } = {}) {
    const next = validateState(value);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      let conflict = false;
      const request = store.get('current');
      request.onsuccess = () => {
        const current = request.result;
        if ((current?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        if (restore && current) store.put(current, 'beforeRestore');
        next.revision = expectedRevision + 1;
        store.put(next, 'current');
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () =>
        reject(
          new Error(
            conflict
              ? 'Hifz changed in another window. Reload before saving.'
              : 'Could not save. Your change is still on screen. Free device space or export a backup, then try again.',
          ),
        );
      tx.onerror = () => {};
    });
  }
  async function load() {
    const stored = await read();
    if (stored !== undefined) return validateState(stored);
    // Never silently replace unreadable legacy data with an empty library.
    const raw = localStorage.getItem(LEGACY_KEY);
    const initial = raw == null ? emptyState() : validateState(JSON.parse(raw));
    initial.revision = 0;
    return write(initial);
  }
  function setVoiceKey(key) {
    if (typeof key !== 'string' || key.length > 500) throw new Error('Invalid Gemini key.');
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      if (key.trim()) tx.objectStore('state').put(key.trim(), 'voiceKey');
      else tx.objectStore('state').delete('voiceKey');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('Could not save the Gemini key on this device.'));
      tx.onerror = () => {};
    });
  }
  return { read, write, load, setVoiceKey, close: () => db.close() };
}
