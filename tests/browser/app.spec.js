import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';

const legacy = {
  passages: [
    {
      id: 'older',
      fromS: 2,
      fromA: 74,
      toS: 2,
      toA: 90,
      pages: 1.5,
      created: '2026-01-01',
      interval: 30,
      nextDue: '2026-10-01',
      note: 'Page 12, lower half',
      reviews: [],
      paused: false,
    },
    {
      id: 'fresh',
      fromS: 2,
      fromA: 91,
      toS: 2,
      toA: 110,
      pages: 1,
      created: '2026-10-20',
      interval: 1,
      nextDue: '2026-10-21',
      note: '',
      reviews: [],
      paused: false,
    },
  ],
  mistakes: [],
  revisionHistory: [],
  settings: {},
};
async function seed(page, value = legacy) {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('hifz-qalun:v1', JSON.stringify(value));
      sessionStorage.setItem('seeded', 'yes');
    }
  }, value);
}
async function open(page, url = '/') {
  await page.clock.setFixedTime(new Date('2026-10-21T10:00:00+01:00'));
  await page.goto(url);
  await expect(page.locator('.loading')).toHaveCount(0);
}
async function savedState(page) {
  return page.evaluate(async () => {
    const { openStorage } = await import('/storage.js');
    const store = await openStorage();
    const state = await store.read();
    store.close();
    return state;
  });
}

test('empty state, mobile and desktop layouts remain readable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.getByRole('heading', { name: "Today's revision" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first passage' })).toBeVisible();
  await expect(page.getByText('Add the passages you have memorized to begin.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record a mistake' })).toBeVisible();
  await expect(page.locator('.sidebar, .habit, .intro-step, .app-footer')).toHaveCount(0);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/today-empty-mobile.png', fullPage: true });
  for (const width of [360, 390, 760, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: '.local/today-empty-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('add exact cross-surah fraction, reject overlap, preserve edits and pauses', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add your first passage' }).click();
  await page.getByLabel('Starting surah').selectOption('2');
  await page.getByLabel('Starting ayah').selectOption('280');
  await page.getByLabel('Ending surah').selectOption('3');
  await page.getByLabel('Ending ayah').selectOption('5');
  await page.getByLabel('Amount on your pages').fill('1.5');
  await page.getByLabel('First memorized on').fill('2026-10-01');
  await page.getByLabel('Page number / note').fill('My own boundaries');
  await page.getByRole('button', { name: 'Add to my revision' }).click();
  await expect(page.getByRole('heading', { name: 'Your memorization', exact: true })).toBeVisible();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add passage', exact: false }).click();
  await page.getByLabel('Starting surah').selectOption('3');
  await page.getByLabel('Starting ayah').selectOption('3');
  await page.getByLabel('Ending surah').selectOption('3');
  await page.getByLabel('Ending ayah').selectOption('10');
  await page.getByRole('button', { name: 'Add to my revision' }).click();
  await expect(page.locator('#form-error')).toContainText('overlaps');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Page number / note').fill('Edited physical label');
  await page.getByRole('button', { name: /^Save changes/ }).click();
  await expect(page.getByText('Edited physical label')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByText("You're caught up.")).toBeVisible();
  const data = await savedState(page);
  expect(data.passages[0]).toMatchObject({ fromS: 2, fromA: 280, toS: 3, toA: 5, pages: 1.5, paused: true });
});

