import { SHAMI_SURAHS, PAGE_ENDS, VERSE_TEXT, VERSE_BANDS } from './shami-data.js';

export const REFERENCE_ID = 'qalun-kotteb-shami';
export const REFERENCE_NAME = 'قالون · المصحف الشامي';
const ends = SHAMI_SURAHS.reduce((list, s) => [...list, (list.at(-1) || 0) + s.count], []);
export function verseId(surah, ayah) {
  if (
    !Number.isInteger(surah) ||
    !Number.isInteger(ayah) ||
    surah < 1 ||
    surah > 114 ||
    ayah < 1 ||
    ayah > SHAMI_SURAHS[surah - 1].count
  )
    throw new Error('Choose a valid surah and ayah in the Shami Mushaf.');
  return (ends[surah - 2] || 0) + ayah;
}
export function verseReference(id) {
  if (!Number.isInteger(id) || id < 1 || id > 6214) throw new Error('Invalid verse reference.');
  const index = ends.findIndex((end) => id <= end);
  return { surah: index + 1, ayah: id - (ends[index - 1] || 0) };
}
export function pageForVerse(id) {
  verseReference(id);
  return PAGE_ENDS.findIndex((end) => id <= end) + 1;
}
export function rangeForPages(fromPage, toPage = fromPage) {
  if (
    !Number.isInteger(fromPage) ||
    !Number.isInteger(toPage) ||
    fromPage < 1 ||
    toPage > 604 ||
    fromPage > toPage
  )
    throw new Error('Choose pages 1–604, with the ending page after the start.');
  const start = verseReference((PAGE_ENDS[fromPage - 2] || 0) + 1);
  const end = verseReference(PAGE_ENDS[toPage - 1]);
  return { fromS: start.surah, fromA: start.ayah, toS: end.surah, toA: end.ayah };
}
export function passageInfo(p) {
  const firstId = verseId(p.fromS, p.fromA),
    lastId = verseId(p.toS, p.toA);
  if (firstId > lastId) throw new Error('The ending ayah must follow the starting ayah.');
  const firstPage = pageForVerse(firstId),
    lastPage = pageForVerse(lastId);
  let amount = 0,
    partial = false;
  for (let page = firstPage; page <= lastPage; page++) {
    const start = (PAGE_ENDS[page - 2] || 0) + 1,
      end = PAGE_ENDS[page - 1];
    const selectedStart = Math.max(start, firstId),
      selectedEnd = Math.min(end, lastId);
    if (selectedStart === start && selectedEnd === end) amount += 1;
    else {
      partial = true;
      const selected = VERSE_BANDS.slice(selectedStart - 1, selectedEnd);
      amount += Math.max(
        0,
        Math.min(
          1,
          (Math.max(...selected.map((b) => b[1])) - Math.min(...selected.map((b) => b[0]))) / 10000,
        ),
      );
    }
  }
  return {
    firstId,
    lastId,
    firstPage,
    lastPage,
    coveredPages: lastPage - firstPage + 1,
    verseCount: lastId - firstId + 1,
    estimatedPages: Math.max(0.25, Math.round(amount * 4) / 4),
    partial,
    firstText: VERSE_TEXT[firstId - 1],
    lastText: VERSE_TEXT[lastId - 1],
  };
}
export function continueAfter(passages) {
  if (!passages.length) return null;
  const last = Math.max(...passages.map((p) => verseId(p.toS, p.toA)));
  if (last === 6214) return null;
  const next = verseReference(last + 1),
    end = verseReference(PAGE_ENDS[pageForVerse(last + 1) - 1]);
  return { fromS: next.surah, fromA: next.ayah, toS: end.surah, toA: end.ayah };
}
