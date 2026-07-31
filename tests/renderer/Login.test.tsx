// Static-render Login to a string and assert the resulting HTML contract.
// We use react-dom/server (renderToStaticMarkup) because React 18's commit
// phase in vitest+happy-dom currently throws at getActiveElementDeep — the
// static path bypasses the broken commit while still proving the JSX
// contract for D-05 / D-07 / D-08. The CI grep gates additionally enforce
// the source-level invariant (banner copy literal, type=password, maxLength=4).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import Login from '../../src/renderer/src/pages/Login';

describe('<Login /> static-render contract (D-05 / D-07 / D-08)', () => {
  it('D-05: clinic logo placeholder text "Clinic Logo" is present', () => {
    const html = renderToStaticMarkup(createElement(Login));
    expect(html).toContain('Clinic Logo');
    expect(html).toContain('aria-label="Clinic logo placeholder"');
  });

  it('D-07: PIN input is type=password, maxLength=4, inputMode=numeric, pattern=[0-9]*, disabled', () => {
    const html = renderToStaticMarkup(createElement(Login));
    const inputTag = html.match(/<input[^>]*>/)?.[0] ?? '';
    // React serializes JSX props as-is in static markup; case-insensitive match
    // covers both React's "maxLength"/"inputMode" camelCase output and the
    // HTML "maxlength"/"inputmode" lowercase that the live DOM normalizes to.
    const lower = inputTag.toLowerCase();
    expect(lower).toContain('type="password"');
    expect(lower).toContain('maxlength="4"');
    expect(lower).toContain('inputmode="numeric"');
    expect(lower).toContain('pattern="[0-9]*"');
    expect(inputTag).toMatch(/\bdisabled(=|\s|>)/);
  });

  it('D-08: Enter button is disabled and the literal banner copy is present', () => {
    const html = renderToStaticMarkup(createElement(Login));
    const buttonTag = html.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(buttonTag).toMatch(/\bdisabled(=|\s|>)/);
    expect(buttonTag).toContain('Enter');
    expect(html).toContain('Auth ships in Phase 2 — PIN input is disabled');
  });
});
