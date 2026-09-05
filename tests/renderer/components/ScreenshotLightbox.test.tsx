// @vitest-environment happy-dom
// ScreenshotLightbox — closed-state null-safety, blob-URL image rendering,
// close button. Plan 07 / G-05-10 contract guards. Plan 17 (G-08-10)
// switched the <img> src from the MediaServer `/media/` URL to a fresh
// `blob:` URL fetched via `screenshots.getBlob` so a successful crop
// reflects in the lightbox immediately (no leave / re-enter).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../setup';
import { getApi } from '../setup';
import { ScreenshotLightbox } from '@/components/ScreenshotLightbox';
import type { Screenshot } from '@shared/ipc-contract';

afterEach(() => {
  vi.restoreAllMocks();
});

const fixture: Screenshot = {
  id: 1,
  procedureId: 'proc1',
  timestampInVideoMs: 5_000,
  filePath: 'data/media/p1/screenshots/5000.jpg',
  annotation: null,
  createdAt: 1_000,
};

describe('ScreenshotLightbox', () => {
  it('renders nothing visible when screenshot is null (closed state)', () => {
    render(
      <ScreenshotLightbox
        screenshot={null}
        patientId="p1"
        procedureId="proc1"
        mediaBaseUrl="http://127.0.0.1:51731"
        onClose={vi.fn()}
      />,
    );
    // Radix Dialog renders the content into a portal with display: none
    // (or entirely detached) when closed. The simplest invariant:
    // the <img> is not in the document because src is null and we don't
    // render it. We assert that the image is absent.
    expect(screen.queryByTestId('screenshot-lightbox-img')).toBeNull();
  });

  // Plan 17 (G-08-10) — the lightbox renders the <img> from a fresh
  // `blob:` URL fetched via `screenshots.getBlob` (NOT the MediaServer
  // route). The previous Plan 14 expectation (a `/media/...` src) is
  // dead — see the file header for why we switched.
  it('renders the <img> with a blob: URL fetched via screenshots.getBlob — G-08-10', async () => {
    const api = getApi();
    api.screenshots.getBlob.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x99, 0x99]),
      mimeType: 'image/jpeg',
    });
    render(
      <ScreenshotLightbox
        screenshot={fixture}
        patientId="p1"
        procedureId="proc1"
        mediaBaseUrl="http://127.0.0.1:51731"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(api.screenshots.getBlob).toHaveBeenCalledWith({ id: fixture.id }),
    );
    const img = screen.getByTestId('screenshot-lightbox-img');
    expect(img.getAttribute('src')).toMatch(/^blob:/);
  });

  it('clicking the close button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <ScreenshotLightbox
        screenshot={fixture}
        patientId="p1"
        procedureId="proc1"
        mediaBaseUrl="http://127.0.0.1:51731"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('screenshot-lightbox-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Plan 08-14 — Crop entry point. Plan 17 (G-08-10): the Crop button
  // is gated on the blob fetch landing (we don't render the CTA until
  // we have bytes to preview), so the test waits for that fetch first.
  it('renders a Crop button that opens the crop modal', async () => {
    const api = getApi();
    api.screenshots.getBlob.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      mimeType: 'image/jpeg',
    });
    render(
      <ScreenshotLightbox
        screenshot={fixture}
        patientId="p1"
        procedureId="proc1"
        mediaBaseUrl="http://127.0.0.1:51731"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.screenshots.getBlob).toHaveBeenCalled());
    expect(screen.queryByTestId('screenshot-crop-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('screenshot-lightbox-crop'));
    expect(screen.getByTestId('screenshot-crop-modal')).toBeInTheDocument();
  });

  // Plan 17 (G-08-10) — the Crop button is gated on a successfully
  // fetched blob URL (we don't ship a Crop CTA until the lightbox has
  // bytes to preview). All non-null mediaBaseUrl scenarios resolve to
  // a blob URL via the IPC, so the button always renders here.
  it('renders the Crop button when the screenshot has loaded its blob', async () => {
    const api = getApi();
    api.screenshots.getBlob.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      mimeType: 'image/jpeg',
    });
    render(
      <ScreenshotLightbox
        screenshot={fixture}
        patientId="p1"
        procedureId="proc1"
        mediaBaseUrl="http://127.0.0.1:51731"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.screenshots.getBlob).toHaveBeenCalled());
    expect(screen.queryByTestId('screenshot-lightbox-crop')).not.toBeNull();
  });
});
