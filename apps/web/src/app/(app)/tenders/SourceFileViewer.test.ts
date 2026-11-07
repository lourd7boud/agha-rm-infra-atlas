import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import * as SourceViewerModule from './SourceFileViewer';
import { SourceFileViewer } from './SourceFileViewer';

describe('tender source split view', () => {
  it('routes Office documents to the authenticated local preview service', () => {
    const previewUrl = (
      SourceViewerModule as typeof SourceViewerModule & {
        sourceFilePreviewUrl?: (
          tenderId: string,
          file: { name: string; kind: 'excel' | 'word' },
        ) => string;
      }
    ).sourceFilePreviewUrl;

    expect(
      previewUrl?.('tender 1', { name: 'DCE/BPDE final.xlsx', kind: 'excel' }),
    ).toBe(
      '/api/tenders/tender%201/files/preview?name=DCE%2FBPDE%20final.xlsx',
    );
  });

  it('uses the whole remaining desktop width and clamps dragged detail width', () => {
    const clamp = (
      SourceViewerModule as typeof SourceViewerModule & {
        clampTenderDetailWidth?: (viewportWidth: number, requestedWidth: number) => number;
      }
    ).clampTenderDetailWidth;
    const fromDivider = (
      SourceViewerModule as typeof SourceViewerModule & {
        tenderDetailWidthFromDivider?: (viewportWidth: number, clientX: number) => number;
      }
    ).tenderDetailWidthFromDivider;

    expect(clamp?.(1920, 640)).toBe(640);
    expect(fromDivider?.(1920, 1280)).toBe(640);
    expect(fromDivider?.(1920, 1600)).toBe(420);
    expect(fromDivider?.(1920, 900)).toBe(760);
    expect(clamp?.(1024, 640)).toBe(544);
  });

  it('renders an accessible draggable separator in side mode', () => {
    const html = renderToStaticMarkup(
      createElement(SourceFileViewer as never, {
        tenderId: 'tender-1',
        onClose: vi.fn(),
        mode: 'side',
        bordereauOnly: true,
        drawerWidth: 640,
        onDrawerWidthChange: vi.fn(),
        desktopSplit: true,
      }),
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('Redimensionner');
    expect(html).toContain('aria-modal="false"');
    expect(html).toMatch(/role="separator" tabindex="0"/);
  });

  it('exposes the narrow-screen source viewer as a focusable modal', () => {
    const html = renderToStaticMarkup(
      createElement(SourceFileViewer as never, {
        tenderId: 'tender-1',
        onClose: vi.fn(),
        mode: 'side',
        bordereauOnly: true,
        desktopSplit: false,
      }),
    );

    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toMatch(/role="separator" tabindex="-1"/);
  });
});
