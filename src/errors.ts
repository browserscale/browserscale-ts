import type {
  DragResult,
  ElementResult,
  OccluderInfo,
  SelectOptionResult,
  WaitConditionStatus,
  WaitResult,
} from "./types.ts";

/**
 * BrowserScaleError is the base class for every error thrown by the SDK. It
 * wraps either:
 *   - a client-side validation failure (bad locator, missing patterns, …)
 *   - a server-side gRPC error (Connect's ConnectError, available as `cause`)
 *
 * Semantic action failures (an occluded click, a wait timeout, an option that
 * did not exist, …) are thrown as the typed subclasses below, each carrying the
 * same structured detail the Go SDK exposes via `errors.As` — plus the partial
 * result of the attempted action on `.result`, so a single `catch` gives you
 * both the diagnostics and the resolved coordinates.
 *
 * Catch the base for anything, or narrow to a subclass for the detail:
 *
 *   try {
 *     await browser.click(css("#btn"));
 *   } catch (e) {
 *     if (e instanceof ClickError) console.log(e.code, e.occluder?.tagName);
 *     else if (e instanceof BrowserScaleError) { ... }
 *   }
 */
export class BrowserScaleError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BrowserScaleError";
  }
}

/**
 * ClickError is thrown by {@link CloudBrowser.click} when the click did not
 * land — the target was found but another element covered the intended point.
 * `occluder` describes the blocker; `result` carries the resolved element and
 * coordinates (success is false).
 *
 * It is also nested under {@link FillError} / {@link DragError} as the
 * underlying click-core failure; in that nested form `result` is undefined
 * (the partial result lives on the outer error).
 */
export class ClickError extends BrowserScaleError {
  /**
   * Machine-stable failure code, e.g. `"occluded_no_reachable_point"` (target
   * fully covered, no exposed part reachable), `"occluded_after_evade"` (a
   * reposition was tried but the target was still covered) or `"not_found"`.
   */
  readonly code: string;
  /** The intercepting element (present for occlusion codes). */
  readonly occluder?: OccluderInfo;
  /** Whether a pointer reposition was tried before giving up. */
  readonly evadeAttempted: boolean;
  /**
   * Resolved element + coordinates at the failed action. Present when this is
   * the thrown top-level error; undefined when nested inside another error.
   */
  readonly result?: ElementResult;

  constructor(init: {
    code: string;
    message: string;
    occluder?: OccluderInfo;
    evadeAttempted?: boolean;
    result?: ElementResult;
  }) {
    super(formatMessage("click", init.code, init.message));
    this.name = "ClickError";
    this.code = init.code;
    this.occluder = init.occluder;
    this.evadeAttempted = init.evadeAttempted ?? false;
    this.result = init.result;
  }
}

/**
 * FillError is thrown by {@link CloudBrowser.fill} when the field could not be
 * focused/typed. Fill focuses with the exact same smart click as
 * {@link CloudBrowser.click}, so a pre-typing failure is a click failure:
 * `code` mirrors it and the full click diagnostics live under `clickError`.
 */
export class FillError extends BrowserScaleError {
  /** Mirrored from the underlying click failure. */
  readonly code: string;
  /** The underlying click-core failure that prevented focusing/typing. */
  readonly clickError?: ClickError;
  /** Resolved element + coordinates at the failed action (success is false). */
  readonly result: ElementResult;

  constructor(init: {
    code: string;
    message: string;
    clickError?: ClickError;
    result: ElementResult;
  }) {
    super(formatMessage("fill", init.code, init.message));
    this.name = "FillError";
    this.code = init.code;
    this.clickError = init.clickError;
    this.result = init.result;
  }
}

/**
 * DragError is thrown by {@link CloudBrowser.dragBy} / {@link CloudBrowser.dragTo}
 * when the source element could not be acquired/pressed. Drag picks up the
 * source with the same smart click as {@link CloudBrowser.click}, so a pre-drag
 * failure is a click failure: `code` mirrors it and the full click diagnostics
 * live under `clickError`.
 */
export class DragError extends BrowserScaleError {
  readonly code: string;
  readonly clickError?: ClickError;
  /** Resolved source + coordinates at the failed drag (success is false). */
  readonly result: DragResult;

  constructor(init: {
    code: string;
    message: string;
    clickError?: ClickError;
    result: DragResult;
  }) {
    super(formatMessage("drag", init.code, init.message));
    this.name = "DragError";
    this.code = init.code;
    this.clickError = init.clickError;
    this.result = init.result;
  }
}

/**
 * ScrollError is thrown by {@link CloudBrowser.scrollTo} when the target could
 * not be located/scrolled.
 */
export class ScrollError extends BrowserScaleError {
  /** Currently always `"not_found"`. */
  readonly code: string;
  readonly result: ElementResult;

  constructor(init: { code: string; message: string; result: ElementResult }) {
    super(formatMessage("scrollTo", init.code, init.message));
    this.name = "ScrollError";
    this.code = init.code;
    this.result = init.result;
  }
}

/**
 * MoveError is thrown by {@link CloudBrowser.moveTo} when the target could not
 * be located. A move has no occlusion notion, so this is the only semantic
 * failure.
 */
export class MoveError extends BrowserScaleError {
  /** Currently always `"not_found"`. */
  readonly code: string;
  readonly result: ElementResult;

  constructor(init: { code: string; message: string; result: ElementResult }) {
    super(formatMessage("moveTo", init.code, init.message));
    this.name = "MoveError";
    this.code = init.code;
    this.result = init.result;
  }
}

/**
 * SelectOptionError is thrown by the {@link CloudBrowser.selectByIndex} /
 * `selectByValue` / `selectByText` calls when the option could not be selected.
 * selectOption is programmatic (no pointer gate), so it only reports semantic
 * failures.
 */
export class SelectOptionError extends BrowserScaleError {
  /**
   * `"not_found"` (the `<select>` was not located) or `"option_not_found"` (no
   * option matched the requested index/value/text).
   */
  readonly code: string;
  readonly result: SelectOptionResult;

  constructor(init: { code: string; message: string; result: SelectOptionResult }) {
    super(formatMessage("selectOption", init.code, init.message));
    this.name = "SelectOptionError";
    this.code = init.code;
    this.result = init.result;
  }
}

/**
 * WaitError is thrown by {@link CloudBrowser.wait} / {@link CloudBrowser.waitAny}
 * when no condition matched before the deadline. `conditions` holds the
 * per-condition breakdown (same order/length as the conditions passed in)
 * explaining why each one never matched.
 */
export class WaitError extends BrowserScaleError {
  /** Machine-stable failure code, currently always `"timeout"`. */
  readonly code: string;
  /** Per-condition status, same order/length as the conditions passed to wait. */
  readonly conditions: WaitConditionStatus[];
  /** The partial wait result (index is -1 on timeout). */
  readonly result: WaitResult;

  constructor(init: {
    code: string;
    message: string;
    conditions: WaitConditionStatus[];
    result: WaitResult;
  }) {
    super(formatMessage("wait", init.code, init.message));
    this.name = "WaitError";
    this.code = init.code;
    this.conditions = init.conditions;
    this.result = init.result;
  }
}

function formatMessage(action: string, code: string, message: string): string {
  const base = `${action} failed: ${code}`;
  return message ? `${base}: ${message}` : base;
}