test('migrate, prioritize overdue, resume draft after reload, complete once with linked mistake', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await expect(page.locator('.hero-number')).toContainText('2.5');
  await expect(page.locator('.queue .passage-row').first()).toContainText('74–90');
  await page.screenshot({ path: '.local/today-populated-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Start revision' }).click();
  await expect(page.getByText('PASSAGE 1 OF 2')).toBeVisible();
  await expect(page.locator('[data-rating="good"]')).toContainText('In 30 days');
  await page.getByLabel('Anything to revisit?').fill('Hesitated near the end');
  await expect(page.locator('#draft-status')).toContainText('Note saved');
  await page.reload();
  await expect(page.getByLabel('Anything to revisit?')).toHaveValue('Hesitated near the end');
  await page.screenshot({ path: '.local/session-mobile.png', fullPage: true });
  await page.locator('[data-rating="good"]').click();
  await expect(page.getByText('PASSAGE 2 OF 2')).toBeVisible();
  await page.locator('[data-rating="easy"]').click();
  await expect(page.getByRole('heading', { name: 'Revision, remembered.' })).toBeVisible();
  const data = await savedState(page);
  expect(data.passages[0].interval).toBe(30);
  expect(data.passages[0].nextDue).toBe('2026-11-20');
  expect(data.passages[0].reviews).toHaveLength(1);
  expect(data.mistakes[0]).toMatchObject({ note: 'Hesitated near the end', passageId: 'older', ayah: 0 });
  expect(data.passages[1].interval).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Review history' }).click();
  await expect(page.locator('.history-row')).toHaveCount(2);
});

test('offline cold launch and completion persist after restart', async ({ page, context }) => {
  await seed(page);
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  const coldPage = await context.newPage();
  await coldPage.goto('http://localhost:4173/index.html');
  await expect(coldPage.getByRole('heading', { name: "Today's revision" })).toBeVisible();
  await coldPage.getByRole('button', { name: 'Start revision' }).click();
  await coldPage.locator('[data-rating="hard"]').click();
  await expect(coldPage.getByText('PASSAGE 2 OF 2')).toBeVisible();
  await coldPage.reload();
  await expect(coldPage.getByText('PASSAGE 2 OF 2')).toBeVisible();
  const data = await savedState(coldPage);
  expect(data.passages[0].reviews[0].rating).toBe('hard');
  expect(data.session.completedIds).toEqual(['older']);
});

test('manual mistakes support exact ayat, practice and resolving', async ({ page }) => {
  await seed(page);
  await open(page, '/#mistakes');
  await page.getByRole('button', { name: 'Log mistake' }).click();
  await page.getByLabel('What needs practice?').fill('Forgot the continuation');
  await page.getByLabel('Ayah', { exact: true }).selectOption('80');
  await page.getByRole('button', { name: 'Save mistake' }).click();
  await expect(page.locator('.mistake-card')).toContainText('ayah 80');
  await page.getByRole('button', { name: 'Practiced again' }).click();
  await expect(page.getByRole('button', { name: 'Practiced today' })).toBeDisabled();
  await page.getByRole('button', { name: 'Mark solid' }).click();
  await expect(page.locator('.mistake-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Solid', exact: true }).click();
  await expect(page.locator('.mistake-card')).toContainText('Forgot the continuation');
});

test('validate restores before confirmation, preserve pre-restore copy, export v2', async ({ page }) => {
  await seed(page);
  await open(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#backup-file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'hifz-qalun-backup',
        version: 1,
        data: { ...legacy, passages: [{ ...legacy.passages[0], fromA: 999 }] },
      }),
    ),
  });
  await expect(page.locator('#form-error')).toContainText('starting ayah');
  expect((await savedState(page)).passages).toHaveLength(2);
  await page.locator('#backup-file').setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ type: 'hifz-qalun-backup', version: 1, data: { ...legacy, passages: [] } }),
    ),
  });
  await expect(page.getByRole('heading', { name: 'Restore this backup?' })).toBeVisible();
  expect((await savedState(page)).passages).toHaveLength(2);
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add your first passage' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const recovery = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download data from before the last restore' }).click();
  const recoveryDownload = await recovery;
  const stream = await recoveryDownload.createReadStream();
  let bytes = '';
  for await (const chunk of stream) bytes += chunk;
  expect(JSON.parse(bytes).data.passages).toHaveLength(2);
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const exportedDownload = await exported;
  const exportedStream = await exportedDownload.createReadStream();
  let json = '';
  for await (const chunk of exportedStream) json += chunk;
  expect(JSON.parse(json)).toMatchObject({ version: 2, data: { passages: [] } });
});

