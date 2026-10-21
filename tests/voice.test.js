import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceDraft, transcribeMistakes, MAX_AUDIO_BYTES } from '../voice.js';
import { openStorage } from '../storage.js';
import { backupOf } from '../model.js';
import { IDBFactory } from 'fake-indexeddb';

const item = { surah: 2, ayah: 80, type: 'recall', note: 'Forgot the continuation', said: '', correct: '' };
test('voice drafts preserve spoken descriptions and exact known references', () => {
  const draft = parseVoiceDraft({ transcript: 'نسيت كيفاش نكمل', mistakes: [item] });
  assert.equal(draft.transcript, 'نسيت كيفاش نكمل');
  assert.equal(draft.mistakes[0].ayah, 80);
  assert.equal(draft.mistakes[0].needsReferenceCheck, false);
});
test('uncertain or impossible references stay unknown instead of being clamped', () => {
  const draft = parseVoiceDraft({
    transcript: 'A mistake',
    mistakes: [
      { ...item, ayah: 286 },
      { ...item, surah: null, ayah: null },
    ],
  });
  assert.equal(draft.mistakes[0].ayah, 0);
  assert.equal(draft.mistakes[0].needsReferenceCheck, true);
  assert.equal(draft.mistakes[1].ayah, 0);
});
test('a model reference outside the session passage is cleared for manual verification', () => {
  const passage = { fromS: 3, fromA: 1, toS: 3, toA: 10 };
  const draft = parseVoiceDraft({ transcript: 'A mistake', mistakes: [item] }, { passage });
  assert.equal(draft.mistakes[0].surah, 3);
  assert.equal(draft.mistakes[0].ayah, 0);
  assert.equal(draft.mistakes[0].needsReferenceCheck, true);
});
test('malformed responses are rejected and empty descriptions are not saved', () => {
  assert.throws(() => parseVoiceDraft({ transcript: 'test', mistakes: [{ ...item, note: {} }] }));
  assert.throws(() => parseVoiceDraft({ mistakes: [] }));
  assert.deepEqual(
    parseVoiceDraft({ transcript: 'Silence', mistakes: [{ ...item, note: '', said: '', correct: '' }] })
      .mistakes,
    [],
  );
});
test('empty or oversized clips and missing keys fail before network access', async () => {
  await assert.rejects(() => transcribeMistakes(new Blob([]), { apiKey: 'test' }), /No audio/);
  await assert.rejects(() => transcribeMistakes(new Blob(['data'])), /Connect/);
  await assert.rejects(
    () => transcribeMistakes(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]), { apiKey: 'test' }),
    /10 MB/,
  );
});
test('Gemini credentials persist separately and are absent from exported review backups', async () => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage = { getItem: () => null };
  const store = await openStorage(),
    state = await store.load();
  const fakeKey = 'fake-private-key-for-the-hifz-test';
  await store.setVoiceKey(fakeKey);
  assert.equal(await store.read('voiceKey'), fakeKey);
  assert.equal(backupOf(await store.load()).includes(fakeKey), false);
  assert.equal((await store.load()).revision, state.revision);
  await store.setVoiceKey('');
  assert.equal(await store.read('voiceKey'), undefined);
  store.close();
});
