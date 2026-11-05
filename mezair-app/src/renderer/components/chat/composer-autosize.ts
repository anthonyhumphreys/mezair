import { useEffect, useState, type RefObject } from 'react';

export interface ComposerAutosizeBounds {
  minHeight: number;
  maxHeight: number;
}

/** The subset of a textarea the autosizer reads and writes. */
export interface ComposerAutosizeTarget {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  style: { height: string; marginBottom: string };
}

/**
 * Fits the editor height to its content within the bounds.
 *
 * Growth is read from the overflow without collapsing the box, so typing in a capped editor never
 * disturbs its scroll position or caret. Only content that fits can have shrunk, and measuring that
 * needs a collapsed box; while collapsed, a bottom margin holds the editor's footprint so
 * surrounding scroll containers are not clamped.
 */
export function fitComposerTextarea(
  el: ComposerAutosizeTarget,
  { minHeight, maxHeight }: ComposerAutosizeBounds,
): void {
  const currentHeight = el.clientHeight;
  const contentHeight = el.scrollHeight;

  if (contentHeight > currentHeight) {
    const height = `${Math.min(contentHeight, maxHeight)}px`;
    if (el.style.height !== height) el.style.height = height;
    return;
  }
  if (currentHeight <= minHeight) return;

  const marginBottom = el.style.marginBottom;
  el.style.height = `${minHeight}px`;
  el.style.marginBottom = `${currentHeight - minHeight}px`;
  const nextHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.marginBottom = marginBottom;
  el.style.height = `${nextHeight}px`;
}

export interface ComposerAutosizer {
  /** Cancels the scheduled frame, fits the editor now, then runs any pending follow-up. */
  flush(): void;
  /**
   * Coalesces a fit into one animation frame. A follow-up (focus or caret placement) replaces any
   * earlier pending follow-up and runs after the fit, at the next commit flush or the frame.
   */
  schedule(followUp?: () => void): void;
  /** Drops the scheduled frame and any pending follow-up. */
  cancel(): void;
}

export interface ComposerAutosizerOptions {
  getElement: () => ComposerAutosizeTarget | null;
  bounds: ComposerAutosizeBounds;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
}

export function createComposerAutosizer({
  getElement,
  bounds,
  requestFrame,
  cancelFrame,
}: ComposerAutosizerOptions): ComposerAutosizer {
  let frame: number | null = null;
  let followUp: (() => void) | null = null;

  const run = () => {
    const pending = followUp;
    followUp = null;
    const el = getElement();
    if (el) fitComposerTextarea(el, bounds);
    pending?.();
  };

  const cancelScheduledFrame = () => {
    if (frame === null) return;
    cancelFrame(frame);
    frame = null;
  };

  return {
    flush() {
      cancelScheduledFrame();
      run();
    },
    schedule(nextFollowUp) {
      if (nextFollowUp) followUp = nextFollowUp;
      if (frame !== null) return;
      frame = requestFrame(() => {
        frame = null;
        run();
      });
    },
    cancel() {
      cancelScheduledFrame();
      followUp = null;
    },
  };
}

/** A stable autosizer for a textarea ref; scheduled work is cancelled on unmount. */
export function useComposerAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  bounds: ComposerAutosizeBounds,
): ComposerAutosizer {
  const [autosizer] = useState(() =>
    createComposerAutosizer({
      getElement: () => ref.current,
      bounds,
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    }),
  );
  useEffect(() => () => autosizer.cancel(), [autosizer]);
  return autosizer;
}
