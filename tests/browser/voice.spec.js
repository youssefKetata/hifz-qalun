import { test, expect } from '@playwright/test';

const fakeKey = 'fake-hifz-gemini-key-for-browser-tests';
const draft = {
  transcript: 'I forgot the continuation in verse eighty.',
  mistakes: [
    { surah: 2, ayah: 80, type: 'recall', note: 'Forgot the continuation', said: '', correct: '' },
    { surah: 2, ayah: null, type: 'substitution', note: 'Mixed up two words', said: 'كلمة', correct: 'أخرى' },
  ],
};
async function connect(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Gemini API key', { exact: true }).fill(fakeKey);
  await page.getByRole('button', { name: 'Save Gemini key', exact: true }).click();
  await expect(page.locator('#gemini-status')).toContainText('connected');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}
async function openVoiceForm(page) {
  await page.getByRole('link', { name: 'Mistakes', exact: true }).click();
  await page.getByRole('button', { name: 'Log mistake' }).click();
}
const sample = { name: 'mistake.wav', mimeType: 'audio/wav', buffer: Buffer.from('synthetic-audio-fixture') };

test('Gemini transcribes into multiple editable drafts, saved only after review', async ({ page }) => {
  let request;
  await page.route('https://generativelanguage.googleapis.com/v1beta/interactions', (route) => {
    request = route.request();
    return route.fulfill({ json: { status: 'completed', output_text: JSON.stringify(draft) } });
  });
  await connect(page);
  await openVoiceForm(page);
  await page.locator('#voice-file').setInputFiles(sample);
  await expect(page.locator('#voice-status')).toContainText('Draft ready');
  await expect(page.getByLabel('What needs practice?')).toHaveValue('Forgot the continuation');
  await expect(page.getByLabel('Ayah', { exact: true })).toHaveValue('80');
  await expect(page.locator('#voice-draft-count')).toContainText('1 of 2');
  expect(request.headers()['x-goog-api-key']).toBe(fakeKey);
  expect(request.postDataJSON()).toMatchObject({ store: false, model: 'gemini-3.5-flash-lite' });
  expect(request.postDataJSON().input[1]).toMatchObject({ type: 'audio', mime_type: 'audio/wav' });
  expect(
    await page.evaluate(async () => {
      const { openStorage } = await import('/storage.js');
      const store = await openStorage();
      const data = await store.load();
      store.close();
      return data.mistakes.length;
    }),
  ).toBe(0);
  await page.getByRole('button', { name: 'Save mistake' }).click();
  await expect(page.locator('#voice-draft-count')).toContainText('2 of 2');
  await expect(page.getByLabel('What needs practice?')).toHaveValue('Mixed up two words');
  await expect(page.getByLabel('Ayah', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Save mistake' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.mistake-card')).toHaveCount(2);
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#gemini-status')).toContainText('connected');
  const exported = await page.evaluate(async () => {
    const { openStorage } = await import('/storage.js');
    const { backupOf } = await import('/model.js');
    const store = await openStorage();
    const text = backupOf(await store.load());
    store.close();
    return text;
  });
  expect(exported).not.toContain(fakeKey);
});

test('provider failure keeps the audio and allows a successful retry without losing typed notes', async ({
  page,
}) => {
  let calls = 0;
  await page.route('https://generativelanguage.googleapis.com/v1beta/interactions', (route) =>
    ++calls === 1
      ? route.fulfill({ status: 429, json: { error: { message: `Sensitive provider detail ${fakeKey}` } } })
      : route.fulfill({ json: { output_text: JSON.stringify({ ...draft, mistakes: [draft.mistakes[0]] }) } }),
  );
  await connect(page);
  await openVoiceForm(page);
  await page.getByLabel('What needs practice?').fill('Keep my typed note');
  await page.locator('#voice-file').setInputFiles(sample);
  await expect(page.locator('#voice-status')).toContainText('quota');
  await expect(page.getByLabel('What needs practice?')).toHaveValue('Keep my typed note');
  await expect(page.locator('#voice-download')).toHaveAttribute('href', /^blob:/);
  expect(await page.locator('body').innerText()).not.toContain(fakeKey);
  await page.getByRole('button', { name: 'Retry transcription' }).click();
  await expect(page.locator('#voice-status')).toContainText('Draft ready');
});

test('microphone denial leaves manual entry usable', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  await connect(page);
  await page.getByRole('button', { name: 'Record a mistake', exact: true }).click();
  await expect(page.locator('#voice-status')).toContainText('permission was denied');
  await page.getByLabel('What needs practice?').fill('Entered manually');
  await page.getByRole('button', { name: 'Save mistake' }).click();
  await page.getByRole('link', { name: 'Mistakes', exact: true }).click();
  await expect(page.locator('.mistake-card')).toContainText('Entered manually');
});

test('recording stops microphone tracks when the dialog closes, with no transcription request', async ({
  page,
  context,
}) => {
  let calls = 0;
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    calls++;
    return route.abort();
  });
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const fakeStream = new AudioContext().createMediaStreamDestination().stream;
    window.testMicrophoneStream = fakeStream;
    navigator.mediaDevices.getUserMedia = async () => fakeStream;
  });
  await connect(page);
  await page.getByRole('button', { name: 'Record a mistake', exact: true }).click();
  await expect(page.locator('#voice-status')).toContainText('Listening');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.testMicrophoneStream.getTracks().every((track) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  expect(calls).toBe(0);
});
