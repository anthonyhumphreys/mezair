import { describe, expect, it } from 'vitest';
import {
  nextAutoCollapsed,
  resolvePanelWidth,
  shouldAutoCollapsePanel,
} from '../ResizableSidebarPanel';

describe('shouldAutoCollapsePanel', () => {
  it('auto-collapses below the threshold when the panel is not manually collapsed', () => {
    expect(
      shouldAutoCollapsePanel({
        viewportWidth: 1024,
        threshold: 1200,
        persistedCollapsed: false,
      }),
    ).toBe(true);
  });

  it('does not auto-collapse above the threshold', () => {
    expect(
      shouldAutoCollapsePanel({
        viewportWidth: 1440,
        threshold: 1200,
        persistedCollapsed: false,
      }),
    ).toBe(false);
  });

  it('does not treat an already persisted manual collapse as responsive auto-collapse', () => {
    expect(
      shouldAutoCollapsePanel({
        viewportWidth: 1024,
        threshold: 1200,
        persistedCollapsed: true,
      }),
    ).toBe(false);
  });
});

describe('nextAutoCollapsed', () => {
  it('collapses on first layout when the window is already narrow', () => {
    expect(nextAutoCollapsed({ wasNarrow: null, isNarrow: true, autoCollapsed: false })).toBe(true);
    expect(nextAutoCollapsed({ wasNarrow: null, isNarrow: false, autoCollapsed: false })).toBe(
      false,
    );
  });

  it('collapses when the window crosses from wide to narrow', () => {
    expect(nextAutoCollapsed({ wasNarrow: false, isNarrow: true, autoCollapsed: false })).toBe(
      true,
    );
  });

  it('releases the responsive collapse when the window crosses back to wide', () => {
    expect(nextAutoCollapsed({ wasNarrow: true, isNarrow: false, autoCollapsed: true })).toBe(
      false,
    );
  });

  it('keeps an explicit expand while resizing within the narrow range', () => {
    // The user expanded the rail (autoCollapsed cleared); further narrow resizes keep it open.
    expect(nextAutoCollapsed({ wasNarrow: true, isNarrow: true, autoCollapsed: false })).toBe(
      false,
    );
  });

  it('keeps the current state while resizing within the wide range', () => {
    expect(nextAutoCollapsed({ wasNarrow: false, isNarrow: false, autoCollapsed: false })).toBe(
      false,
    );
  });
});

describe('resolvePanelWidth', () => {
  it('allows a collapsed panel to consume no layout width', () => {
    expect(resolvePanelWidth({ width: 320, collapsedWidth: 0, collapsed: true })).toBe(0);
  });

  it('uses the stored width while expanded', () => {
    expect(resolvePanelWidth({ width: 320, collapsedWidth: 0, collapsed: false })).toBe(320);
  });
});