test('a failed write leaves session and input intact without reporting completion', async ({ page }) => {
  await seed(page);
  await open(page);
  await page.getByRole('button', { name: 'Start revision' }).click();
  await page.getByLabel('Anything to revisit?').fill('Keep this note');
  await expect(page.locator('#draft-status')).toContainText('Note saved');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const result = original.apply(this, args);
      this.transaction.abort();
      return result;
    };
  });
  await page.locator('[data-rating="good"]').click();
  await expect(page.locator('#save-error')).toContainText('Could not save');
  await expect(page.getByLabel('Anything to revisit?')).toHaveValue('Keep this note');
  await expect(page.getByText('PASSAGE 1 OF 2')).toBeVisible();
  expect((await savedState(page)).passages[0].reviews).toHaveLength(0);
});

test('corrupt legacy state opens recovery without erasing the stored data', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hifz-qalun:v1', '{corrupt'));
  await open(page);
  await expect(page.getByRole('heading', { name: 'Let’s recover your library.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hifz-qalun:v1'))).toBe('{corrupt');
  expect(await savedState(page)).toBeUndefined();
});

test('midnight refresh carries the backlog forward and completed passages return when due', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await page.getByRole('button', { name: 'Start revision' }).click();
  await page.locator('[data-rating="hard"]').click();
  await expect(page.getByText('PASSAGE 2 OF 2')).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.locator('.hero-number')).toContainText('1');
  await page.clock.setFixedTime(new Date('2026-10-22T10:00:00+01:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.hero-number')).toContainText('2.5');
  await expect(page.locator('.queue .passage-row')).toHaveCount(2);
  expect((await savedState(page)).passages[0].reviews).toHaveLength(1);
});

test('stale windows show a conflict and cannot overwrite a newer library', async ({ page, context }) => {
  await seed(page);
  await open(page, '/#library');
  const other = await context.newPage();
  await other.goto('http://localhost:4173/#library');
  await expect(other.locator('.library-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(other.locator('#save-error')).toContainText('another Hifz window');
  await other.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await expect(other.locator('#save-error')).toContainText('Reload before saving');
  expect((await savedState(page)).passages[0].paused).toBe(true);
  await other.getByRole('button', { name: 'Reload Hifz' }).click();
  await expect(other.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});

test('all screens and passage form fit a small phone and keyboard focus stays in the dialog', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await page.setViewportSize({ width: 360, height: 780 });
  for (const name of ['Memorization', 'Mistakes', 'Today']) {
    await page.getByRole('link', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole('link', { name: 'Memorization', exact: true }).click();
  await page.getByRole('button', { name: 'Add passage' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('dialog')))).toBe(true);
  }
  const rect = await page.getByRole('dialog').boundingBox();
  expect(rect.x + rect.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: '.local/add-passage-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('service-worker update waits for approval and another window cannot interrupt a session', async ({
  page,
  context,
}) => {
  let version = 0;
  const mime = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = resolve(process.cwd(), `.${pathname === '/' ? '/index.html' : pathname}`);
      let body = await readFile(file);
      if (pathname === '/sw.js')
        body = Buffer.from(body.toString().replace(/2\.\d+\.\d+/, `2.1.integration${version}`));
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    await seed(page);
    await page.clock.setFixedTime(new Date('2026-10-21T10:00:00+01:00'));
    await page.goto(base);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.locator('#notice')).not.toBeVisible();
    await page.getByRole('button', { name: 'Start revision' }).click();
    await page.getByLabel('Anything to revisit?').fill('Preserve during update');
    await expect(page.locator('#draft-status')).toContainText('Note saved');
    version++;
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
    });
    await expect(page.locator('#notice')).toContainText('fresh version');
    await page.getByRole('button', { name: 'Update when ready' }).click();
    await expect(page.locator('#toast')).toContainText('Finish or pause');
    expect(
      await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)),
    ).toBe(true);
    const other = await context.newPage();
    await other.goto(base);
    await expect(other.getByRole('button', { name: 'Update when ready' })).toBeVisible();
    await other.getByRole('button', { name: 'Update when ready' }).click();
    await expect(page.getByRole('button', { name: 'Reload when ready' })).toBeVisible();
    await expect(page.getByLabel('Anything to revisit?')).toHaveValue('Preserve during update');
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Reload when ready' }).click();
    await expect(page.getByRole('button', { name: 'Continue revision' })).toBeVisible();
    await other.close();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
