# Hifz — Qalun Review

A mobile-first, installable PWA for daily Quran memorization revision. **قالون عن نافع · المصحف الشامي**. Core reviews, page/ayah entry, reference lookup, manual mistakes, and scheduling work offline after the app files are cached. Optional voice passage entry and voice mistakes use your own Gemini API key and an internet connection. No backend or runtime dependency is required.

## Daily use

1. Choose **Add passage → Say it**, describe a range in Arabic or English, and check the draft. You can type a natural-language description instead, choose whole **Pages**, or select exact **Ayat**. Ranges can cross surahs. **Continue after my last passage** starts at the next unmemorized boundary after the furthest saved passage.
2. Check the surah/ayah boundaries, first and last verse text, and exact Shami page span. Whole-page selections give an exact page amount. Partial-page workload is estimated from vertical verse positions and rounded to a quarter page; adjust it under **Page amount & review details**. Change the memorization date or starting interval there when needed. Nothing is saved until **Confirm & add**.
3. Open **Today**, then **Start revision**. Recite independently and check your printed Mushaf.
4. Log a quick note or an exact mistake. Choose **Difficult**, **Good**, or **Easy** to complete the passage; each button previews the next review date.
5. Pause and return anytime. Your session, completed passages, and saved draft note survive reopening. Wait for “Note saved” before closing.
6. Revisit the mistake journal and export a backup periodically from Settings.

Today shows only the due page amount, start/continue action, due passages, the microphone, and mistakes due for practice. With no work due, it shows a short caught-up state. Navigation contains Today, Memorization, and Mistakes; review history is available in Settings. New memorization is always chosen by you. Overlapping new ranges are rejected. Daily page totals use the workload amount you confirm, including any manual adjustment.

## Your Mushaf and reference accuracy

