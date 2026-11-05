import { describe, expect, it, vi } from 'vitest';
import {
  createComposerAutosizer,
  fitComposerTextarea,
  type ComposerAutosizeBounds,
} from '../composer-autosize';

const BOUNDS: ComposerAutosizeBounds = { minHeight: 76, maxHeight: 200 };
const NATURAL_ONE_ROW_HEIGHT = 56;

/**
 * Models the composer textarea: rows=1, CSS min-height 76px / max-height 200px, border-box with no
 * border. Every geometry read is a forced layout that clamps the scroll offset and records the
 * vertical footprint surrounding layout would see.
 */
class FakeStyle {
  marginBottom = '';
  readonly heightWrites: string[] = [];

  constructor(private declaredHeight: string) {}

  get height(): string {
    return this.declaredHeight;
  }

  set height(value: string) {
    this.heightWrites.push(value);
    this.declaredHeight = value;
  }
}

class FakeComposerTextarea {
  contentHeight: number;
  layoutFootprints: number[] = [];
  readonly style: FakeStyle;
  private scrollOffset = 0;

  constructor(contentHeight: number, height = '') {
    this.contentHeight = contentHeight;
    this.style = new FakeStyle(height);
  }

  get heightWrites(): string[] {
    return this.style.heightWrites;
  }

  /** Smallest footprint seen by layout since the last call. */
  takeMinFootprint(): number {
    const min = Math.min(...this.layoutFootprints);
    this.layoutFootprints = [];
    return min;
  }

  get clientHeight(): number {
    return this.layout().box;
  }

  get scrollHeight(): number {
    const { box } = this.layout();
    return Math.max(this.contentHeight, box);
  }

  get scrollTop(): number {
    this.layout();
    return this.scrollOffset;
  }

  set scrollTop(value: number) {
    this.scrollOffset = value;
    this.layout();
  }

  private layout() {
    const { height, marginBottom } = this.style;
    const declared = height.endsWith('px') ? Number.parseFloat(height) : NATURAL_ONE_ROW_HEIGHT;
    const box = Math.min(Math.max(declared, BOUNDS.minHeight), BOUNDS.maxHeight);
    const margin = marginBottom ? Number.parseFloat(marginBottom) : 0;
    this.scrollOffset = Math.min(
      Math.max(this.scrollOffset, 0),
      Math.max(0, this.contentHeight - box),
    );
    this.layoutFootprints.push(box + margin);
    return { box };
  }
}

function textarea(contentHeight: number, height = ''): FakeComposerTextarea {
  return new FakeComposerTextarea(contentHeight, height);
}

describe('fitComposerTextarea', () => {
  it('keeps a short draft at the 76px starting height without writing', () => {
    const el = textarea(56);
    fitComposerTextarea(el, BOUNDS);
    expect(el.heightWrites).toEqual([]);
    expect(el.clientHeight).toBe(76);
  });

  it('grows for a new line or multiline paste with one write and no collapse', () => {
    const el = textarea(76);
    fitComposerTextarea(el, BOUNDS);
    el.contentHeight = 128;
    fitComposerTextarea(el, BOUNDS);
    expect(el.heightWrites).toEqual(['128px']);

    el.takeMinFootprint();
    el.contentHeight = 1_200;
    fitComposerTextarea(el, BOUNDS);
    expect(el.takeMinFootprint()).toBe(128);
    expect(el.heightWrites).toEqual(['128px', '200px']);
  });

  it('leaves a capped, overflowing editor and its scroll position untouched while typing', () => {
    const el = textarea(800, '200px');
    el.scrollTop = 420;

    for (const contentHeight of [826, 852, 826]) {
      el.contentHeight = contentHeight;
      fitComposerTextarea(el, BOUNDS);
    }

    expect(el.takeMinFootprint()).toBe(200);
    expect(el.heightWrites).toEqual([]);
    expect(el.scrollTop).toBe(420);
  });

  it('shrinks after deletion without exposing a collapsed footprint', () => {
    const el = textarea(180, '180px');
    el.contentHeight = 102;
    fitComposerTextarea(el, BOUNDS);

    expect(el.takeMinFootprint()).toBe(180);
    expect(el.clientHeight).toBe(102);
    expect(el.style.marginBottom).toBe('');
  });

  it('leaves the cap once deleted content fits again', () => {
    const el = textarea(150, '200px');
    fitComposerTextarea(el, BOUNDS);
    expect(el.takeMinFootprint()).toBe(200);
    expect(el.clientHeight).toBe(150);
  });

  it('returns to the starting height when send clears the draft', () => {
    const el = textarea(600, '200px');
    el.contentHeight = 56;
    fitComposerTextarea(el, BOUNDS);
    expect(el.clientHeight).toBe(76);
    expect(el.heightWrites.at(-1)).toBe('76px');
  });

  it('restores an existing inline bottom margin after measuring', () => {
    const el = textarea(150, '150px');
    el.style.marginBottom = '4px';
    el.contentHeight = 100;
    fitComposerTextarea(el, BOUNDS);
    expect(el.style.marginBottom).toBe('4px');
    expect(el.clientHeight).toBe(100);
  });

  it('does not size a hidden editor to zero', () => {
    const hidden = {
      clientHeight: 0,
      scrollHeight: 0,
      style: { height: '', marginBottom: '' },
    };
    fitComposerTextarea(hidden, BOUNDS);
    expect(hidden.style.height).toBe('');
  });
});

