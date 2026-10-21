# Hifz platform evaluation

Date: 21 October 2026. Repository inspected at commit `1122778`.

## Recommendation

Continue with an installable Chrome PWA for the first version. The user confirmed that reminders while the app is closed and offline are optional. The core workflow—view today's queue, recite independently, log mistakes, rate recall, and save the next due date—can run entirely on the device.

Reuse the existing app, refactoring its scheduling, persistence, and daily review flow. A full native rewrite adds little to this particular first version. Keep scheduling and reference data independent of the UI so an Android package remains possible.

## Platform comparison

| Concern | Installed Chrome PWA | Android APK |
| --- | --- | --- |
| Daily access | Home-screen icon and standalone display | Home-screen icon and Android app integration |
| Offline review | Yes, after successful app-shell caching | Yes, with assets bundled into the package |
| Review scheduling | Calculate from stored dates when opened | Same; background processing is unnecessary for the queue |
| Reminders while closed and offline | Do not promise scheduled local reminders; browser background execution is restricted | Native local notifications can be scheduled, subject to permissions and OS restrictions |
| Updates | Website deployment plus a deliberate service-worker update flow | Build and distribute signed package updates, or use a store |
| Data | Browser-managed storage; request persistence and provide backups | Use durable app storage; still provide backups |
| Work from the existing repository | Smallest implementation and maintenance surface | Can reuse the web UI through Capacitor, with Android tooling and device testing added |

PWA installation and standalone behavior are documented by [web.dev](https://web.dev/learn/pwa/installation). Chrome's [periodic background sync documentation](https://developer.chrome.com/docs/capabilities/periodic-background-sync) explicitly leaves execution timing to the browser. It is not an alarm clock.

An APK need not mean a Kotlin rewrite. [Capacitor](https://capacitorjs.com/docs) bundles a web interface in a native container and exposes native APIs. Its [local notifications plugin](https://capacitorjs.com/docs/apis/local-notifications) schedules device notifications without a push server. Android's [alarm guidance](https://developer.android.com/develop/background-work/services/alarms) describes timing and permission restrictions; delivery should be tested on the user's Samsung. Android requires [signed APKs](https://developer.android.com/studio/publish/app-signing).

## Existing app findings

The repository already contains a standalone manifest, a service worker caching the main assets, 114 Arabic surah names, cross-surah start/end selectors, quarter-page increments, a memorization date, recall ratings, overdue carryover, a mistake journal, and JSON export/import.

The following need attention before treating it as a dependable daily tool:

1. **Scheduling has a confirmed regression.** In `schedule.js`, Good has a 14-day cap while Easy has a 30-day cap. Executing `ratePassage` on a 30-day established passage with Good produces a 14-day interval. Good should maintain or gently increase a stable interval under the agreed policy.
2. **Adaptation is basic.** Memorization age controls only an initial seven-day daily phase. Thereafter the calculation uses the previous interval and current rating; it does not use elapsed review time or the accumulated performance history. `hardCount` is stored but not used for scheduling.
3. **Carryover exists, prioritization needs refinement.** Unpaused passages with due dates on or before today remain due. The current queue sorts by interval first and due date second, so a severely overdue established passage can appear behind all fresh material.
4. **Completion is immediate.** Rating buttons on queue cards complete passages directly. There is no dedicated, resumable review session connecting the passage, mistakes, and final rating.
5. **Persistence needs safer failure handling.** Data is one localStorage JSON value. A failed save raises an alert, but callers can continue to display a success message. Import validates the outer shape rather than every record. Introduce transactional storage, schema validation, versioned migration, and backup recovery while preserving existing data.
6. **Updates need an explicit policy.** Cache-first assets and a manually named cache need coordinated releases and a safe update prompt. Refreshing into a different version during a session should be avoided.
7. **The mistake flow is heavier than the core requirement.** Audio and Gemini controls dominate parts of the interface. A short manual mistake form should be the default for the proposed first version; audio requirements remain unconfirmed because the original brief ends mid-sentence.

Inspection included source review and direct Node execution of scheduling examples. Confirmed: 114 metadata records totaling 6,214 ayat, overdue carryover, one-day intervals for a fresh Easy rating, and the Good interval regression. These checks do not establish accuracy against the printed Mushaf or Android behavior. No application implementation was changed during this evaluation.

## Qalun and the user's Mushaf

The user identified **دار الفجر الإسلامي، الطبعة السابعة، 604 pages**. Store that edition identity separately from riwayah and verse-counting metadata.

The current dataset labels itself Qalun / al-Madani al-akhir and cites the [Quranpedia Qalun index](https://quranpedia.app/quran/qaloon/index.html). That index lists the counts, but also says its text is arranged on Hafs verses for linked commentary and search. Its text links therefore must not be treated as proof of the user's numbered verse boundaries.

[quran-meta](https://github.com/quran-center/quran-meta) is a candidate for comparison: it offers an explicit Qalun entry point, counts, and page divisions. Its documented built-in page layout is a 604-page Madinah layout. This research did **not** verify a dataset matching Dar al-Fajr's seventh edition. Equal total page counts do not prove identical boundaries.

For the first version, keep inclusive start/end surah-and-ayah references and a user-entered page amount such as 0.25, 0.5, or 1.5. Allow optional physical page labels and passages crossing surahs. Never derive length from verse count or substitute Hafs page numbers. Avoid overlapping saved ranges or flag them explicitly so totals do not double-count memorization.

Before presenting the reference database as verified, compare all surah counts and the counting-system description with this edition's index/end matter and check numbered boundaries against its pages. Any automatic page map needs edition-specific provenance and complete boundary verification. Until then, manual passage boundaries are the supported approach.

## Proposed daily experience

Use a calm warm background, deep green accents, legible Arabic, clear contrast, and generous touch targets. Platform choice does not determine visual quality.

- **Today:** total due page equivalents, progress, an ordered queue with short explanations such as Fresh, Reinforcement, Maintenance, or Overdue, and one prominent Start review action.
- **Session:** one passage at a time, exact inclusive references, optional mistake notes, then Difficult / Good / Easy with the proposed next review date. Save progress so closing the app preserves completed work and the current session.
- **My memorization:** add or edit ranges, physical lengths, and when each was first memorized. The user controls new memorization.
- **History and settings:** review history, backup/restore, edition details, and optional preferences kept away from the main task.

The scheduling policy should be versioned and testable. Start fresh material conservatively, let successful recall increase intervals, shorten them after difficulty, and use memorization age together with performance and elapsed time. Choose initial constants as adjustable product defaults rather than claiming a clinically or scientifically validated retention model. Do not mark skipped reviews as failed or create one duplicate task for every missed day. Carry each passage forward once, prioritize overdue/weak material, and schedule its next review from the actual completion date. A daily workload preference may limit a session while keeping the remaining backlog visible.

## Next implementation scope

First verify reference metadata for the named edition, then separate storage and scheduling from UI code, repair the scheduling policy, and build the focused mobile review flow. For the PWA, request persistent storage where available, retain export/import, and make save failures visible without reporting completion. Persistence helps protect against browser eviction but cannot prevent deliberate site-data deletion; see [web.dev storage guidance](https://web.dev/learn/pwa/offline-data).

Before release, validate on the Samsung: installation, cold launch in airplane mode after caching, recording reviews offline, app close/reopen, crossing midnight, missed-day carryover, backup restoration, storage failure, and updating without losing data or session progress. If offline reminders later become essential, add a Capacitor Android target with appropriate native storage and notifications, keeping the same reference and scheduling rules.
