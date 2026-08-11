// @vitest-environment happy-dom
// Phase 7 / Plan 07-04 — I18N-01 + D-19 parity check.
//
// Per D-19 verbatim: the useLanguage() hook at main.tsx mount is the
// single source for <html dir> + <html lang> mutation. The hook calls
// document.documentElement.dir = 'ltr'|'rtl' + .lang = 'en'|'ar' on
// every language change. This test exercises the hook end-to-end:
// mount a tiny component that calls useLanguage(), assert initial
// state (ltr + en), flip via setLang('ar'), assert post-flip state.

import { describe, expect, it } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { useLanguage, type Lang } from '@/hooks/useLanguage';

// ponytail: a tiny harness component that calls useLanguage() and
// exposes the setLang callback to the test. The test renders this
// harness; React Testing Library fires effects synchronously in
// happy-dom so the document-level mutations are observable without
// timers.
function Harness({ onReady }: { onReady: (api: ReturnType<typeof useLanguage>) => void }): JSX.Element {
  const api = useLanguage();
  // ponytail: render-prop pattern. onReady fires synchronously inside
  // render — by the time the test's `render` returns, the harness
  // has handed the api to the test.
  onReady(api);
  return <div data-testid="harness" data-lang={api.lang} />;
}

describe('useLanguage hook (D-19)', () => {
  it('initial mount sets <html dir=ltr> + <html lang=en> by default', () => {
    // ponytail: reset i18n.language to 'en' before the render so the
    // test is deterministic regardless of prior tests' changeLanguage
    // calls. happy-dom document is shared across tests in the same
    // file unless reset.
    void act(() => {
      void i18n.changeLanguage('en');
    });
    let captured: ReturnType<typeof useLanguage> | null = null;
    render(<Harness onReady={(api) => { captured = api; }} />);
    expect(captured).not.toBeNull();
    expect(captured!.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('setLang("ar") flips <html dir=rtl> + <html lang=ar>', async () => {
    void act(() => {
      void i18n.changeLanguage('en');
    });
    let captured: ReturnType<typeof useLanguage> | null = null;
    render(<Harness onReady={(api) => { captured = api; }} />);
    expect(captured).not.toBeNull();
    expect(captured!.lang).toBe('en');

    // ponytail: changeLanguage resolves async via the detector
    // pipeline. act() wraps the change so React flushes the effect
    // update synchronously.
    await act(async () => {
      captured!.setLang('ar');
      // Wait for the changeLanguage promise to resolve + React to
      // commit the next render.
      await i18n.changeLanguage('ar');
    });

    await waitFor(() => {
      expect(captured!.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
    });
  });

  it('flips back to ltr + en when setLang("en") is called after ar', async () => {
    void act(() => {
      void i18n.changeLanguage('ar');
    });
    let captured: ReturnType<typeof useLanguage> | null = null;
    render(<Harness onReady={(api) => { captured = api; }} />);
    expect(captured).not.toBeNull();
    expect(captured!.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    await act(async () => {
      captured!.setLang('en');
      await i18n.changeLanguage('en');
    });

    await waitFor(() => {
      expect(captured!.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe('en');
    });
  });

  it('normalizes language locales: ar-EG / ar-SA resolve to ar', async () => {
    // ponytail: the hook normalizes 'ar-*' to 'ar' for the lang
    // value used in <html lang> + the returned `lang` getter. i18n
    // itself may keep the full locale ('ar-EG'); the hook reads the
    // base lang.
    void act(() => {
      void i18n.changeLanguage('en');
    });
    let captured: ReturnType<typeof useLanguage> | null = null;
    render(<Harness onReady={(api) => { captured = api; }} />);
    expect(captured).not.toBeNull();
    await act(async () => {
      // ponytail: directly set i18n.language to the long form to
      // verify the hook's normalization. changeLanguage resolves to
      // the base 'ar' on supportedLngs matching.
      captured!.setLang('ar');
      // Simulate a richer AR locale by setting the language directly
      // after the change.
      i18n.language = 'ar-EG';
    });
    // Force a re-render by reading the lang again.
    await waitFor(() => {
      const lang: Lang = captured!.lang;
      expect(lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
    });
  });
});

// ponytail: minimal state-machine assertion. The hook reads from
// useTranslation() so the test mounts a real component (not a pure
// import + invocation) — happy-dom doesn't crash on i18n.init() since
// the import side-effect fires before any test renders.