function frameHarness() {
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  return {
    frames,
    requestFrame: vi.fn((callback: () => void) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    }),
    cancelFrame: vi.fn((handle: number) => {
      frames.delete(handle);
    }),
    runFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
  };
}

function autosizerFor(el: FakeComposerTextarea | null) {
  const harness = frameHarness();
  const autosizer = createComposerAutosizer({
    getElement: () => el,
    bounds: BOUNDS,
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
  });
  return { autosizer, harness };
}

describe('createComposerAutosizer', () => {
  it('coalesces repeated width changes into one frame and one fit', () => {
    const el = textarea(76);
    const { autosizer, harness } = autosizerFor(el);

    el.contentHeight = 154;
    autosizer.schedule();
    autosizer.schedule();
    autosizer.schedule();
    expect(harness.requestFrame).toHaveBeenCalledTimes(1);

    harness.runFrames();
    expect(el.heightWrites).toEqual(['154px']);

    autosizer.schedule();
    expect(harness.requestFrame).toHaveBeenCalledTimes(2);
  });

  it('fits on commit, cancels the obsolete frame and places the caret after the fit', () => {
    const el = textarea(76);
    const { autosizer, harness } = autosizerFor(el);
    const order: string[] = [];

    autosizer.schedule(() => order.push(`caret at ${el.clientHeight}px`));
    el.contentHeight = 128;
    autosizer.flush();

    expect(harness.cancelFrame).toHaveBeenCalledTimes(1);
    expect(harness.frames.size).toBe(0);
    expect(order).toEqual(['caret at 128px']);

    autosizer.flush();
    expect(order).toHaveLength(1);
  });

  it('runs only the latest follow-up and keeps it when a plain fit is scheduled', () => {
    const el = textarea(76);
    const { autosizer, harness } = autosizerFor(el);
    const first = vi.fn();
    const latest = vi.fn();

    autosizer.schedule(first);
    autosizer.schedule(latest);
    autosizer.schedule();
    harness.runFrames();

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('applies the follow-up in the frame when the value did not change', () => {
    const el = textarea(76);
    const { autosizer, harness } = autosizerFor(el);
    const focus = vi.fn();

    autosizer.schedule(focus);
    harness.runFrames();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('drops pending caret work from the previous draft on cancel', () => {
    const el = textarea(76);
    const { autosizer, harness } = autosizerFor(el);
    const previousDraftCaret = vi.fn();

    autosizer.schedule(previousDraftCaret);
    autosizer.cancel();
    expect(harness.frames.size).toBe(0);

    el.contentHeight = 102;
    autosizer.flush();
    harness.runFrames();
    expect(previousDraftCaret).not.toHaveBeenCalled();
    expect(el.clientHeight).toBe(102);
  });

  it('still runs follow-ups when the editor is not mounted', () => {
    const { autosizer } = autosizerFor(null);
    const followUp = vi.fn();
    autosizer.schedule(followUp);
    autosizer.flush();
    expect(followUp).toHaveBeenCalledTimes(1);
  });
});
