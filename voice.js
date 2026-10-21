import { SURAHS } from './surahs.js';
import { inPassage } from './model.js';

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const mistakeTypes = ['recall', 'substitution', 'ending', 'order', 'other'];
const schema = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    mistakes: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          surah: { type: ['integer', 'null'] },
          ayah: { type: ['integer', 'null'] },
          type: { type: 'string', enum: mistakeTypes },
          note: { type: 'string' },
          said: { type: 'string' },
          correct: { type: 'string' },
        },
        required: ['surah', 'ayah', 'type', 'note', 'said', 'correct'],
      },
    },
  },
  required: ['transcript', 'mistakes'],
};
export function parseVoiceDraft(value, { surah = 2, passage = null } = {}) {
  if (
    !value ||
    typeof value.transcript !== 'string' ||
    !Array.isArray(value.mistakes) ||
    value.mistakes.length > 30
  )
    throw new Error('Gemini returned an unreadable draft. Try again or type your mistake.');
  if (value.transcript.length > 20000)
    throw new Error('The transcript is too long. Use a shorter recording.');
  const mistakes = value.mistakes
    .map((item) => {
      if (
        !item ||
        !mistakeTypes.includes(item.type) ||
        ['note', 'said', 'correct'].some((key) => typeof item[key] !== 'string' || item[key].length > 10000)
      )
        throw new Error('Gemini returned an unreadable mistake. Try again or enter it manually.');
      const identifiedSurah =
        Number.isInteger(item.surah) && item.surah >= 1 && item.surah <= 114 ? item.surah : null;
      const selectedSurah = identifiedSurah || passage?.fromS || surah;
      const validAyah =
        Number.isInteger(item.ayah) && item.ayah > 0 && item.ayah <= SURAHS[selectedSurah - 1].count;
      const outsidePassage =
        passage &&
        (selectedSurah < passage.fromS ||
          selectedSurah > passage.toS ||
          (validAyah && !inPassage(passage, selectedSurah, item.ayah)));
      // Preserve uncertainty. Never clamp or translate a guessed Hafs/Qalun reference.
      return {
        ...item,
        surah: outsidePassage ? passage.fromS : selectedSurah,
        ayah: !outsidePassage && validAyah ? item.ayah : 0,
        needsReferenceCheck: !identifiedSurah || (item.ayah != null && !validAyah) || Boolean(outsidePassage),
      };
    })
    .filter((item) => item.note.trim() || item.said.trim() || item.correct.trim());
  return { transcript: value.transcript, mistakes };
}
function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read this recording.'));
    reader.readAsDataURL(blob);
  });
}
export async function transcribeMistakes(blob, { apiKey, surah = 2, passage = null, signal } = {}) {
  if (!apiKey) throw new Error('Connect your Gemini key first.');
  if (!blob.size) throw new Error('No audio was recorded. Try speaking again.');
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('Keep recordings under 10 MB.');
  if (globalThis.navigator?.onLine === false)
    throw new Error('Voice transcription needs internet. Your recording is still here; reconnect and retry.');
  const audio = await base64(blob);
  const prompt = `Transcribe this person's description of their Quran memorization mistakes in their original language (including Tunisian Arabic). Extract only explicitly reported mistakes. This is Qalun an Nafi, NOT Hafs. Do not check recitation or invent Quran text, ayah numbers, corrections, or mistakes. If no mistake is clearly described, return an empty mistakes array. Use null for unknown ayah/surah. Preserve words as spoken. The currently selected surah is ${surah}; this is context, not proof of a reference.${passage ? ` Current passage: ${passage.fromS}:${passage.fromA} through ${passage.toS}:${passage.toA}.` : ''} Classify types as recall (forgot continuation), substitution (wrong word), ending (ending/pronoun), order, or other. Each distinct reported mistake is a separate item. Return the full transcript and draft mistakes.`;
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      store: false,
      input: [
        { type: 'text', text: prompt },
        { type: 'audio', data: audio, mime_type: blob.type.split(';')[0] || 'audio/webm' },
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema },
    }),
    signal,
  });
  if (!response.ok) {
    if (['localhost', '127.0.0.1'].includes(globalThis.location?.hostname)) {
      const failure = await response
        .clone()
        .json()
        .catch(() => ({}));
      const detail = String(failure.error?.message || failure.message || response.statusText)
        .replaceAll(apiKey, '[key]')
        .replace(/[A-Za-z0-9+/_=-]{80,}/g, '[omitted]')
        .slice(0, 600);
      console.warn('Gemini configuration error', response.status, detail);
    }
    // Never surface raw server errors: they can contain request or credential details.
    if ([401, 403].includes(response.status))
      throw new Error('Gemini could not use this key. Check its project and API access in Settings.');
    if (response.status === 429)
      throw new Error(
        'Gemini quota is temporarily unavailable. Your recording is kept here; retry later or type the mistake.',
      );
    if (response.status === 503)
      throw new Error('Gemini is busy right now. Your recording is kept here; retry in a moment.');
    throw new Error('Gemini could not process this recording. Retry or type the mistake.');
  }
  const result = await response.json();
  const output =
    result.output_text ||
    result.outputs
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('') ||
    result.steps
      ?.filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content || [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
  if (typeof output !== 'string' || !output.trim())
    throw new Error('Gemini did not return a transcript. Retry or enter your mistake manually.');
  let draft;
  try {
    draft = JSON.parse(output);
  } catch {
    throw new Error('Gemini returned an unreadable transcript. Retry or type your mistake.');
  }
  return parseVoiceDraft(draft, { surah, passage });
}

export class VoiceRecorder {
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
      throw new Error(
        'Recording is unavailable here. Open Hifz in Chrome over HTTPS, or choose an audio file.',
      );
    this.cancelled = false;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.cancelled) {
      this.release();
      throw new DOMException('Recording cancelled', 'AbortError');
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    try {
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
      this.chunks = [];
      this.result = new Promise((resolve, reject) => {
        this.recorder.ondataavailable = (event) => {
          if (event.data.size) this.chunks.push(event.data);
        };
        this.recorder.onstop = () => {
          this.release();
          resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' }));
        };
        this.recorder.onerror = () => {
          this.release();
          reject(new Error('Recording stopped unexpectedly. Please retry.'));
        };
      });
      // Avoid an unhandled rejection if the device fails before Stop is tapped.
      this.result.catch(() => {});
      this.recorder.start();
    } catch (reason) {
      this.release();
      throw reason;
    }
  }
  stop() {
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    return this.result;
  }
  release() {
    this.stream?.getTracks().forEach((track) => track.stop());
  }
  cancel() {
    this.cancelled = true;
    this.stop();
    this.release();
  }
}
