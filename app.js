import { SURAHS, surah, passageLabel } from './surahs.js';
import {
  dateISO,
  addDays,
  daysBetween,
  dueQueue,
  phase,
  reviewInterval,
  ratePassage,
  pendingMistakes,
} from './schedule.js';
import {
  EDITION,
  validateState,
  validatePassage,
  overlaps,
  inPassage,
  parseBackup,
  backupOf,
  activeSessionPassages,
} from './model.js';
import { openStorage, LEGACY_KEY } from './storage.js';
import { VoiceRecorder, transcribeMistakes, transcribePassage } from './voice.js';
import { passageInfo, rangeForPages, continueAfter, REFERENCE_NAME } from './reference.js';

const micIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
let voiceKey = '',
  voiceSession = null;

const $ = (selector, base = document) => base.querySelector(selector);
const safe = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const uid = () => crypto.randomUUID();
const fmt = (number) => Number(number.toFixed(2)).toString();
const sumPages = (passages) => passages.reduce((sum, p) => sum + p.pages, 0);
const friendly = (day) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ratingNames = { hard: 'Difficult', good: 'Good', easy: 'Easy' };
const types = {
  recall: 'نسيان المتابعة',
  substitution: 'استبدال كلمة',
  ending: 'خطأ في آخر الآية أو الضمير',
  order: 'خطأ في الترتيب',
  other: 'أخرى',
};
let state,
  storage,
  view = 'today',
  busy = false,
  pending = 0,
  saveQueue = Promise.resolve();
let libraryFilter = 'all',
  mistakeFilter = 'practice',
  lastDay = dateISO(),
  installPrompt,
  registration;
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('hifz-data') : null;

// Reserve the real fixed-bar height for every page, including empty states.
// Measuring also covers text scaling, orientation changes, and safe-area padding.
function syncNavigationSpace() {
  const navigation = $('.navigation');
  const height =
    getComputedStyle(navigation).position === 'fixed'
      ? Math.ceil(navigation.getBoundingClientRect().height)
      : 0;
  document.documentElement.style.setProperty('--navigation-clearance', `${height}px`);
}
if ('ResizeObserver' in globalThis)
  new ResizeObserver(syncNavigationSpace).observe($('.navigation'), { box: 'border-box' });
