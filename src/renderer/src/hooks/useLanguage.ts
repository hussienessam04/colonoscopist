// useLanguage — single source of truth for the renderer's current
// language. Per D-19 verbatim: "i18next fires from a single
// `useLanguage()` hook called at the renderer entry
// (`src/renderer/src/main.tsx`); every page reads translations via
// `useTranslation()`". The mount-once component in main.tsx is the
// ONLY place this hook should be invoked for the dir/lang flip;
// individual pages should call `useTranslation()` for `t()` only.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type Lang = 'en' | 'ar';

export function useLanguage(): { lang: Lang; setLang: (l: Lang) => void } {
  const { i18n } = useTranslation();
  // ponytail: normalize 'ar-SA' / 'ar-EG' / etc. to 'ar'; anything
  // outside the supportedLngs list to 'en'. matches the i18n.init
  // supportedLngs: ['en', 'ar'].
  const lang: Lang = i18n.language === 'ar' || i18n.language.startsWith('ar-') ? 'ar' : 'en';
  const setLang = (next: Lang): void => {
    void i18n.changeLanguage(next);
  };
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);
  return { lang, setLang };
}
