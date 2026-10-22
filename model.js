import { SURAHS } from './surahs.js';
import { addDays, dateISO } from './schedule.js';
import { REFERENCE_ID } from './reference.js';

export const SCHEMA_VERSION = 2;
export const EDITION = 'قالون عن نافع · المصحف الشامي · 604 صفحات';
export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    passages: [],
    mistakes: [],
    revisionHistory: [],
    session: null,
    settings: { maxInterval: 30, edition: EDITION, reference: REFERENCE_ID },
  };
}
const fail = (message) => {
  throw new Error(message);
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, label, max = 10000) =>
  typeof value === 'string' && value.length <= max ? value : fail(`Invalid ${label}.`);
const integer = (value, min, max, label) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fail(`Invalid ${label}.`);
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
const day = (value, label) => (validDate(value) ? value : fail(`Invalid ${label}.`));
const optionalDay = (value, label) => (value == null ? undefined : day(value, label));
function reference(surah, ayah, label, allowUnknown = false) {
  integer(surah, 1, 114, `${label} surah`);
  integer(ayah, allowUnknown ? 0 : 1, SURAHS[surah - 1].count, `${label} ayah`);
}
const position = (s, a) => s * 1000 + a;
export function overlaps(a, b) {
  return (
    position(a.fromS, a.fromA) <= position(b.toS, b.toA) &&
    position(b.fromS, b.fromA) <= position(a.toS, a.toA)
  );
}
export function inPassage(p, surah, ayah) {
  return (
    position(surah, ayah) >= position(p.fromS, p.fromA) && position(surah, ayah) <= position(p.toS, p.toA)
  );
}
export function validatePassage(p) {
  if (!object(p)) fail('Invalid passage.');
  text(p.id, 'passage ID', 200);
  if (!p.id) fail('A passage ID is missing.');
  reference(p.fromS, p.fromA, 'starting');
  reference(p.toS, p.toA, 'ending');
  if (position(p.fromS, p.fromA) > position(p.toS, p.toA)) fail('The end must follow the start.');
  if (!Number.isFinite(p.pages) || p.pages < 0.25 || p.pages > 604 || !Number.isInteger(p.pages * 4))
    fail('Use page amounts in steps of 0.25.');
  day(p.created, 'memorization date');
  integer(p.interval, 1, 3650, 'review interval');
  const nextDue = day(p.nextDue || p.created, 'next due date');
  optionalDay(p.lastReviewed, 'last review date');
  if (p.ease != null && !['easy', 'good', 'hard'].includes(p.ease)) fail('Invalid recall rating.');
  if (p.paused != null && typeof p.paused !== 'boolean') fail('Invalid pause setting.');
  if (p.reviews != null && !Array.isArray(p.reviews)) fail('Invalid review history.');
  const reviews = (p.reviews || []).map((r) => {
    if (!object(r) || !['easy', 'good', 'hard'].includes(r.rating)) fail('Invalid review history rating.');
    day(r.date, 'review date');
    if (r.interval != null) integer(r.interval, 1, 3650, 'history interval');
    return { ...r };
  });
  return {
    ...p,
    nextDue,
    reviews,
    paused: p.paused || false,
    note: text(p.note ?? '', 'passage note'),
    hardCount: integer(p.hardCount ?? 0, 0, Number.MAX_SAFE_INTEGER, 'difficulty count'),
  };
}
function validateMistake(m) {
  if (!object(m)) fail('Invalid mistake.');
  text(m.id, 'mistake ID', 200);
  if (!m.id) fail('A mistake ID is missing.');
  reference(m.surah, m.ayah || 0, 'mistake', true);
  day(m.date, 'mistake date');
  optionalDay(m.lastRevisited, 'practice date');
  if (m.resolved != null && typeof m.resolved !== 'boolean') fail('Invalid mistake status.');
  const type = m.type || 'other';
  if (!['substitution', 'ending', 'recall', 'order', 'other'].includes(type)) fail('Invalid mistake type.');
  return {
    ...m,
    type,
    ayah: m.ayah || 0,
    nextDue: day(m.nextDue || addDays(m.date, 1), 'mistake due date'),
    revisits: integer(m.revisits ?? 0, 0, 100000, 'practice count'),
    resolved: m.resolved || false,
    note: text(m.note ?? '', 'mistake note'),
    said: text(m.said ?? '', 'spoken words'),
    correct: text(m.correct ?? '', 'correction'),
  };
}
function uniqueIds(items, label) {
  if (new Set(items.map((x) => x.id)).size !== items.length) fail(`Duplicate ${label} IDs.`);
}
export function validateState(input) {
  if (!object(input) || !Array.isArray(input.passages) || !Array.isArray(input.mistakes))
    fail('This is not valid Hifz data.');
  if (input.schemaVersion != null && ![1, 2].includes(input.schemaVersion))
    fail('This data needs a newer Hifz version.');
  const passages = input.passages.map(validatePassage),
    mistakes = input.mistakes.map(validateMistake);
  uniqueIds(passages, 'passage');
  uniqueIds(mistakes, 'mistake');
  const settings = object(input.settings) ? input.settings : {};
  const maxInterval = integer(settings.maxInterval ?? 30, 7, 60, 'maximum interval');
  let session = null;
  if (input.session != null) {
    const s = input.session;
    if (
      !object(s) ||
      !Array.isArray(s.ids) ||
      !Array.isArray(s.completedIds) ||
      s.ids.some((id) => typeof id !== 'string') ||
      s.completedIds.some((id) => !s.ids.includes(id)) ||
      new Set(s.ids).size !== s.ids.length ||
      new Set(s.completedIds).size !== s.completedIds.length
    )
      fail('Invalid review session.');
    day(s.startedAt, 'session date');
    const draft = s.draft || {};
    if (!object(draft)) fail('Invalid session draft.');
    session = {
      ids: [...s.ids],
      completedIds: [...s.completedIds],
      startedAt: s.startedAt,
      draft: {
        passageId: text(draft.passageId ?? '', 'draft passage ID', 200),
        note: text(draft.note ?? '', 'draft note'),
      },
    };
  }
  if (input.revisionHistory != null && !Array.isArray(input.revisionHistory))
    fail('Invalid revision history.');
  return {
    ...input,
    schemaVersion: SCHEMA_VERSION,
    revision: integer(input.revision ?? 0, 0, Number.MAX_SAFE_INTEGER, 'data revision'),
    passages,
    mistakes,
    session,
    revisionHistory: input.revisionHistory || [],
    settings: { ...settings, maxInterval, edition: EDITION, reference: REFERENCE_ID },
  };
}
export function parseBackup(value) {
  const backup = typeof value === 'string' ? JSON.parse(value) : value;
  if (!object(backup) || backup.type !== 'hifz-qalun-backup' || ![1, 2].includes(backup.version))
    fail('Choose a supported Hifz JSON backup.');
  return validateState(backup.data);
}
export function backupOf(state) {
  return JSON.stringify(
    { type: 'hifz-qalun-backup', version: 2, exportedAt: new Date().toISOString(), data: state },
    null,
    2,
  );
}
export function activeSessionPassages(state, today = dateISO()) {
  const s = state.session;
  if (!s) return [];
  return s.ids
    .filter((id) => !s.completedIds.includes(id))
    .map((id) => state.passages.find((p) => p.id === id))
    .filter((p) => p && !p.paused && p.lastReviewed !== today && p.nextDue <= today);
}