window.addEventListener('resize', syncNavigationSpace);
syncNavigationSpace();

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}
function error(message) {
  $('#save-error').hidden = false;
  $('#save-error').innerHTML = `${safe(message)} <button data-action="reload">Reload Hifz</button>`;
  if ($('#modal').open) {
    $('#modal-error').textContent = message;
    $('#modal-error').hidden = false;
  }
}
// Mutate a copy, commit atomically, then report success. Failed writes leave forms open.
function change(mutator, { renderAfter = true, restore = false } = {}) {
  pending++;
  const task = saveQueue
    .then(async () => {
      const next = structuredClone(state);
      await mutator(next);
      state = await storage.write(validateState(next), { expectedRevision: state.revision, restore });
      $('#save-error').hidden = true;
      channel?.postMessage({ revision: state.revision });
      if (renderAfter) render();
      return true;
    })
    .catch((reason) => {
      error(reason.message);
      return false;
    })
    .finally(() => pending--);
  saveQueue = task;
  return task;
}
function pageHeading(title, subtitle, eyebrow = 'YOUR DAILY PRACTICE', action = '') {
  return `<header class="page-heading"><div class="eyebrow">${safe(eyebrow)}</div><div class="row between"><h1>${title}</h1>${action}</div>${subtitle ? `<p class="lede">${subtitle}</p>` : ''}</header>`;
}
function empty(title, description, action = '') {
  return `<div class="empty"><div class="empty-symbol" aria-hidden="true">۞</div><h2>${title}</h2><p>${description}</p>${action}</div>`;
}
function badge(p, day = dateISO()) {
  const late = p.nextDue < day;
  const name = late ? `${daysBetween(p.nextDue, day)}d overdue` : phase(p, day);
  return `<span class="tag ${late ? 'overdue' : phase(p, day) === 'Fresh' ? 'fresh' : p.ease === 'hard' ? 'weak' : ''}">${safe(name)}</span>`;
}
function nextLabel(p, day = dateISO()) {
  if (p.paused) return 'Paused';
  if (p.nextDue <= day) return p.nextDue === day ? 'Due today' : `Due ${friendly(p.nextDue)}`;
  return `Next ${friendly(p.nextDue)}`;
}
function queueRow(p, i) {
  return `<button class="passage-row" data-action="review-one" data-id="${safe(p.id)}" aria-label="Review ${safe(passageLabel(p))}"><span class="row-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span class="passage-info"><span class="passage-title" lang="ar">${safe(passageLabel(p))}</span><span class="passage-sub" style="display:block">${fmt(p.pages)} page${p.pages === 1 ? '' : 's'} · ${phase(p)}${p.note ? ` · ${safe(p.note)}` : ''}</span></span>${badge(p)}<span class="chevron" aria-hidden="true">›</span></button>`;
}
function renderToday() {
  const day = dateISO();
  const due = dueQueue(state.passages, day);
  const weak = pendingMistakes(state.mistakes, day);
  const remaining = activeSessionPassages(state, day);
  const hasPassages = state.passages.length > 0;
  const completed = state.passages.filter((p) => p.lastReviewed === day).length;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return `<div class="today-minimal"><header class="today-heading"><div><p class="eyebrow">${safe(date)}</p><h1>Today's revision</h1></div><button class="mic-button" data-action="voice-mistake" aria-label="Record a mistake">${micIcon}</button></header>
    ${due.length ? `<section class="today-load" aria-label="Today's review load"><div><strong class="hero-number">${fmt(sumPages(due))}</strong><span class="muted"> pages · ${due.length} passage${due.length === 1 ? '' : 's'}</span></div><button class="primary wide" data-action="start">${remaining.length ? 'Continue revision' : 'Start revision'} <span aria-hidden="true">→</span></button></section><div class="queue">${due.map(queueRow).join('')}</div>` : hasPassages ? `<section class="today-done"><span class="done-mark" aria-hidden="true">✓</span><h2>You're caught up.</h2><p class="muted">${completed ? `${completed} passage${completed === 1 ? '' : 's'} reviewed today.` : 'Nothing scheduled for today.'}</p></section>` : `<section class="today-empty"><p class="muted">Add the passages you have memorized to begin.</p><button class="primary wide" data-action="add-passage">Add your first passage</button></section>`}
    ${weak.length ? `<section class="today-weak"><div class="section-heading"><h2>Mistakes to revisit <span class="count">${weak.length}</span></h2></div><div class="stack">${weak.map((m) => mistakeCard(m, true)).join('')}</div></section>` : ''}
    </div>`;
}
function renderLibrary() {
  const filtered = state.passages
    .filter((p) => libraryFilter === 'all' || (libraryFilter === 'paused' ? p.paused : !p.paused))
    .sort((a, b) => a.fromS - b.fromS || a.fromA - b.fromA);
  const overlapping = state.passages.some((p, i, all) =>
    all.slice(i + 1).some((other) => overlaps(p, other)),
  );
  return `${pageHeading('Your memorization', 'Every passage, kept with care.', 'WHAT YOU HAVE LEARNED', '<button class="primary" data-action="add-passage">＋ Add passage</button>')}
    <div class="library-summary"><div><strong>${fmt(sumPages(state.passages))}</strong><small>page equivalents</small></div><div><strong>${state.passages.length}</strong><small>memorized passages</small></div></div>
    ${overlapping ? '<div class="notice">Some imported passages overlap. Page totals include both entries; edit their boundaries to avoid counting the same memorization twice.</div>' : ''}
    <div class="filter-row" aria-label="Filter passages">${[
      ['all', 'All'],
      ['active', 'Active'],
      ['paused', 'Paused'],
    ]
      .map(
        ([id, name]) =>
          `<button data-action="filter-library" data-id="${id}" class="${libraryFilter === id ? 'active' : ''}" aria-pressed="${libraryFilter === id}">${name}</button>`,
      )
      .join('')}</div>
    ${filtered.length ? `<div class="library-grid stack">${filtered.map((p) => `<article class="library-card"><div class="row between"><div class="passage-title" lang="ar">${safe(passageLabel(p))}</div>${p.paused ? '<span class="tag">Paused</span>' : badge(p)}</div><p class="passage-sub">${fmt(p.pages)} pages · ${nextLabel(p)} · Every ${p.interval} day${p.interval === 1 ? '' : 's'}</p>${p.note ? `<p class="note">${safe(p.note)}</p>` : ''}<div class="card-actions"><button class="secondary" data-action="edit-passage" data-id="${safe(p.id)}">Edit</button><button class="text-button" data-action="pause" data-id="${safe(p.id)}">${p.paused ? 'Resume' : 'Pause'}</button><button class="text-button" data-action="remove-passage" data-id="${safe(p.id)}">Remove</button></div></article>`).join('')}</div>` : empty(state.passages.length ? 'Nothing here yet.' : 'A place for what you know.', state.passages.length ? 'Passages matching this filter will appear here.' : 'Add a quarter-page, a full page, or a passage across surahs. You decide what to memorize.', '<button class="primary" data-action="add-passage">Add memorized passage</button>')}`;
}
function mistakeTitle(m) {
  const passage = state.passages.find((p) => p.id === m.passageId);
  return passage
    ? passageLabel(passage)
    : `${surah(m.surah).name} · ${m.ayah ? `ayah ${m.ayah}` : 'ayah not specified'}`;
}
function mistakeCard(m, compact = false) {
  return `<article class="mistake-card"><div class="row between"><div class="passage-title" lang="ar">${safe(mistakeTitle(m))}</div><span class="tag ${m.resolved ? '' : 'weak'}">${m.resolved ? 'Solid' : 'Practice'}</span></div><p class="passage-sub">${safe(types[m.type] || 'Mistake')} · ${friendly(m.date)}${!m.resolved ? ` · ${m.nextDue <= dateISO() ? 'Due for practice' : `Next ${friendly(m.nextDue)}`}` : ''}</p>${m.said || m.correct ? `<div class="word-correction"><span class="arabic wrong" lang="ar">${safe(m.said)}</span><span aria-hidden="true">→</span><span class="arabic right" lang="ar">${safe(m.correct)}</span></div>` : ''}${m.note ? `<p class="note" dir="auto">${safe(m.note)}</p>` : ''}
    <div class="card-actions">${m.resolved ? '' : `<button class="secondary" data-action="practice" data-id="${safe(m.id)}" ${m.lastRevisited === dateISO() ? 'disabled' : ''}>${m.lastRevisited === dateISO() ? 'Practiced today' : 'Practiced again'}</button><button class="text-button" data-action="solid" data-id="${safe(m.id)}">Mark solid ✓</button>`}${compact ? '' : `<button class="text-button" data-action="edit-mistake" data-id="${safe(m.id)}">Edit</button><button class="text-button" data-action="remove-mistake" data-id="${safe(m.id)}">Remove</button>`}</div></article>`;
}
function renderMistakes() {
  const list = state.mistakes
    .filter((m) => mistakeFilter === 'all' || (mistakeFilter === 'solid' ? m.resolved : !m.resolved))
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.nextDue.localeCompare(b.nextDue));
  return `<div class="single-column">${pageHeading('Mistake journal', '', 'PRACTICE', '<button class="primary" data-action="add-mistake">＋ Log mistake</button>')}
    <div class="filter-row" aria-label="Filter mistakes">${[
      ['practice', 'Needs practice'],
      ['solid', 'Solid'],
      ['all', 'All'],
    ]
      .map(
        ([id, name]) =>
          `<button data-action="filter-mistakes" data-id="${id}" class="${mistakeFilter === id ? 'active' : ''}" aria-pressed="${mistakeFilter === id}">${name}</button>`,
      )
      .join(
        '',
      )}</div><div class="stack">${list.length ? list.map((m) => mistakeCard(m)).join('') : empty('Space to improve.', 'Log a forgotten ayah, a word, or a point of hesitation. It will return for practice.')}</div></div>`;
}
function renderHistory() {
  const records = state.passages.flatMap((p) => p.reviews.map((r) => ({ ...r, passage: p })));
  const days = [...new Set(records.map((r) => r.date))].sort().reverse();
  const week = Array.from({ length: 7 }, (_, i) => addDays(dateISO(), i - 6));
  const totals = week.map((day) =>
    records.filter((r) => r.date === day).reduce((n, r) => n + r.passage.pages, 0),
  );
  const max = Math.max(...totals, 1);
  return `<div class="single-column">${pageHeading('Review history', '', 'YOUR REVIEWS')}
    <div class="section-heading"><h2>The past seven days</h2><span class="small muted">Pages revised</span></div><div class="week-chart" role="img" aria-label="${week.map((day, i) => `${friendly(day)}: ${fmt(totals[i])} pages`).join('; ')}">${week.map((day, i) => `<div class="week-day"><strong>${fmt(totals[i])}</strong><div class="bar-track"><div class="bar" style="height:${Math.max(4, (totals[i] / max) * 60)}px"></div></div>${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</div>`).join('')}</div>
    <div class="stack">${
      days.length
        ? days
            .map(
              (day) =>
                `<section class="history-day"><h2>${day === dateISO() ? 'Today' : friendly(day)}</h2>${records
                  .filter((r) => r.date === day)
                  .map(
                    (r) =>
                      `<div class="history-row"><div class="passage-info"><div class="passage-title" lang="ar">${safe(passageLabel(r.passage))}</div><p class="passage-sub">${fmt(r.passage.pages)} pages${r.interval ? ` · Next interval: ${r.interval} day${r.interval === 1 ? '' : 's'}` : ''}</p></div><span class="tag ${r.rating === 'hard' ? 'weak' : ''}">${ratingNames[r.rating]}</span></div>`,
                  )
                  .join('')}</section>`,
            )
            .join('')
        : empty(
            'Your practice will show here.',
            'Complete a review to begin your history. No streak to protect; just a place to return.',
          )
    }</div></div>`;
}
function renderSession() {
  const session = state.session,
    remaining = activeSessionPassages(state),
    p = remaining[0];
  if (!session || !p) {
    const completed = session?.completedIds.length || 0;
    return `<div class="session-layout"><div class="session-end"><div class="empty-symbol" aria-hidden="true">۞</div><div class="eyebrow">A MOMENT WELL SPENT</div><h1 class="spacer">${completed ? 'Revision, remembered.' : 'Nothing left in this session.'}</h1><p>${completed ? `${completed} passage${completed === 1 ? '' : 's'} completed. Your next review dates are saved.` : 'Your daily plan has the latest passages ready for you.'}</p><a href="#today" class="primary">Back to today →</a></div></div>`;
  }
  const completed = session.completedIds.length,
    total = completed + remaining.length;
  const draft = session.draft.passageId === p.id ? session.draft.note : '';
  const weak = state.mistakes.filter(
    (m) => !m.resolved && (m.passageId === p.id || (m.ayah && inPassage(p, m.surah, m.ayah))),
  );
  return `<div class="session-layout"><div class="session-top"><a class="text-button" href="#today">← Pause & return</a><span class="eyebrow">PASSAGE ${completed + 1} OF ${total}</span></div><div class="progress" role="progressbar" aria-label="Session progress" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${total}"><span style="width:${(completed / total) * 100}%"></span></div>
    <section class="recitation-card">${badge(p)}<h1 class="arabic" lang="ar">${safe(surah(p.fromS).name)}${p.fromS !== p.toS ? ` ← ${safe(surah(p.toS).name)}` : ''}</h1><p class="ayah-range">${p.fromS === p.toS ? `Ayat ${p.fromA}–${p.toA}` : `${p.fromS}:${p.fromA} through ${p.toS}:${p.toA}`} · ${fmt(p.pages)} pages</p>${p.note ? `<p class="note">${safe(p.note)}</p>` : ''}<p class="muted">Recite independently, then check with your Mushaf.<br>Take your time. There is no timer.</p></section>
    ${weak.length ? `<aside class="session-weak"><strong>Keep an eye on these</strong>${weak.map((m) => `<p>${m.ayah ? `Ayah ${m.ayah} · ` : ''}${safe(m.note || m.correct || types[m.type])}</p>`).join('')}</aside>` : ''}
    <div class="session-notes"><label for="session-note">Anything to revisit? <span class="muted small">(optional)</span></label><textarea class="input" id="session-note" maxlength="10000" rows="3" placeholder="A hesitation, a forgotten ayah, a word to practise…">${safe(draft)}</textarea><p class="small" id="draft-status">Saved notes become a mistake entry when you finish this passage.</p><div class="session-voice-actions"><button class="secondary" data-action="session-voice">${micIcon} Speak a mistake</button><button class="text-button" data-action="session-mistake">Type a mistake</button></div></div>
    <div class="rating-heading"><h2>How did you recall it?</h2><p class="lede">Choose a rating to complete this passage.</p></div><div class="ratings">${[
      ['hard', 'Multiple mistakes or forgotten ayat'],
      ['good', 'Some hesitation, but remembered'],
      ['easy', 'No mistakes or hesitation'],
    ]
      .map(([rating, description]) => {
        const interval = reviewInterval(p, rating, dateISO(), state.settings.maxInterval);
        return `<button class="rating ${rating}" data-action="rate" data-rating="${rating}" data-id="${safe(p.id)}"><strong>${ratingNames[rating]}</strong><span>${description}</span><small>${interval === 1 ? 'Tomorrow' : `In ${interval} days`} · ${friendly(addDays(dateISO(), interval))}</small></button>`;
      })
      .join('')}</div></div>`;
}
function render() {
  if (!state) return;
  const scrollY = window.scrollY;
  $('#main').innerHTML = (
    {
      today: renderToday,
      library: renderLibrary,
      mistakes: renderMistakes,
      history: renderHistory,
      session: renderSession,
    }[view] || renderToday
  )();
  document.querySelectorAll('[data-view]').forEach((link) => {
    const selected = link.dataset.view === (view === 'session' ? 'today' : view);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo(0, scrollY);
  document.title = `Hifz — ${view === 'session' ? 'Review session' : view === 'library' ? 'Your memorization' : view[0].toUpperCase() + view.slice(1)}`;
}
function navigate(target) {
  if (location.hash === `#${target}`) {
    view = target;
    render();
    window.scrollTo(0, 0);
  } else location.hash = target;
}
function openModal(title, html) {
  voiceSession?.dispose();
  voiceSession = null;
  $('#modal-title').textContent = title;
  $('#modal-error').hidden = true;
  $('#modal-body').innerHTML = html;
  if (!$('#modal').open) $('#modal').showModal();
}
function formError(message) {
  const el = $('#form-error');
  if (el) {
    el.textContent = message;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest' });
  }
}
const errorArea = '<p id="form-error" class="form-error" role="alert" hidden></p>';
function surahOptions(selected) {
  return SURAHS.map(
    (s) =>
      `<option value="${s.id}" ${s.id === Number(selected) ? 'selected' : ''}>${s.id}. ${safe(s.name)}</option>`,
  ).join('');
}
function populateAyahs(select, surahId, preferred = 1, unknown = false) {
  select.innerHTML =
    (unknown ? '<option value="0">Not sure / whole passage</option>' : '') +
    Array.from({ length: surah(surahId).count }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join(
      '',
    );
  select.value = String(Math.max(unknown ? 0 : 1, Math.min(surah(surahId).count, preferred)));
}
function passageForm(id) {
  const original = state.passages.find((p) => p.id === id);
  const p = original || {
    fromS: 2,
    fromA: 1,
    toS: 2,
    toA: 5,
    pages: 0.5,
    created: dateISO(),
    interval: 1,
    note: '',
  };
  openModal(
    original ? 'Edit your passage' : 'Add memorization',
    `<p class="entry-intro">${original ? 'Check the boundaries, then save your changes.' : 'Tell Hifz what you know. Check it, then add it.'}</p>
    <div class="entry-switch" role="tablist" aria-label="Choose how to add a passage">
      <button type="button" role="tab" id="entry-tab-voice" data-entry-mode="voice" aria-controls="entry-voice" aria-selected="${!original}">${micIcon} Say it</button>
      <button type="button" role="tab" id="entry-tab-pages" data-entry-mode="pages" aria-controls="entry-pages" aria-selected="false">Pages</button>
      <button type="button" role="tab" id="entry-tab-ayahs" data-entry-mode="ayahs" aria-controls="entry-ayahs" aria-selected="${Boolean(original)}">Ayat</button>
    </div>
    ${!original && continueAfter(state.passages) ? `<button type="button" class="continue-passage text-button" id="continue-passage">Continue after my last passage <span aria-hidden="true">→</span></button>` : ''}
    <div id="entry-voice" role="tabpanel" aria-labelledby="entry-tab-voice" ${original ? 'hidden' : ''}>${voicePanel('passage')}<div id="passage-heard" class="passage-heard" hidden><div><span class="eyebrow">YOU SAID</span><p id="passage-heard-text" dir="auto"></p></div><button type="button" class="text-button" id="change-passage-description">Change</button></div></div>
    <form id="passage-form">${errorArea}
    <div id="entry-pages" role="tabpanel" aria-labelledby="entry-tab-pages" hidden><p class="help">Choose whole pages in the Shami Mushaf. For part of a page, use Ayat.</p><div class="form-row"><div class="field"><label for="from-page">From page</label><input class="input" id="from-page" type="number" inputmode="numeric" min="1" max="604" value="1"></div><div class="field"><label for="to-page">Through page</label><input class="input" id="to-page" type="number" inputmode="numeric" min="1" max="604" value="1"></div></div></div>
    <div id="entry-ayahs" role="tabpanel" aria-labelledby="entry-tab-ayahs" ${original ? '' : 'hidden'}><p class="help">The ending ayah is included.</p>
    <div class="field"><span>From</span><div class="range-grid"><select id="fromS" class="input" aria-label="Starting surah">${surahOptions(p.fromS)}</select><select id="fromA" class="input" aria-label="Starting ayah"></select></div></div>
    <div class="field"><span>To (inclusive)</span><div class="range-grid"><select id="toS" class="input" aria-label="Ending surah">${surahOptions(p.toS)}</select><select id="toA" class="input" aria-label="Ending ayah"></select></div></div>
    </div>
    <section id="passage-result" class="passage-result" aria-label="Passage to confirm" aria-live="polite" hidden></section>
    <div id="passage-review-details" ${original ? '' : 'hidden'}><details id="review-details" ${original ? 'open' : ''}><summary>Page amount & review details</summary><div class="spacer">
    <div class="form-row"><div class="field"><label for="pages">Amount on your pages</label><input id="pages" class="input" type="number" inputmode="decimal" min="0.25" max="604" step="0.25" value="${p.pages}" required><small>0.25, 0.5, 1, 1.5… pages</small></div><div class="field"><label for="created">First memorized on</label><input id="created" class="input" type="date" max="${dateISO()}" value="${p.created}" required></div></div>
    <div class="field"><label for="passage-note">Page number / note <span class="muted">(optional)</span></label><input id="passage-note" class="input" maxlength="10000" value="${safe(p.note)}" placeholder="e.g. page 12, lower half"></div>
    <details><summary class="small muted">${original ? 'Review interval' : 'Adding established memorization?'}</summary><div class="field spacer"><label for="interval">${original ? 'Current review interval' : 'Starting review interval'}</label><input id="interval" class="input" type="number" min="1" max="3650" step="1" value="${p.interval}" required><small>Days between reviews. Fresh passages rehearse daily during their first week.</small></div></details>
    </div></details></div><button id="passage-save" class="primary wide passage-save" type="submit" ${original ? '' : 'disabled'}>${original ? 'Save changes' : 'Confirm & add'} →</button><p class="entry-reference">${safe(REFERENCE_NAME)} · 604 pages</p></form>`,
  );
  let hasRange = Boolean(original),
    voiceBusy = false;
  populateAyahs($('#fromA'), p.fromS, p.fromA);
  populateAyahs($('#toA'), p.toS, p.toA);
  const currentRange = () => ({
    fromS: Number($('#fromS').value),
    fromA: Number($('#fromA').value),
    toS: Number($('#toS').value),
    toA: Number($('#toA').value),
  });
  function preview(suggestAmount = false) {
    const card = $('#passage-result');
    $('#passage-save').disabled = !hasRange || voiceBusy;
    card.hidden = !hasRange;
    $('#passage-review-details').hidden = !hasRange;
    if (!hasRange) return;
    try {
      const range = currentRange(),
        info = passageInfo(range);
      if (suggestAmount) $('#pages').value = String(info.estimatedPages);
      const amount = Number($('#pages').value);
      const pageLabel =
        info.firstPage === info.lastPage
          ? `Page ${info.firstPage}`
          : `Pages ${info.firstPage}–${info.lastPage}`;
      const excerpt = (text) => safe(text.length > 170 ? `${text.slice(0, 170)}…` : text);
      card.innerHTML = `<div class="passage-result-top"><span class="eyebrow">CHECK YOUR PASSAGE</span><button type="button" class="text-button" id="edit-passage-ayat">Edit ayat</button></div><h3 class="arabic" lang="ar">${safe(passageLabel(range))}</h3><p class="passage-map">${pageLabel} <span>· ${info.verseCount} ayat</span></p><div class="passage-bookends"><div><span>Starts with</span><p lang="ar" dir="rtl">${excerpt(info.firstText)}</p></div>${info.firstId !== info.lastId ? `<div><span>Ends with</span><p lang="ar" dir="rtl">${excerpt(info.lastText)}</p></div>` : ''}</div><div class="passage-amount"><div><strong>${Number.isFinite(amount) ? fmt(amount) : '—'} page${amount === 1 ? '' : 's'}</strong><small>${info.partial ? 'Estimated workload · adjustable below' : 'Page amount · adjustable below'}</small></div><button type="button" class="text-button" id="adjust-page-amount">Adjust</button></div>`;
      $('#edit-passage-ayat').onclick = () => chooseMode('ayahs');
      $('#adjust-page-amount').onclick = () => {
        $('#review-details').open = true;
        $('#pages').focus();
      };
      card.querySelectorAll('button').forEach((button) => {
        button.disabled = voiceBusy;
      });
      $('#form-error').hidden = true;
    } catch (reason) {
      card.hidden = true;
      $('#passage-save').disabled = true;
      formError(reason.message);
    }
  }
  function setRange(range) {
    $('#fromS').value = String(range.fromS);
    populateAyahs($('#fromA'), range.fromS, range.fromA);
    $('#toS').value = String(range.toS);
    populateAyahs($('#toA'), range.toS, range.toA);
    hasRange = true;
    preview(true);
  }
  function pageRange() {
    try {
      const range = rangeForPages(Number($('#from-page').value), Number($('#to-page').value));
      setRange(range);
    } catch (reason) {
      hasRange = false;
      preview();
      formError(reason.message);
    }
  }
  function chooseMode(mode) {
    if (voiceBusy) return;
    for (const tab of document.querySelectorAll('[data-entry-mode]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.entryMode === mode));
      tab.tabIndex = tab.dataset.entryMode === mode ? 0 : -1;
    }
    for (const name of ['voice', 'pages', 'ayahs']) $(`#entry-${name}`).hidden = name !== mode;
    if (mode === 'pages') {
      if (hasRange) {
        try {
          const info = passageInfo(currentRange());
          $('#from-page').value = info.firstPage;
          $('#to-page').value = info.lastPage;
        } catch {
          /* Keep the last valid page selection. */
        }
      }
      pageRange();
    } else if (mode === 'ayahs') {
      hasRange = true;
      preview(!original);
    }
  }
  document.querySelectorAll('[data-entry-mode]').forEach((tab) => {
    tab.onclick = () => chooseMode(tab.dataset.entryMode);
  });
  document.querySelectorAll('[data-entry-mode]').forEach((tab, index, tabs) => {
    tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    tab.onkeydown = (event) => {
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % 3
          : event.key === 'ArrowLeft'
            ? (index + 2) % 3
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? 2
                : null;
      if (next == null) return;
      event.preventDefault();
      chooseMode(tabs[next].dataset.entryMode);
      tabs[next].focus();
    };
  });
  $('#continue-passage')?.addEventListener('click', () => {
    setRange(continueAfter(state.passages));
    chooseMode('ayahs');
  });
  $('#from-page').oninput = pageRange;
  $('#to-page').oninput = pageRange;
  $('#pages').oninput = () => preview();
  $('#fromS').addEventListener('change', () => {
    populateAyahs($('#fromA'), Number($('#fromS').value));
    if (Number($('#toS').value) < Number($('#fromS').value)) {
      $('#toS').value = $('#fromS').value;
      populateAyahs($('#toA'), Number($('#toS').value));
    }
    preview(true);
  });
  $('#toS').addEventListener('change', () => {
    populateAyahs($('#toA'), Number($('#toS').value));
    preview(true);
  });
  $('#fromA').onchange = $('#toA').onchange = () => preview(true);
  preview();
  attachVoice(null, {
    kind: 'passage',
    onPassage(draft) {
      if (!draft.range) {
        hasRange = false;
        preview();
        return;
      }
      setRange(draft.range);
      $('.passage-voice-panel').hidden = true;
      $('#passage-heard').hidden = false;
      $('#passage-heard-text').textContent = draft.transcript;
    },
    onMode(mode) {
      voiceBusy = mode !== 'ready';
      if (mode === 'requesting' || mode === 'processing') hasRange = false;
      preview();
    },
  });
  $('#change-passage-description').onclick = () => {
    $('.passage-voice-panel').hidden = false;
    $('#passage-heard').hidden = true;
    $('#voice-record').focus();
  };
  $('#passage-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || voiceBusy || !hasRange) return;
    const values = {
      id: original?.id || uid(),
      fromS: Number($('#fromS').value),
      fromA: Number($('#fromA').value),
      toS: Number($('#toS').value),
      toA: Number($('#toA').value),
      pages: Number($('#pages').value),
      created: $('#created').value,
      interval: Number($('#interval').value),
      note: $('#passage-note').value.trim(),
    };
    try {
      validatePassage({ ...values, nextDue: dateISO() });
      if (values.created > dateISO()) throw new Error('Choose today or an earlier memorization date.');
      if (state.passages.some((other) => other.id !== values.id && overlaps(values, other)))
        throw new Error('This overlaps a saved passage. Edit that passage or choose a separate range.');
    } catch (reason) {
      formError(reason.message);
      return;
    }
    busy = true;
    const button = event.submitter;
    button.disabled = true;
    const saved = await change((next) => {
      if (original) {
        const index = next.passages.findIndex((item) => item.id === original.id);
        const previous = next.passages[index];
        next.passages[index] = {
          ...previous,
          ...values,
          nextDue:
            previous.interval !== values.interval
              ? previous.lastReviewed
                ? addDays(previous.lastReviewed, values.interval)
                : dateISO()
              : previous.nextDue,
        };
      } else next.passages.push({ ...values, nextDue: dateISO(), reviews: [], hardCount: 0, paused: false });
    });
    busy = false;
    button.disabled = false;
    if (saved) {
      $('#modal').close();
      navigate('library');
      toast(original ? 'Passage updated.' : 'Added to your revision plan.');
    }
  });
}
function voicePanel(kind = 'mistake') {
  const isPassage = kind === 'passage';
  return `<section class="voice-panel ${isPassage ? 'passage-voice-panel' : ''}" aria-label="${isPassage ? 'Voice passage entry' : 'Voice mistake logging'}">${isPassage ? '<p class="voice-example" lang="ar" dir="rtl">«البقرة من الآية 1 إلى 50»</p>' : ''}<button id="voice-record" class="voice-record" type="button" ${voiceKey ? '' : 'disabled'}>${micIcon}<span>${isPassage ? 'Say your passage' : 'Speak a mistake'}</span></button><p id="voice-status" class="small muted" role="status">${voiceKey ? (isPassage ? 'Arabic or English. Nothing is added until you confirm.' : 'تحدّث بالعربية. راجع المسودة ثم احفظها.') : 'Connect Gemini once to use the microphone.'}</p><div id="voice-key-setup" ${voiceKey ? 'hidden' : ''}><label class="field spacer"><span>Gemini API key</span><input id="voice-key" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your Hifz key"></label><button class="secondary" type="button" id="voice-key-save">Save key on this device</button></div><div class="voice-tools"><button class="text-button" type="button" id="voice-file-open">Choose audio instead</button><input type="file" id="voice-file" accept="audio/*,.webm" hidden><button class="text-button" type="button" id="voice-cancel" hidden>Cancel</button><button class="text-button" type="button" id="voice-retry" hidden>Retry transcription</button></div>${isPassage ? '<details class="phrase-entry"><summary>Or type it in your own words</summary><form id="passage-phrase-form"><label class="field"><span>Describe your passage</span><input id="passage-phrase" class="input" maxlength="1000" dir="auto" placeholder="Al-Baqarah, ayat 1 to 50" required></label><button class="secondary" type="submit">Understand passage</button></form></details>' : ''}<details id="voice-preview" hidden><summary class="small muted">Recording & transcript</summary><audio id="voice-playback" controls preload="metadata"></audio><p id="voice-transcript" class="note" dir="auto"></p><a id="voice-download" class="text-button" download="hifz-mistake.webm">Keep recording</a></details><p id="voice-draft-count" class="small" hidden></p></section>`;
}
function attachVoice(passage, { kind = 'mistake', onPassage, onMode = () => {} } = {}) {
  const isPassage = kind === 'passage';
  let alive = true,
    mode = 'ready',
    recorder,
    recording,
    audioURL,
    request,
    limit,
    operation = 0,
    queue = [],
    total = 0;
  const root = $('#modal-body');
  const status = $('#voice-status'),
    recordButton = $('#voice-record');
  const local = (selector) => $(selector, root);
  function setMode(next, message) {
    mode = next;
    if (!alive) return;
    status.textContent = message;
    recordButton.disabled = !voiceKey || next === 'requesting' || next === 'processing';
    recordButton.classList.toggle('recording', next === 'recording');
    $('span', recordButton).textContent =
      next === 'recording'
        ? 'Stop & transcribe'
        : next === 'processing'
          ? 'Transcribing…'
          : isPassage
            ? 'Say your passage'
            : 'Speak a mistake';
    local('#voice-cancel').hidden = !['recording', 'processing', 'requesting'].includes(next);
    local('#voice-retry').hidden = !recording || next !== 'ready';
    local('#voice-file').disabled = next !== 'ready';
    local('#voice-file-open').disabled = next !== 'ready';
    local(isPassage ? '#passage-form' : '#mistake-form')
      .querySelectorAll('input, select, textarea, button')
      .forEach((field) => {
        field.disabled = next !== 'ready';
      });
    root
      .querySelectorAll(
        '[data-entry-mode], #continue-passage, #passage-phrase-form input, #passage-phrase-form button',
      )
      .forEach((field) => {
        field.disabled = next !== 'ready';
      });
    onMode(next);
  }
  function applyDraft(draft) {
    local('#msurah').value = String(draft.surah);
    populateAyahs(local('#mayah'), draft.surah, draft.ayah, true);
    local('#mtype').value = draft.type;
    local('#mistake-note').value = draft.note;
    local('#msaid').value = draft.said;
    local('#mcorrect').value = draft.correct;
    if (draft.said || draft.correct) local('#msaid').closest('details').open = true;
    local('#voice-draft-count').hidden = false;
    local('#voice-draft-count').textContent =
      `${total - queue.length} of ${total} · ${draft.needsReferenceCheck ? 'Select/check the surah and ayah against your Mushaf.' : 'Check the reference and correction before saving.'}`;
  }
  async function processAudio(blob) {
    if (!alive) return;
    const currentOperation = ++operation;
    recording = blob;
    const isText = typeof blob === 'string';
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = isText ? null : URL.createObjectURL(blob);
    local('#voice-playback').hidden = local('#voice-download').hidden = isText;
    if (!isText) {
      local('#voice-playback').src = audioURL;
      local('#voice-download').href = audioURL;
      local('#voice-download').download =
        `hifz-${isPassage ? 'passage' : 'mistake'}.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('wav') ? 'wav' : blob.type.includes('mpeg') ? 'mp3' : 'webm'}`;
    }
    local('#voice-preview').hidden = false;
    request = new AbortController();
    const currentRequest = request;
    const timeout = setTimeout(() => currentRequest.abort(), 60000);
    setMode('processing', isPassage ? 'Understanding your passage…' : 'Gemini is drafting your mistake…');
    try {
      const draft = isPassage
        ? await transcribePassage(blob, { apiKey: voiceKey, signal: currentRequest.signal })
        : await transcribeMistakes(blob, {
            apiKey: voiceKey,
            surah: Number(local('#msurah').value),
            passage,
            signal: currentRequest.signal,
          });
      if (!alive || currentOperation !== operation) return;
      local('#voice-transcript').textContent = draft.transcript;
      if (isPassage) {
        onPassage(draft);
        setMode(
          'ready',
          draft.range ? 'Passage ready. Check the result below, then confirm.' : draft.clarification,
        );
        return;
      }
      queue = [...draft.mistakes];
      total = queue.length;
      if (!queue.length) {
        setMode('ready', 'No clear mistake was found. You can replay the recording or type a note.');
        return;
      }
      const first = queue.shift();
      applyDraft(first);
      setMode('ready', 'Draft ready. Check it, then save.');
    } catch (reason) {
      if (alive && currentOperation === operation)
        setMode(
          'ready',
          reason.name === 'AbortError'
            ? 'Transcription stopped. Your recording is still here; retry when ready.'
            : reason.message,
        );
    } finally {
      clearTimeout(timeout);
    }
  }
  async function stopAndProcess() {
    if (mode !== 'recording') return;
    clearTimeout(limit);
    setMode('processing', 'Preparing your recording…');
    const currentOperation = operation;
    const currentRecorder = recorder;
    try {
      const blob = await currentRecorder.stop();
      if (alive && currentOperation === operation) await processAudio(blob);
    } catch {
      if (alive && currentOperation === operation)
        setMode('ready', 'Could not finish this recording. Please try again.');
    }
  }
  async function start() {
    if (!voiceKey || mode !== 'ready') return;
    if (queue.length) {
      status.textContent = 'Save the remaining drafts before recording another note.';
      return;
    }
    if (!navigator.onLine) {
      status.textContent = isPassage
        ? 'Voice needs internet. Choose Pages or Ayat to add offline.'
        : 'Voice transcription needs internet. You can type your mistake below.';
      return;
    }
    const currentOperation = ++operation;
    const currentRecorder = new VoiceRecorder();
    recorder = currentRecorder;
    setMode('requesting', 'Allow microphone access to speak.');
    try {
      await currentRecorder.start();
      if (!alive || currentOperation !== operation || currentRecorder.cancelled) return;
      setMode(
        'recording',
        isPassage
          ? 'Listening… Say the surah and ayat or page numbers, then tap Stop.'
          : 'Listening… Describe the mistake, then tap Stop.',
      );
      limit = setTimeout(stopAndProcess, 120000);
    } catch (reason) {
      if (alive && currentOperation === operation)
        setMode(
          'ready',
          reason.name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow it in Chrome, choose audio, or type below.'
            : reason.name === 'AbortError'
              ? 'Recording cancelled.'
              : reason.message,
        );
    }
  }
  recordButton.onclick = () => (mode === 'recording' ? stopAndProcess() : start());
  local('#voice-file-open').onclick = () => local('#voice-file').click();
  local('#voice-file').onchange = (event) => {
    const file = event.target.files[0];
    if (!file || mode !== 'ready') return;
    if (!voiceKey) {
      status.textContent = 'Connect your Gemini key first.';
      return;
    }
    if (queue.length) {
      status.textContent = 'Save the remaining drafts before choosing another recording.';
      return;
    }
    processAudio(file);
  };
  local('#voice-retry').onclick = () => recording && processAudio(recording);
  local('#passage-phrase-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (mode !== 'ready') return;
    if (!voiceKey) {
      status.textContent = 'Connect your Gemini key first, or choose Pages or Ayat.';
      return;
    }
    processAudio(local('#passage-phrase').value.trim());
  });
  local('#voice-cancel').onclick = () => {
    operation++;
    clearTimeout(limit);
    recorder?.cancel();
    request?.abort();
    setMode('ready', 'Stopped. You can record again or type a note.');
  };
  local('#voice-key-save').onclick = async (event) => {
    const key = local('#voice-key').value.trim();
    if (key.length < 20 || key.length > 500 || /\s/.test(key)) {
      status.textContent = 'Paste a valid Gemini API key.';
      return;
    }
    event.target.disabled = true;
    try {
      await storage.setVoiceKey(key);
      voiceKey = key;
      local('#voice-key').value = '';
      local('#voice-key-setup').hidden = true;
      setMode('ready', 'Gemini connected. Tap the microphone to speak.');
    } catch (reason) {
      status.textContent = reason.message;
    } finally {
      event.target.disabled = false;
    }
  };
  const controller = {
    start,
    get busy() {
      return mode !== 'ready';
    },
    nextDraft() {
      if (!queue.length) return false;
      applyDraft(queue.shift());
      return true;
    },
    dispose() {
      operation++;
      alive = false;
      clearTimeout(limit);
      recorder?.cancel();
      request?.abort();
      if (audioURL) URL.revokeObjectURL(audioURL);
    },
  };
  voiceSession = controller;
  return controller;
}
function mistakeForm(id, passage = null) {
  const original = state.mistakes.find((m) => m.id === id);
  const m = original || {
    surah: passage?.fromS || 2,
    ayah: 0,
    type: 'recall',
    note: '',
    said: '',
    correct: '',
    date: dateISO(),
    passageId: passage?.id,
  };
  openModal(
    original ? 'Edit mistake' : 'A note for next time',
    `<p class="help">${passage ? `During ${safe(passageLabel(passage))}. ` : ''}Describe your mistake, then check the draft before saving.</p>${original ? '' : voicePanel()}<form id="mistake-form">${errorArea}<div class="field"><label for="mistake-note" lang="ar" dir="rtl">ما الذي يحتاج إلى مراجعة؟</label><textarea id="mistake-note" class="input" lang="ar" dir="auto" maxlength="10000" rows="3" placeholder="أين ترددت أو نسيت؟">${safe(m.note)}</textarea></div><div class="range-grid"><div class="field"><label for="msurah">Surah</label><select id="msurah" class="input">${surahOptions(m.surah)}</select></div><div class="field"><label for="mayah">Ayah</label><select id="mayah" class="input"></select></div></div><div class="form-row"><div class="field"><label for="mtype" lang="ar" dir="rtl">نوع الخطأ</label><select id="mtype" class="input" lang="ar" dir="rtl">${Object.entries(
      types,
    )
      .map(
        ([value, name]) => `<option value="${value}" ${m.type === value ? 'selected' : ''}>${name}</option>`,
      )
      .join(
        '',
      )}</select></div><div class="field"><label for="mdate">Date</label><input type="date" id="mdate" class="input" max="${dateISO()}" value="${m.date}" required></div></div><details ${m.said || m.correct ? 'open' : ''}><summary class="small muted" lang="ar" dir="rtl">الكلمات والتصحيح (اختياري)</summary><div class="form-row spacer"><div class="field"><label for="msaid" lang="ar" dir="rtl">ما قلته</label><textarea id="msaid" class="input arabic" lang="ar" dir="rtl" maxlength="10000">${safe(m.said)}</textarea></div><div class="field"><label for="mcorrect" lang="ar" dir="rtl">الصواب</label><textarea id="mcorrect" class="input arabic" lang="ar" dir="rtl" maxlength="10000">${safe(m.correct)}</textarea></div></div></details><button type="submit" class="primary wide spacer">Save mistake →</button></form>`,
  );
  populateAyahs($('#mayah'), m.surah, m.ayah, true);
  const voice = original ? null : attachVoice(passage);
  $('#msurah').addEventListener('change', () =>
    populateAyahs($('#mayah'), Number($('#msurah').value), 0, true),
  );
  $('#mistake-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (voice?.busy) {
      formError('Stop recording and wait for the draft before saving.');
      return;
    }
    const values = {
      surah: Number($('#msurah').value),
      ayah: Number($('#mayah').value),
      type: $('#mtype').value,
      date: $('#mdate').value,
      note: $('#mistake-note').value.trim(),
      said: $('#msaid').value.trim(),
      correct: $('#mcorrect').value.trim(),
    };
    if (!values.note && !values.said && !values.correct) {
      formError('Add a note or a correction before saving.');
      return;
    }
    if (values.date > dateISO()) {
      formError('Choose today or an earlier date.');
      return;
    }
    if (
      passage &&
      (values.surah < passage.fromS ||
        values.surah > passage.toS ||
        (values.ayah && !inPassage(passage, values.surah, values.ayah)))
    ) {
      formError('Choose an ayah within this passage, or log this mistake from the journal.');
      return;
    }
    busy = true;
    event.submitter.disabled = true;
    const saved = await change((next) => {
      if (original)
        Object.assign(
          next.mistakes.find((item) => item.id === original.id),
          values,
        );
      else
        next.mistakes.push({
          ...values,
          id: uid(),
          passageId: passage?.id,
          revisits: 0,
          resolved: false,
          nextDue: addDays(values.date, 1),
        });
    });
    busy = false;
    event.submitter.disabled = false;
    if (saved) {
      if (voice?.nextDraft()) {
        toast('Saved. Check the next mistake.');
        return;
      }
      $('#modal').close();
      toast('Mistake saved for practice.');
    }
  });
  return voice;
}
function download(text, filename) {
  const link = document.createElement('a'),
    url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function referenceModal() {
  openModal(
    'Your Quran references',
    `<div class="settings-section"><p class="arabic" lang="ar">${safe(EDITION)}</p><hr class="divider"><p>The selected reference is the Kotteb Shami Qalun Mushaf: 604 pages, 114 surahs and 6,214 ayat. Its verse and page records were checked for complete, consistent numbering. <a href="https://quranapi.lissene.dev/api/v1/quran/riwayat/67a310a41b4df754ac33ca94/data" target="_blank" rel="noopener">Reference source</a>.</p><p class="spacer">Page ranges come from this Shami layout. Partial-page amounts are estimates from verse positions; adjust them to your workload. No Hafs page map is used.</p><p class="spacer">This does not establish a match with Dar al-Fajr’s seventh printed edition. Check your chosen boundaries against the Mushaf you use.</p></div>`,
  );
}
function settingsModal() {
  openModal(
    'Make it yours',
    `<div class="settings-section"><h3>Your Mushaf</h3><p class="arabic" lang="ar">${safe(EDITION)}</p><button class="text-button" data-action="reference">Reference details →</button></div><hr class="divider"><form id="settings-form">${errorArea}<div class="field"><label for="max-interval">Longest review interval</label><select id="max-interval" class="input">${[7, 14, 21, 30, 45, 60].map((n) => `<option value="${n}" ${state.settings.maxInterval === n ? 'selected' : ''}>${n} days</option>`).join('')}</select><small>Applies to future interval growth. Fresh passages rehearse daily; Difficult returns tomorrow. Existing longer intervals are preserved until a difficult review.</small></div><button class="secondary wide" type="submit">Save preference</button></form><hr class="divider"><section class="settings-section"><h3>A copy for safekeeping</h3><p>Your reviews stay on this device. Export a backup for a new phone or before clearing browser data.</p><div class="row"><button class="secondary" data-action="export">↓ Export backup</button><button class="secondary" data-action="import">↑ Restore backup</button></div><input id="backup-file" type="file" accept=".json,application/json" hidden><button class="text-button" data-action="restore-point">Download data from before the last restore</button><div class="row"><button class="text-button" data-action="persist">Protect device storage →</button></div><p id="persistence-status" role="status"></p></section><hr class="divider"><section class="settings-section"><h3>Keep Hifz close</h3>${installPrompt ? '<button class="secondary" data-action="install">Install Hifz</button>' : ''}<p class="install-tip">On your Samsung: open the hosted Hifz page in Chrome, then use ⋮ → Add to Home screen → Install. After the app is ready offline, your revision works without internet.</p><p class="install-tip" id="offline-status">Checking offline availability…</p></section><hr class="divider"><p class="small muted">Hifz 2 · Quiet, local, and at your pace.</p>`,
  );
  $('#modal-body').insertAdjacentHTML(
    'afterbegin',
    `<section class="settings-section"><h3>Voice mistakes</h3><p id="gemini-status" role="status">${voiceKey ? 'Gemini connected on this device.' : 'Connect your dedicated Hifz Gemini key.'}</p><form id="voice-settings-form"><label class="field spacer"><span>Gemini API key</span><input id="gemini-key" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="${voiceKey ? 'Paste a replacement key' : 'Paste your Hifz key'}"></label><div class="row"><button class="secondary" type="submit">Save Gemini key</button>${voiceKey ? '<button class="text-button" type="button" id="forget-gemini-key">Disconnect</button>' : ''}</div></form><p class="small muted spacer">Saved only on this device, outside backups. Voice clips go to Google for transcription when you use the microphone. <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener">Manage keys</a></p></section><hr class="divider"><button class="text-button" data-action="history">Review history →</button><hr class="divider">`,
  );
  $('#voice-settings-form').onsubmit = async (event) => {
    event.preventDefault();
    const key = $('#gemini-key').value.trim();
    if (key.length < 20 || key.length > 500 || /\s/.test(key)) {
      $('#gemini-status').textContent = 'Paste a valid Gemini API key.';
      return;
    }
    event.submitter.disabled = true;
    try {
      await storage.setVoiceKey(key);
      voiceKey = key;
      $('#gemini-key').value = '';
      $('#gemini-status').textContent = 'Gemini connected on this device.';
    } catch (reason) {
      $('#gemini-status').textContent = reason.message;
    } finally {
      event.submitter.disabled = false;
    }
  };
  if ($('#forget-gemini-key'))
    $('#forget-gemini-key').onclick = async () => {
      await storage.setVoiceKey('');
      voiceKey = '';
      settingsModal();
    };
  $('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const maxInterval = Number($('#max-interval').value);
    if (
      await change((next) => {
        next.settings.maxInterval = maxInterval;
      })
    ) {
      $('#modal').close();
      toast('Preference saved.');
    }
  });
  $('#backup-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a backup smaller than 20 MB.');
      const imported = parseBackup(await file.text());
      openModal(
        'Restore this backup?',
        `<p class="help">This backup has <strong>${imported.passages.length} passages</strong> and <strong>${imported.mistakes.length} mistakes</strong>. It will replace your current library, history, and session.</p><p class="help">A recovery copy of your current data will be kept on this device.</p><div class="form-buttons"><button class="secondary" id="cancel-restore">Cancel</button><button class="primary" id="confirm-restore">Restore backup</button></div>`,
      );
      $('#cancel-restore').onclick = settingsModal;
      $('#confirm-restore').onclick = async (event) => {
        event.target.disabled = true;
        const saved = await change(
          (next) => {
            const revision = next.revision;
            Object.keys(next).forEach((key) => delete next[key]);
            Object.assign(next, imported, { revision });
          },
          { restore: true },
        );
        if (saved) {
          $('#modal').close();
          navigate('today');
          toast('Backup restored.');
        } else event.target.disabled = false;
      };
    } catch (reason) {
      formError(reason.message);
      event.target.value = '';
    }
  });
  navigator.storage?.persisted?.().then((granted) => {
    if ($('#persistence-status'))
      $('#persistence-status').textContent = granted
        ? 'Storage protection is enabled. Keep a backup too.'
        : 'Storage protection can help prevent automatic browser cleanup.';
  });
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.getRegistration().then((reg) => {
      if ($('#offline-status'))
        $('#offline-status').textContent = reg?.active
          ? 'App files are saved for offline use.'
          : 'Offline files are not ready yet. Keep Hifz open while connected.';
    });
}
async function startSession(id) {
  if (busy) return;
  if (activeSessionPassages(state).length && !id) {
    navigate('session');
    return;
  }
  if (activeSessionPassages(state).length && id && !activeSessionPassages(state).some((p) => p.id === id)) {
    toast('Finish or continue your current session first.');
    navigate('session');
    return;
  }
  const saved = await change((next) => {
    const queue = dueQueue(next.passages);
    if (next.session && activeSessionPassages(next).length) {
      if (id) {
        const remainingIds = activeSessionPassages(next).map((p) => p.id);
        // Do not move away from a passage with a saved draft.
        if (next.session.draft.note && next.session.draft.passageId !== id)
          throw new Error('Finish the passage with your saved note before switching.');
        next.session.ids = [...next.session.completedIds, id, ...remainingIds.filter((item) => item !== id)];
      }
    } else
      next.session = {
        ids: id ? [id] : queue.map((p) => p.id),
        completedIds: [],
        startedAt: dateISO(),
        draft: { passageId: '', note: '' },
      };
  });
  if (saved) navigate('session');
}
async function completePassage(id, rating) {
  const note = $('#session-note')?.value.trim() || '';
  const saved = await change((next) => {
    const index = next.passages.findIndex((p) => p.id === id),
      p = next.passages[index];
    if (!p || p.paused || p.nextDue > dateISO()) throw new Error('This passage is no longer due.');
    next.passages[index] = ratePassage(p, rating, dateISO(), next.settings.maxInterval);
    if (note)
      next.mistakes.push({
        id: uid(),
        passageId: p.id,
        surah: p.fromS,
        ayah: 0,
        note,
        said: '',
        correct: '',
        type: 'recall',
        date: dateISO(),
        nextDue: addDays(dateISO(), 1),
        resolved: false,
        revisits: 0,
      });
    if (next.session && !next.session.completedIds.includes(id)) next.session.completedIds.push(id);
    if (next.session) next.session.draft = { passageId: '', note: '' };
  });
  if (saved) {
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
    toast('Review saved.');
  }
}
function confirmRemoval(kind, id) {
  openModal(
    kind === 'passage' ? 'Remove this passage?' : 'Remove this mistake?',
    `<p class="help">${kind === 'passage' ? 'This removes the passage and its review history. Export a backup first if you want to keep a copy.' : 'This mistake entry will be removed from your journal.'}</p><div class="form-buttons"><button class="secondary" data-action="close">Keep it</button><button class="danger" id="confirm-remove">Remove</button></div>`,
  );
  $('#confirm-remove').onclick = async (event) => {
    event.target.disabled = true;
    const saved = await change((next) => {
      if (kind === 'passage') next.passages = next.passages.filter((p) => p.id !== id);
      else next.mistakes = next.mistakes.filter((m) => m.id !== id);
    });
    if (saved) {
      $('#modal').close();
      toast('Removed.');
    } else event.target.disabled = false;
  };
}
async function action(button) {
  const { action: name, id } = button.dataset;
  if (name === 'reload') {
    await saveQueue;
    location.reload();
    return;
  }
  if (!state) return;
  if (name === 'close') return $('#modal').close();
  if (name === 'add-passage' || name === 'edit-passage') return passageForm(id);
  if (name === 'go-library') return navigate('library');
  if (name === 'filter-library') {
    libraryFilter = id;
    return render();
  }
  if (name === 'filter-mistakes') {
    mistakeFilter = id;
    return render();
  }
  if (name === 'add-mistake' || name === 'edit-mistake') return mistakeForm(id);
  if (name === 'voice-mistake' || name === 'session-voice') {
    const voice = mistakeForm(null, name === 'session-voice' ? activeSessionPassages(state)[0] : null);
    if (voiceKey) await voice.start();
    return;
  }
  if (name === 'history') {
    $('#modal').close();
    navigate('history');
    return;
  }
  if (name === 'session-mistake') return mistakeForm(null, activeSessionPassages(state)[0]);
  if (name === 'reference') return referenceModal();
  if (name === 'start') return startSession();
  if (name === 'review-one') return startSession(id);
  if (name === 'remove-passage' || name === 'remove-mistake')
    return confirmRemoval(name === 'remove-passage' ? 'passage' : 'mistake', id);
  if (name === 'export') {
    await saveQueue;
    return download(backupOf(state), `hifz-qalun-${dateISO()}.json`);
  }
  if (name === 'import') return $('#backup-file').click();
  if (name === 'restore-point') {
    const previous = await storage.read('beforeRestore');
    return previous
      ? download(backupOf(previous), `hifz-before-restore-${dateISO()}.json`)
      : toast('No previous restore to recover yet.');
  }
  if (name === 'persist') {
    const granted = await navigator.storage?.persist?.();
    $('#persistence-status').textContent = granted
      ? 'Storage protection is enabled. Keep a backup too.'
      : 'Chrome has not granted protection yet. Install Hifz and keep regular backups.';
    return;
  }
  if (name === 'install') {
    await installPrompt?.prompt();
    installPrompt = null;
    return;
  }
  if (name === 'update' || name === 'reload-updated') {
    if (pending || $('#modal').open || view === 'session')
      return toast('Finish or pause your review and close any form before updating.');
    if (name === 'reload-updated') location.reload();
    else registration?.waiting?.postMessage('ACTIVATE');
    return;
  }
  if (busy) return;
  busy = true;
  button.disabled = true;
  try {
    if (name === 'rate') await completePassage(id, button.dataset.rating);
    if (name === 'pause')
      await change((next) => {
        const p = next.passages.find((p) => p.id === id);
        p.paused = !p.paused;
      });
    if (name === 'solid')
      await change((next) => {
        const m = next.mistakes.find((m) => m.id === id);
        m.resolved = true;
        m.lastRevisited = dateISO();
      });
    if (name === 'practice')
      await change((next) => {
        const m = next.mistakes.find((m) => m.id === id);
        if (m.lastRevisited === dateISO()) return;
        m.lastRevisited = dateISO();
        m.revisits++;
        m.nextDue = addDays(dateISO(), Math.min(14, 2 ** Math.min(m.revisits, 4)));
      });
  } finally {
    busy = false;
    button.disabled = false;
  }
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) action(button).catch((reason) => error(reason.message));
});
document.addEventListener('input', (event) => {
  if (event.target.id !== 'session-note') return;
  const p = activeSessionPassages(state)[0];
  if (!p) return;
  const note = event.target.value;
  $('#draft-status').textContent = 'Saving note…';
  const sequence = (document.noteSequence || 0) + 1;
  document.noteSequence = sequence;
  change(
    (next) => {
      if (next.session) next.session.draft = { passageId: p.id, note };
    },
    { renderAfter: false },
  ).then((saved) => {
    if ($('#draft-status') && document.noteSequence === sequence)
      $('#draft-status').textContent = saved
        ? 'Note saved on this device. It joins your journal when you finish.'
        : 'Note not saved. Keep this window open and try again.';
  });
});
$('#settings-open').onclick = () => state && settingsModal();
$('#modal-close').onclick = () => $('#modal').close();
$('#modal').addEventListener('close', () => {
  voiceSession?.dispose();
  voiceSession = null;
});
$('#modal').addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = [
    ...$('#modal').querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]',
    ),
  ].filter(
    (element) =>
      !element.disabled &&
      element.tabIndex >= 0 &&
      (element.checkVisibility ? element.checkVisibility() : element.getClientRects().length),
  );
  const first = focusable[0],
    last = focusable.at(-1);
  if (!first) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && (document.activeElement === first || !$('#modal').contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
$('#modal').addEventListener('click', (event) => {
  if (event.target === $('#modal')) {
    const r = $('#modal').getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      $('#modal').close();
  }
});
window.addEventListener('hashchange', async () => {
  await saveQueue;
  view = ['today', 'library', 'mistakes', 'history', 'session'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : 'today';
  render();
  window.scrollTo(0, 0);
  $('#main').focus({ preventScroll: true });
});
window.addEventListener('beforeunload', (event) => {
  if (pending) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
channel?.addEventListener('message', (event) => {
  if (state && event.data.revision > state.revision)
    error('Your library changed in another Hifz window. Reload to continue with the latest data.');
});
function checkDay() {
  if (state && lastDay !== dateISO() && !$('#modal').open && !pending) {
    lastDay = dateISO();
    render();
  }
}
window.addEventListener('focus', checkDay);
document.addEventListener('visibilitychange', checkDay);
setInterval(checkDay, 30000);
async function registerOffline() {
  if (!('serviceWorker' in navigator)) return;
  try {
    let hasControlledPage = Boolean(navigator.serviceWorker.controller);
    registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    hasControlledPage ||= Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hasControlledPage) {
        hasControlledPage = true;
        return;
      }
      if (refreshing) return;
      if (pending || $('#modal').open || view === 'session') {
        $('#notice').hidden = false;
        $('#notice').innerHTML =
          'Hifz was updated in another window. Continue your review, then reload. <button data-action="reload-updated">Reload when ready</button>';
      } else {
        refreshing = true;
        location.reload();
      }
    });
    function announceUpdate() {
      if (registration.waiting && navigator.serviceWorker.controller) {
        $('#notice').hidden = false;
        $('#notice').innerHTML =
          'A fresh version of Hifz is ready. <button data-action="update">Update when ready</button>';
      }
    }
    announceUpdate();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', announceUpdate);
    });
  } catch {
    $('#notice').hidden = false;
    $('#notice').textContent =
      'Offline files could not be prepared. Keep an internet connection and reopen Hifz to try again.';
  }
}
async function boot() {
  try {
    storage = await openStorage();
    state = await storage.load();
    const savedKey = await storage.read('voiceKey');
    voiceKey = typeof savedKey === 'string' ? savedKey : '';
    view = ['today', 'library', 'mistakes', 'history', 'session'].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : 'today';
    render();
    await registerOffline();
  } catch (reason) {
    $('#main').innerHTML =
      `<div class="single-column">${pageHeading('Let’s recover your library.', 'Your saved data has not been replaced.', 'DEVICE STORAGE')}<div class="notice error">${safe(reason.message)}</div><p class="help">Keep a copy of the stored data, then restore a valid Hifz backup or try reopening Chrome.</p><div class="row wrap"><button class="secondary" id="raw-export">Download stored data</button><label class="secondary" for="recovery-file">Restore backup</label><input type="file" id="recovery-file" accept=".json,application/json" hidden><button class="secondary" data-action="reload">Try again</button></div><p id="recovery-error" class="help spacer" role="alert"></p></div>`;
    $('#raw-export').onclick = async () => {
      let raw;
      try {
        raw = await storage?.read();
      } catch {}
      download(
        raw ? JSON.stringify(raw, null, 2) : localStorage.getItem(LEGACY_KEY) || '{}',
        'hifz-recovery-data.json',
      );
    };
    $('#recovery-file').onchange = async (event) => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw new Error('Choose a backup smaller than 20 MB.');
        const imported = parseBackup(await file.text());
        if (!storage) storage = await openStorage();
        const old = await storage.read();
        imported.revision = old?.revision || 0;
        state = await storage.write(imported, { expectedRevision: imported.revision, restore: true });
        location.hash = 'today';
        location.reload();
      } catch (e) {
        $('#recovery-error').textContent = e.message;
      }
    };
  }
}
boot();
