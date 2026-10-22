import test from 'node:test';
import assert from 'node:assert/strict';
import { SURAHS } from '../surahs.js';
import { PAGE_ENDS, VERSE_TEXT } from '../shami-data.js';
import {
  verseId,
  verseReference,
  pageForVerse,
  rangeForPages,
  passageInfo,
  continueAfter,
} from '../reference.js';
import { parsePassageDraft } from '../voice.js';

test('Shami page ranges cover every numbered verse exactly once in canonical order', () => {
  let expectedId = 1;
  for (let page = 1; page <= 604; page++) {
    const range = rangeForPages(page);
    const info = passageInfo(range);
    assert.equal(info.firstId, expectedId);
    assert.equal(info.firstPage, page);
    assert.equal(info.lastPage, page);
    assert.equal(info.estimatedPages, 1);
    assert.equal(info.partial, false);
    expectedId = info.lastId + 1;
  }
  assert.equal(expectedId, 6215);
  assert.equal(PAGE_ENDS.length, 604);
  assert.equal(VERSE_TEXT.length, 6214);
  assert.equal(SURAHS[10].count, 122);
  assert.equal(SURAHS[72].count, 20);
  for (let id = 1; id <= 6214; id++) {
    const ref = verseReference(id);
    assert.equal(verseId(ref.surah, ref.ayah), id);
    assert.ok(VERSE_TEXT[id - 1].trim());
  }
});
test('known cross-surah pages and exact verse boundaries match the extracted Shami records', () => {
  assert.deepEqual(rangeForPages(106), { fromS: 4, fromA: 175, toS: 5, toA: 3 });
  assert.deepEqual(rangeForPages(604), { fromS: 112, fromA: 1, toS: 114, toA: 6 });
  const info = passageInfo({ fromS: 2, fromA: 1, toS: 2, toA: 50 });
  assert.equal(info.verseCount, 50);
  assert.equal(info.firstPage, 2);
  assert.equal(info.lastPage, 8);
  assert.ok(info.partial);
  assert.equal(info.estimatedPages * 4, Math.round(info.estimatedPages * 4));
  assert.ok(info.estimatedPages <= info.coveredPages);
  assert.throws(() => rangeForPages(0));
  assert.throws(() => rangeForPages(3, 2));
  assert.throws(() => verseId(2, 286));
  assert.throws(() => passageInfo({ fromS: 3, fromA: 1, toS: 2, toA: 50 }));
});
test('continue starts immediately after the furthest saved passage, including a shared page', () => {
  assert.equal(continueAfter([]), null);
  const next = continueAfter([{ fromS: 2, fromA: 1, toS: 2, toA: 10 }]);
  assert.equal(next.fromS, 2);
  assert.equal(next.fromA, 11);
  assert.equal(pageForVerse(verseId(next.toS, next.toA)), pageForVerse(verseId(2, 11)));
  assert.equal(continueAfter([{ toS: 114, toA: 6 }]), null);
});
const draft = {
  transcript: 'البقرة من واحد لخمسين',
  kind: 'ayahs',
  fromS: 2,
  fromA: 1,
  toS: 2,
  toA: 50,
  fromPage: null,
  toPage: null,
  clarification: '',
};
test('spoken passages are validated locally; uncertainty never becomes a default passage', () => {
  assert.deepEqual(parsePassageDraft(draft).range, { fromS: 2, fromA: 1, toS: 2, toA: 50 });
  assert.deepEqual(
    parsePassageDraft({ ...draft, kind: 'pages', fromPage: 106, toPage: 106 }).range,
    rangeForPages(106),
  );
  assert.deepEqual(parsePassageDraft({ ...draft, kind: 'surah', fromS: 73 }).range, {
    fromS: 73,
    fromA: 1,
    toS: 73,
    toA: 20,
  });
  assert.equal(parsePassageDraft({ ...draft, kind: 'unknown', clarification: 'أي سورة؟' }).range, null);
  assert.throws(() => parsePassageDraft({ ...draft, toA: 286 }));
  assert.throws(() => parsePassageDraft({ ...draft, fromS: null }));
  assert.throws(() => parsePassageDraft({ ...draft, fromA: 50, toA: 1 }));
  assert.throws(() => parsePassageDraft({ ...draft, kind: 'pages', fromPage: 1.5, toPage: 2 }));
});
