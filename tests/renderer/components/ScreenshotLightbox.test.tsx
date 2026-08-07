// @vitest-environment happy-dom
// ScreenshotLightbox — closed-state null-safety, full-size URL composition,
// close button. Plan 07 / G-05-10 contract guards.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../setup';
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

  it('renders the full-size <img> via /media/ route when screenshot is supplied — G-05-10', () => {
    render(
      <ScreenshotLightbox
        screenshot={fixture}
        patientId="p1"
        procedureId="proc1"
        mediaBaseUrl="http://127.0.0.1:51731"
        onClose={vi.fn()}
      />,
    );
    const img = screen.getByTestId('screenshot-lightbox-img');
    // G-05-14 — URL includes the literal `screenshots/` subdir segment
    // that matches the on-disk layout (paths.ts::screenshotsDir writes
    // to <userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg).
    // fileName extracted from "data/media/p1/screenshots/5000.jpg" -> "5000.jpg".
    expect(img.getAttribute('src')).toBe(
      'http://127.0.0.1:51731/media/p1/proc1/screenshots/5000.jpg',
    );
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
});