Selected reference: **Qalun / Kotteb Shami Mushaf**, 604 pages, 114 surahs and 6,214 numbered verses. The [source chapter metadata](https://quranapi.lissene.dev/api/v1/quran/riwayat/67a310a41b4df754ac33ca94/data) and paginated verse/page records were extracted and checked on 22 October 2026.

`shami-data.js` contains the selected surah counts, page boundaries, verse text and normalized vertical position bands. `reference.js` performs local reference validation, page lookup, whole-page selection and partial-page workload estimates. `surahs-qalun.json` carries the metadata/provenance copy. No audio, Kotteb app code, fonts or page images are bundled. The app does not contact Kotteb during normal use.

All 604 pages and 6,214 unique verse IDs are present, without page or verse-number gaps. All 114 chapter counts and chapter page boundaries agree with the detailed records. There are 51 pages containing more than one surah. The catalog summary reports an inconsistent Shami verse total, so the app uses the internally consistent detailed records. Tests include a shared page spanning An-Nisa and Al-Ma'idah and the final page's three surahs.

The user's printed Mushaf is **دار الفجر الإسلامي، الطبعة السابعة**. A match to that printed edition has not been independently established. Hifz identifies its selected reference as Shami and does not claim Dar al-Fajr verification. Check boundaries against the Mushaf in use. The user confirmed there are no saved passages to migrate when selecting Shami; no automatic conversion between numbering systems is attempted.

See [the Shami reference notes](docs/shami-reference.md) for the extraction checks and estimate limits, and [the original platform evaluation](docs/platform-evaluation.md) for the PWA decision.

## Scheduling policy v2

The scheduler in `schedule.js` is a transparent heuristic with conservative product defaults, not a scientifically fitted memory model.

- Passages first memorized fewer than seven days ago rehearse daily.
- Difficult returns tomorrow. The next successful review after a lapse also stays daily before expanding again.
- Older passages grow according to the current rating, the last six ratings, and elapsed time since review. Successful overdue recall receives only a bounded bonus.
- Good preserves or increases an established interval; Easy grows faster. Age-dependent caps limit early growth to three days before day 21 and seven days before day 60.
- Settings offers a maximum interval for future growth, default 30 days. Existing longer intervals are preserved on successful ratings, including after migration or lowering this preference.
- Overdue items are never automatically rated as failures and are not duplicated for each missed day. The oldest due date comes first, with difficult passages first when dates tie.
- The next date is calculated from actual review completion using local calendar dates. A passage can be completed once per day. The queue refreshes after midnight and on returning to the app.

Mistakes have a separate practice schedule (2, 4, 8, then 14 days after practice), with a “Mark solid” action. Quick session notes are linked to the passage without inventing an exact ayah number. History totals use the passage's current page amount; edits to its amount also affect displayed historical totals. Removing a passage removes its review history.

## Data and recovery

`storage.js` uses IndexedDB transactions. A successful review is displayed only after a committed write. Failed saves retain the current form/session. Revision checks prevent another open window from silently overwriting newer changes.

On first launch, valid v1 data under localStorage key `hifz-qalun:v1` migrates to IndexedDB. The original localStorage copy is left intact; subsequent launches use IndexedDB. A corrupt record opens a recovery screen rather than silently starting with an empty library.

Settings exports v2 JSON backups and accepts both v1 and v2 backups. Restore validates each passage, reference, date, rating, mistake, and session before asking for confirmation. The replacement is atomic and a pre-restore copy can be downloaded from Settings. Restore replaces current data rather than merging it.

“Protect device storage” requests browser persistence where supported. A request can be denied, and users can still deliberately clear site data. Keep exported backups, particularly before changing phones or domains. Data belongs to its browser origin; migration across domains requires export/import.

## Voice mistakes

Passage entry uses the same Gemini connection and recorder as mistake logging. It supports one contiguous ayah range, an entire surah, or whole page numbers. Gemini only interprets the description; all references and page amounts are calculated and validated locally. Ambiguous or invalid descriptions cannot be saved as a default passage. Recordings and typed descriptions remain available for retry after a provider failure. Closing a recording cancels the request and releases the microphone. Confirmation is always required to save.

Use the microphone on Today or **Speak a mistake** during a review. Describe what happened in Arabic or English, tap **Stop & transcribe**, then check and save the proposed mistake. You can choose an audio file instead. Multiple reported mistakes appear as separate editable drafts, saved one at a time. Nothing is logged until you choose Save. Manual logging stays available.

Settings → Voice mistakes accepts a dedicated Gemini API key. The key is saved as a separate IndexedDB record, never included in review backups or app files, and is sent only to Google's Gemini endpoint in the authentication header. On another phone or browser origin, connect the key once again. There is no shared key in this repository. This direct browser integration is intended for this personal app; browser users with access to the device can inspect their own saved key.

`voice.js` uses Gemini 3.5 Flash-Lite's audio input and structured output through the Interactions API (`store: false`). Only the selected passage context and that recording are sent, not the full library or history. The model transcribes the user's description; it is not a Quran recitation checker. Unknown or impossible ayah references stay unspecified for manual verification. Check every draft against your Qalun Mushaf.

Recording requires microphone permission and HTTPS or localhost. Recordings stop at two minutes; inline clips must be under 10 MB. The microphone is released on stop, cancellation, or closing the dialog. Failed requests retain the clip in the open dialog for replay, download, and retry; closing the dialog discards unsaved audio. Core reviews and manual notes remain offline; transcription needs internet, available quota, and model availability. No billing is enabled by the app.

## Run locally

Node.js 22+:

```sh
npm install
npm start
```

Open [localhost:4173](http://localhost:4173). There is no build step. Node is needed only for the development server and checks, not production hosting. The development server binds to loopback; use an HTTPS deployment when testing installation on a phone.

```sh
npm test
npm run test:browser
npm run format:check
```

Browser tests use installed Google Chrome locally. In CI, install Playwright Chromium (`npx playwright install --with-deps chromium`); the config chooses it when `CI` is set. Tests cover migration, exact/fractional passages, overlap prevention, session resumption, offline cold launch, save failure, backup restoration/recovery, midnight rollover, concurrent windows, responsive layout, keyboard focus, and safe service-worker updates. Visual test captures are kept in ignored `.local/`.

## Host and install on Samsung

Publish the following files together to an HTTPS static host:

```text
index.html          style.css          app.js
schedule.js         model.js           storage.js
voice.js            reference.js       shami-data.js
surahs.js           surahs-qalun.json   sw.js
manifest.webmanifest
icon.svg            icon-192.png       icon-512.png
```

Keep `CNAME` when using the repository's existing GitHub Pages custom domain. No database service or bundler is needed. Do not ship `node_modules`, backups, or local test artifacts.

Open the hosted page in **Chrome on Android**, then use **⋮ → Add to Home screen → Install** (wording may vary). Leave the app open while connected for the first cache installation. Settings reports offline-file readiness. Then test a cold launch in airplane mode on the Samsung.

## Release updates

Bump the app-shell cache version in `sw.js` whenever a cached file changes, and deploy all shell files as one release. Service-worker installation caches the complete shell before it can activate. A waiting update is announced in the app. Finish or pause your review and close forms before choosing “Update when ready.” Updates initiated in another window do not force an active session or form to reload.

The first upgrade from the original v1 app may require closing all old app windows and reopening once: its old interface cannot show the new waiting-update prompt. Browser-managed activation after all windows close remains supported.

Still to verify on the user's physical Samsung: installation, storage persistence decisions, keyboard behavior, airplane-mode cold start, and updating an existing installation. Reliable offline reminders remain optional and are not included. If needed later, an Android target can reuse the UI and scheduling through Capacitor.
