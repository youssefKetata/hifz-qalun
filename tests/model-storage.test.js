import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  emptyState,
  validateState,
  overlaps,
  parseBackup,
  backupOf,
  activeSessionPassages,
} from '../model.js';
import { openStorage, LEGACY_KEY } from '../storage.js';
import { SURAHS } from '../surahs.js';
const passage = {
  id: 'p',
  fromS: 2,
  fromA: 280,
  toS: 3,
  toA: 5,
  pages: 1.5,
  created: '2026-01-01',
  interval: 3,
  nextDue: '2026-10-21',
  reviews: [],
};
const populated = () => ({ ...emptyState(), passages: [structuredClone(passage)] });
function resetStorage(raw) {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage = { getItem: (key) => (key === LEGACY_KEY ? (raw ?? null) : null) };
}
test('Qalun metadata copies agree and contain 114 surahs / 6214 ayat', async () => {
  const { readFile } = await import('node:fs/promises');
  const json = JSON.parse(await readFile(new URL('../surahs-qalun.json', import.meta.url)));
  assert.equal(SURAHS.length, 114);
  assert.equal(
    SURAHS.reduce((n, s) => n + s.count, 0),
    6214,
  );
  assert.deepEqual(json.surahs, SURAHS);
});
test('valid cross-surah and fractional ranges round-trip', () => {
  const result = parseBackup(backupOf(populated()));
  assert.equal(result.passages[0].pages, 1.5);
  assert.equal(result.passages[0].toS, 3);
  assert.ok(overlaps(passage, { ...passage, fromS: 3, fromA: 5, toS: 3, toA: 10 }));
  assert.ok(!overlaps(passage, { ...passage, fromS: 3, fromA: 6, toS: 3, toA: 10 }));
});
test('imports reject impossible references, malformed dates, duplicate IDs, invalid histories, and unsupported versions', () => {
  for (const patch of [
    { fromA: 286 },
    { pages: -1 },
    { pages: 0.3 },
    { created: '2026-02-30' },
    { toS: 1 },
    { interval: 0 },
    { reviews: [{ rating: 'unknown', date: '2026-10-01' }] },
  ]) {
    assert.throws(() => validateState({ ...emptyState(), passages: [{ ...passage, ...patch }] }));
  }
  assert.throws(() => validateState({ ...populated(), passages: [passage, passage] }));
  assert.throws(() => parseBackup({ type: 'hifz-qalun-backup', version: 99, data: populated() }));
});
test('v1 backup migration preserves histories, dates, pauses, notes and mistakes', () => {
  const data = {
    passages: [
      { ...passage, paused: true, note: 'page 49', reviews: [{ date: '2026-10-01', rating: 'good' }] },
    ],
    mistakes: [{ id: 'm', surah: 2, ayah: 281, date: '2026-10-01', said: 'ا', correct: 'ب' }],
    settings: { custom: true },
  };
  const migrated = parseBackup({ type: 'hifz-qalun-backup', version: 1, data });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.passages[0].paused, true);
  assert.deepEqual(migrated.passages[0].reviews, data.passages[0].reviews);
  assert.equal(migrated.mistakes[0].correct, 'ب');
  assert.equal(migrated.settings.custom, true);
});
test('IndexedDB migrates legacy data once and leaves its original copy intact', async () => {
  const original = JSON.stringify(populated());
  resetStorage(original);
  const store = await openStorage();
  const initial = await store.load();
  assert.equal(initial.passages.length, 1);
  await store.write({ ...initial, passages: [] });
  assert.equal((await store.load()).passages.length, 0);
  assert.equal(localStorage.getItem(LEGACY_KEY), original);
  store.close();
});
test('corrupt legacy data is reported instead of silently replaced', async () => {
  resetStorage('{bad json');
  const store = await openStorage();
  await assert.rejects(() => store.load());
  assert.equal(await store.read(), undefined);
  store.close();
});
test('concurrent windows cannot overwrite newer data and restore keeps a recovery copy', async () => {
  resetStorage();
  const store = await openStorage(),
    initial = await store.load();
  const withPassage = await store.write({ ...initial, passages: [passage] });
  await assert.rejects(() => store.write(initial), /another window/);
  assert.equal((await store.read()).passages.length, 1);
  const restored = await store.write({ ...withPassage, passages: [] }, { restore: true });
  assert.equal(restored.passages.length, 0);
  assert.equal((await store.read('beforeRestore')).passages.length, 1);
  store.close();
});
test('invalid saves leave the committed state untouched', async () => {
  resetStorage();
  const store = await openStorage(),
    initial = await store.load();
  await assert.rejects(async () => store.write({ ...initial, passages: [{ ...passage, pages: -1 }] }));
  assert.deepEqual(await store.read(), initial);
  store.close();
});
test('session resumption excludes completed, removed, paused, and no-longer-due passages', () => {
  const data = populated();
  data.session = {
    ids: ['missing', 'p'],
    completedIds: [],
    startedAt: '2026-10-21',
    draft: { passageId: 'p', note: 'hesitation' },
  };
  assert.equal(activeSessionPassages(data, '2026-10-21').length, 1);
  data.passages[0].paused = true;
  assert.equal(activeSessionPassages(data, '2026-10-21').length, 0);
});
