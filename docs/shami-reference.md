# Shami reference and passage entry

Hifz uses the Qalun Shami edition selected by the user on 22 October 2026. The reference was obtained from Kotteb's public Quran metadata endpoints, identified by inspecting the installed app package on the user's authorized USB-connected phone.

Edition identifier: `67a310a41b4df754ac33ca94`.

- [Chapter metadata](https://quranapi.lissene.dev/api/v1/quran/riwayat/67a310a41b4df754ac33ca94/data)
- [Paginated page and verse metadata](https://quranapi.lissene.dev/api/v1/quran/riwayat/67a310a41b4df754ac33ca94/images?page=1&limit=50)

The detailed records contain 604 physical pages, 114 surahs, 6,214 verses and 14,783 verse-selection rectangles. All pages and verse IDs are present exactly once, with contiguous ayah numbering in each surah. Every chapter count and start/end page agrees with the verse records. There are 51 pages containing multiple surahs. The catalog summary's verse total disagrees with the detailed data; it is not used.

`scripts/build-shami-reference.mjs` converts the original page records into `shami-data.js` and `surahs-qalun.json`. It asserts page order, verse ID order and within-surah numbering. The original APK, responses and investigation artifacts remain in ignored `.local/kotteb/`. The shipped data includes Quran text and numeric reference facts, without app code, fonts, image assets, recitations or remote asset links.

This extraction does not establish that the Shami layout matches the user's Dar al-Fajr seventh printed edition, nor independently establish orthographic accuracy. The app names the selected Shami reference and provides a way to check the chosen verse text and adjust workload.

## Workload estimates

Whole-page selections count complete physical pages exactly. For partial boundary pages, Hifz uses the selected verses' vertical span relative to the page's text span, adds any complete intervening pages, then rounds to the nearest quarter page, with a minimum of 0.25. This is an approximate review workload, not a statement that an ayah occupies an exact printed-page fraction. It can overestimate a selection sharing a line with other ayat. The confirmation screen identifies estimates and lets the user override them.

Horizontal selection coordinates are not used or shipped. Some source rectangles have reversed horizontal endpoints or slightly negative horizontal positions. The vertical endpoints used by the workload estimator are finite and ordered. Every whole-page selection is tested to return exactly one page.

## Voice and confirmation

Gemini receives the user's short recording or typed description, plus the selected Shami surah names and counts. It returns a transcript and one proposed contiguous range. Hifz validates it locally against the selected reference and computes page coverage itself. It does not let the model supply Quran text or page amounts. Unknown, missing, reversed or impossible references cannot become a saved default.

The user sees the exact surah/ayah endpoints, first and last verse text, physical page span and adjustable workload before choosing **Confirm & add**. No save occurs when recording stops or the API returns. Whole-page and manual ayah entry work offline; interpreting a spoken or typed description requires Gemini connectivity.
