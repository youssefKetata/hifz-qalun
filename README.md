# Hifz — Qalun Review (MVP)

An Android-installable, local-first Progressive Web App for memorization revision according to **قالون عن نافع**, using **العدّ المدني الأخير** for surah/ayah counts. No login or database server.

## What's included

- 114 surahs, exact Qalun counts: 6,214 ayat (metadata only, no full Quran text)
- Add what you have memorized using a **start surah/ayah → end surah/ayah** range (even across surahs)
- Assign your physical amount as **0.25, 0.5, 1, 1.5, ... pages**; note your Mushaf's page number if helpful
- Daily schedule, automatic overdue carryover and Easy / Good / Difficult ratings
- Fresh passages reviewed daily for 7 days; then Easy makes the interval grow; Good grows more slowly; Difficult resets to next day; adjustable initial intervals and start date
- Mistake logging: type manually or record audio; Gemini returns *proposed* fields for you to verify before saving
- Yesterday's and due mistakes shown on the Today screen; repeated correction practice with "Reviewed again" and "Mark solid"
- LocalStorage on-device; export/import JSON backups; PWA caches app files for offline use

## Getting the app onto an Android phone

1. Upload **all files in this folder** (not just `index.html`) to an HTTPS static website, e.g. **GitHub Pages** (a public repository is fine because *the files contain no API key*), Cloudflare Pages, or Netlify.
2. Open the hosted URL in **Chrome on Android**.
3. Chrome menu ⋮ → **Add to Home screen** → **Install** (wording varies).
4. Use **My pages** to add the passages you know. Enter exact Qalun ayat and a physical length such as `0.5`.
5. Review passages on Today, tapping Easy, Good, or Difficult when done. In Mistakes, add any slips you had.
6. Use Settings → Export backup periodically. Browser site data can be deleted or lost when switching phones.

### Example GitHub Pages setup

Create a repository, upload the files from this folder into the repository root, commit them; open **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`. The site will be served as HTTPS. No Node/npm/server/database required.

## Gemini (optional)

1. Obtain a personal Gemini API key from https://aistudio.google.com/apikey
2. App Settings (gear) → paste key → Save.
3. Mistakes → Log a mistake → Start recording → Stop. Or choose a saved audio recording or type a description.
4. **Review every generated item against your printed Qalun Mushaf** before saving; Gemini is a formatting/transcription assistant and can hallucinate verse numbers, words or boundaries. Recording on Android requires microphone permission and HTTPS.

Uses `gemini-2.5-flash` `models.generateContent` with inline audio (`audio/webm` etc.). The API has free-tier eligibility/quotas, which vary and may change; it is not guaranteed unlimited. Internet is required for Gemini; everything else is offline after PWA install.

**Key security:** The key is never stored inside shipped source files and is kept in *sessionStorage* in the browser session. However, any browser-side Gemini call makes the key available to the device/browser and requests, so **this direct-from-client approach is for private personal testing, not distributing a shared app**. For a publicly deployed version with multiple users, make authenticated Gemini calls through your own backend/serverless proxy; use key restrictions and rate limits.

## Limitations and edition differences

The riwayah **does not uniquely determine where a printed page starts/ends**. A Qalun printing can use a different line count and number of pages from another Qalun edition. The app intentionally **never invents a surah's physical page count or maps ayat to pages**. You enter the exact ayah range and physical page equivalent. For automatic page-boundary import later, choose your precise Mushaf edition and a verified page-to-ayah mapping.

Qalun surah names/counts checked against https://quranpedia.app/quran/qaloon/index.html (6214 ayat). Metadata only. This version is not a Quran reading app and does not validate the textual correctness of user-specified corrections.

## Development

Local serving (Node or Python):

```bash
python -m http.server 8080
```

Visit http://localhost:8080/. PWA installation and microphone use require localhost or HTTPS. No build step.

Files: `app.js` (UI/storage/Gemini), `surahs.js` (114 metadata), `schedule.js` (scheduler), `index.html`/`style.css`, `sw.js` (offline), icons/manifest. All private review data is stored locally as key `hifz-qalun:v1`.
