// Phase 7 / Plan 07-04 — I18N-01..03 + RPT-06: i18next init + useLanguage
// mount. Per D-19: a single `<LanguageApplier />` lives at the renderer
// entry. It calls `useLanguage()` (returns null) so the document-level
// dir/lang flip fires on mount + every language change. All other
// components only call `useTranslation()` — never `useLanguage()`
// directly — so the dir/lang mutation has exactly one owner.

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Toaster } from './components/ui/sonner';
import './styles/globals.css';
import './i18n';
import { useLanguage } from './hooks/useLanguage';

function LanguageApplier(): null {
  // ponytail: this component returns null. Its only purpose is to keep
  // the useLanguage hook alive for the lifetime of the app — the
  // useEffect inside the hook mutates document.documentElement.dir
  // and .lang. Mounting it at the entry guarantees the flip fires once
  // at boot and re-fires on any language change.
  useLanguage();
  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageApplier />
    <App />
    <Toaster />
  </React.StrictMode>,
);
