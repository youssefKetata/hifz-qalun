import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const passages = Array.from({ length: 7 }, (_, index) => ({
  id: `layout-${index}`,
  fromS: 2,
  fromA: index * 10 + 1,
  toS: 2,
  toA: index * 10 + 8,
  pages: 0.5,
  created: '2025-01-01',
  interval: 3,
  nextDue: '2026-10-21',
  reviews: [],
  note:
    index === 6 ? 'A longer page label that should wrap inside the card without displacing its actions.' : '',
}));
const state = { passages, mistakes: [], settings: {} };
async function load(page, data = state, route = '#library') {
  await page.clock.setFixedTime(new Date('2026-10-21T10:00:00+01:00'));
  await page.addInitScript((data) => localStorage.setItem('hifz-qalun:v1', JSON.stringify(data)), data);
  await page.goto(`/${route}`);
  await expect(page.locator('.loading')).toHaveCount(0);
}
async function assertClearance(page, target) {
  await expect
    .poll(async () => {
      // ResizeObserver can change document height after a viewport/safe-area change.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const box = await target.boundingBox(),
        nav = await page.locator('.navigation').boundingBox();
      return nav.y - (box.y + box.height);
    })
    .toBeGreaterThanOrEqual(15);
  const box = await target.boundingBox();
  expect(
    await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('main')), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }),
  ).toBe(true);
}

test('populated library actions clear the bottom bar on short and narrow screens', async ({ page }) => {
  await load(page);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 640 },
    { width: 640, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await assertClearance(
      page,
      page.locator('.library-card').last().getByRole('button', { name: 'Remove', exact: true }),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/library-layout-fixed.png' });
});

test('empty library actions clear the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await load(page, { passages: [], mistakes: [], settings: {} });
  await assertClearance(page, page.locator('.empty').getByRole('button', { name: 'Add memorized passage' }));
});

test('passage amount and date controls align even with help text and wrapped labels', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Add passage', exact: false }).click();
  for (const width of [320, 390, 458, 760]) {
    await page.setViewportSize({ width, height: 720 });
    const amount = await page.locator('#pages').boundingBox();
    const date = await page.locator('#created').boundingBox();
    expect(Math.abs(amount.y - date.y)).toBeLessThan(1);
    expect(Math.abs(amount.height - date.height)).toBeLessThan(1);
    expect(date.height).toBeLessThanOrEqual(48);
    expect(
      await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 458, height: 720 });
  await page.locator('#pages').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/passage-form-aligned.png' });
});

test('session ratings stay reachable above navigation including extra safe-area space', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await load(page, state, '#today');
  await page.getByRole('button', { name: 'Start revision' }).click();
  await assertClearance(page, page.locator('[data-rating="easy"]'));
  await page.addStyleTag({ content: ':root { --safe-area-bottom: 24px; }' });
  await assertClearance(page, page.locator('[data-rating="easy"]'));
});

test('headings, settings icon and dialog controls stay aligned across breakpoints', async ({ page }) => {
  await load(page);
  for (const width of [320, 390, 759, 760, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const heading = await page.getByRole('heading', { name: 'Your memorization', exact: true }).boundingBox();
    const add = await page.getByRole('button', { name: 'Add passage', exact: false }).boundingBox();
    expect(heading.x + heading.width <= add.x + 1 || heading.y + heading.height <= add.y + 1).toBe(true);
    const button = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
    const icon = await page.locator('#settings-open svg').boundingBox();
    expect(Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2)).toBeLessThan(1);
    expect(Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2)).toBeLessThan(1);
    const brand = await page.locator('.brand').boundingBox();
    const nav = await page.locator('.navigation').boundingBox();
    const header = await page.locator('.header-actions').boundingBox();
    if (width >= 760) {
      expect(nav.x).toBeGreaterThan(brand.x + brand.width);
      expect(nav.x + nav.width).toBeLessThan(header.x);
    }
  }
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.local/library-header-fixed.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Save preference' }).scrollIntoViewIfNeeded();
  const modal = await page.getByRole('dialog').boundingBox();
  expect(modal.y + modal.height).toBeLessThanOrEqual(640);
  await page.screenshot({ path: '.local/settings-layout-fixed.png' });
});
