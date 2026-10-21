import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, dueQueue, reviewInterval, ratePassage, pendingMistakes } from '../schedule.js';
const today = '2026-10-21';
const established = {
  id: 'a',
  created: '2026-01-01',
  fromS: 2,
  fromA: 1,
  interval: 30,
  nextDue: today,
  reviews: [],
};

test('Good never reduces a stable 30-day interval', () => {
  assert.equal(reviewInterval(established, 'good', today), 30);
  assert.equal(reviewInterval({ ...established, interval: 45 }, 'good', today), 45);
});
test('fresh memorization stays daily regardless of successful rating', () => {
  for (const rating of ['easy', 'good', 'hard'])
    assert.equal(reviewInterval({ ...established, created: '2026-10-20' }, rating, today), 1);
});
test('difficulty returns tomorrow and successful relearning is conservative', () => {
  const hard = ratePassage(established, 'hard', today);
  assert.equal(hard.nextDue, '2026-10-22');
  assert.equal(ratePassage(hard, 'good', '2026-10-22').interval, 1);
});
test('memory age constrains early growth and recent failures reduce growth', () => {
  const base = { ...established, interval: 5 };
  assert.equal(reviewInterval({ ...base, created: '2026-10-11' }, 'easy', today), 5);
  assert.ok(
    reviewInterval(base, 'easy', today) >
      reviewInterval({ ...base, reviews: [{ rating: 'hard' }, { rating: 'good' }] }, 'easy', today),
  );
});
test('overdue success uses elapsed time but does not inflate intervals by the entire gap', () => {
  const base = { ...established, interval: 4, lastReviewed: '2026-10-01', nextDue: '2026-10-05' };
  const result = ratePassage(base, 'good', today);
  assert.equal(result.interval, 6);
  assert.equal(result.nextDue, '2026-10-27');
});
test('overdue passages carry forward once, before new work; paused items stay out', () => {
  const entries = [
    { ...established, id: 'new', interval: 1 },
    { ...established, id: 'late', nextDue: '2026-09-01' },
    { ...established, id: 'paused', paused: true },
  ];
  assert.deepEqual(
    dueQueue(entries, today).map((p) => p.id),
    ['late', 'new'],
  );
  assert.equal(entries[1].nextDue, '2026-09-01');
});
test('duplicate completion and invalid ratings do not silently add reviews', () => {
  assert.throws(() => ratePassage({ ...established, lastReviewed: today }, 'easy', today));
  assert.throws(() => ratePassage(established, 'unknown', today));
});
test('date arithmetic crosses month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(daysBetween('2026-10-21', '2026-11-01'), 11);
});
test('mistakes stay due until practiced or resolved', () => {
  const m = { id: 'm', date: '2026-10-01', nextDue: '2026-10-02' };
  assert.equal(pendingMistakes([m], today).length, 1);
  assert.equal(
    pendingMistakes(
      [
        { ...m, lastRevisited: today },
        { ...m, resolved: true },
      ],
      today,
    ).length,
    0,
  );
});
