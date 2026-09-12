// i18n boot module. Imported for side-effect by src/renderer/src/main.tsx.
//
// Per D-19: i18n boots synchronously at renderer entry with `fallbackLng:
// 'en'` + EN + AR bundles loaded. The single `useLanguage()` hook at
// main.tsx mount is the only place that flips `<html dir>` / `<html
// lang>` (every component reads translations via `useTranslation()`).
// Per D-20: `interpolation.escapeValue: false` is safe — react-i18next
// passes strings through React rendering which auto-escapes.
//
// Pattern 5 from RESEARCH.md / 07-RESEARCH.md. The browser-language
// detector is intentionally localStorage-cached so the operator's
// chosen language persists across boots (per D-18 — wizard's success
// toast auto-flips dir; after that, the localStorage value wins).

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en/translation.json';
import ar from './ar/translation.json';

void i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  fallbackLng: 'en',
  supportedLngs: ['en', 'ar'],
  // ponytail: react-i18next already escapes interpolated values via
  // React's text rendering. Setting escapeValue:false disables i18next's
  // own (double) escaping. Required so AR strings can render exactly
  // the bytes committed to translation.json.
  interpolation: { escapeValue: false },
  detection: { order: ['localStorage', 'htmlTag', 'navigator'], caches: ['localStorage'] },
  // ponytail: react already warns on missing keys via MissingMessage
  // in dev. Don't double-warn in prod.
  saveMissing: false,
});

export default i18n;
