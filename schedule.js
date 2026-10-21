// Policy v2: conservative product defaults, not a fitted memory model.
export const POLICY_VERSION = 2;
export function dateISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
export function addDays(day, amount) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateISO(date);
}
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}
export const dueToday = (entry, day = dateISO()) => !entry.paused && (entry.nextDue || entry.created) <= day;
export function phase(entry, day = dateISO()) {
  if (daysBetween(entry.created, day) < 7) return 'Fresh';
  if (entry.ease === 'hard' || entry.interval <= 1) return 'Reinforcement';
  return entry.interval < 7 ? 'Building' : 'Maintenance';
}
export function reviewInterval(entry, rating, day = dateISO(), maxInterval = 30) {
  if (!['easy', 'good', 'hard'].includes(rating)) throw new Error('Choose a recall rating.');
  const age = Math.max(0, daysBetween(entry.created, day));
  const prior = Math.max(1, Number(entry.interval) || 1);
  if (rating === 'hard' || age < 7) return 1;
  const history = entry.reviews || [];
  // One successful daily rehearsal after a lapse before expanding again.
  if (history.at(-1)?.rating === 'hard') return 1;
  const recent = history.slice(-6);
  const failureRate = recent.length ? recent.filter((r) => r.rating === 'hard').length / recent.length : 0;
  const elapsed = entry.lastReviewed ? Math.max(1, daysBetween(entry.lastReviewed, day)) : prior;
  // Successful overdue recall earns a small bonus, never the whole missed interval.
  const delayBonus = Math.min(prior * 0.25, Math.max(0, elapsed - prior) * 0.15);
  const growth = rating === 'easy' ? 1.8 - failureRate * 0.4 : 1.15 - failureRate * 0.15;
  const ageCap = age < 21 ? 3 : age < 60 ? 7 : maxInterval;
  // A Good rating must not shorten an established interval, including migrated data.
  const cap = Math.max(prior, Math.min(maxInterval, ageCap));
  return Math.min(cap, Math.max(prior, 2, Math.round((prior + delayBonus) * growth)));
}
export function ratePassage(entry, rating, day = dateISO(), maxInterval = 30) {
  if (entry.lastReviewed === day) throw new Error('This passage has already been completed today.');
  const interval = reviewInterval(entry, rating, day, maxInterval);
  return {
    ...entry,
    interval,
    nextDue: addDays(day, interval),
    lastReviewed: day,
    ease: rating,
    hardCount: (entry.hardCount || 0) + Number(rating === 'hard'),
    reviews: [...(entry.reviews || []), { date: day, rating, interval, policyVersion: POLICY_VERSION }],
  };
}
export function dueQueue(passages, day = dateISO()) {
  return passages
    .filter((p) => dueToday(p, day))
    .sort((a, b) => {
      return (
        a.nextDue.localeCompare(b.nextDue) ||
        Number(b.ease === 'hard') - Number(a.ease === 'hard') ||
        a.interval - b.interval ||
        a.fromS - b.fromS ||
        a.fromA - b.fromA
      );
    });
}
export function pendingMistakes(mistakes, day = dateISO()) {
  return mistakes
    .filter((m) => !m.resolved && m.lastRevisited !== day && (m.nextDue || addDays(m.date, 1)) <= day)
    .sort((a, b) => (a.nextDue || a.date).localeCompare(b.nextDue || b.date));
}
