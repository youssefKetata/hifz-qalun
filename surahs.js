// Qalun / Kotteb Shami Mushaf; audited 604-page reference.
import { SHAMI_SURAHS as SURAHS } from './shami-data.js';
export { SURAHS };
export function surah(n) {
  return SURAHS[Number(n) - 1] || SURAHS[1];
}
// Isolate the numeric range so an Arabic paragraph cannot display 74–90 as 90–74.
export function passageLabel(p) {
  const a = surah(p.fromS),
    b = surah(p.toS);
  return Number(p.fromS) === Number(p.toS)
    ? `${a.name} · \u2066${p.fromA}–${p.toA}\u2069`
    : `${a.name} ${p.fromA} ← ${b.name} ${p.toA}`;
}
