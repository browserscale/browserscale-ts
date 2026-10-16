import { Code, ConnectError } from "@connectrpc/connect";
import type { Page } from "./page.ts";
import type {
  DragResult,
  ElementRef,
  ElementResult,
  OccluderInfo,
  SelectOptionResult,
  WaitConditionStatus,
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
 *     await page.click(css("#btn"));
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
 * CommandError is thrown when the browser carried out a command correctly but
 * the page would not go along with it. It is the error for the commands that
 * have nothing to report beyond what went wrong; the richer failures have their
 * own class ({@link ClickError}, {@link FillError}, {@link DragError}) carrying
 * the same `code` plus their own detail.
 *
 * It never reports an outage. A dead session, a closed page or a malformed call
 * arrive as a plain {@link BrowserScaleError} instead, so narrowing to this
 * class tells you the fault is in the page or in what you asked of it — which is
 * the difference between retrying and fixing your code.
 *
 *   try {
 *     await page.evaluate("window.__ready === true");
 *   } catch (e) {
 *     if (e instanceof CommandError && e.code === "threw") {
 *       // the expression itself is broken; e.message has the exception text
 *     }
 *   }
 */
/**
 * Raises the optional error of a uniform result, and does nothing when the
 * command succeeded — so a call site stays one line instead of an if.
 */
export function throwCommandError(
  command: string,
  error?: { code: string; message: string },
): void {
  if (error) {
    throw new CommandError({ command, code: error.code, message: error.message });
  }
}

export class CommandError extends BrowserScaleError {
  /** The call that failed, e.g. `"evaluate"`. */
  readonly command: string;
  /**
   * Machine-stable and lowercase, and scoped to `command`: the same string can
   * mean different things for different commands, so narrow on it together with
   * the call you made.
   */
  readonly code: string;

  constructor(init: { command: string; code: string; message: string }) {
    super(formatMessage(init.command, init.code, init.message));
    this.name = "CommandError";
    this.command = init.command;
    this.code = init.code;
  }
}

/**
 * ClickError is thrown by {@link Page.click} when the click did not
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
   * reposition was tried but the target was still covered), `"not_found"` or
   * `"captcha_failed"` (a captcha appeared during the click and auto-solve
   * could not solve it, with `onFailure: "fail"`).
   */
  readonly code: string;
  /** The intercepting element (present for occlusion codes). */
  readonly occluder?: OccluderInfo;
  /** Whether a pointer reposition was tried before giving up. */
  readonly evadeAttempted: boolean;
  /**
   * For code `"page_not_focused"`, the page that has the focus. The call
   * throws a {@link PageNotFocusedError} around this error then.
   */
  readonly focusedPageId?: string;
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
    focusedPageId?: string;
    result?: ElementResult;
  }) {
    super(formatMessage("click", init.code, init.message));
    this.name = "ClickError";
    this.code = init.code;
    this.occluder = init.occluder;
    this.evadeAttempted = init.evadeAttempted ?? false;
    this.focusedPageId = init.focusedPageId;
    this.result = init.result;
  }
}

/**
 * FillError is thrown by {@link Page.fill} when the field could not be
 * focused/typed. The click-phase codes (`"not_found"`,
 * `"occluded_no_reachable_point"`, `"occluded_after_evade"`) mirror the
 * underlying focus click, with diagnostics under `clickError`. The focus codes
 * are `"focus_stolen"` (another element took focus — `focusedElement` names it;
 * fill is strictly target-bound and will not type into the thief) and
 * `"focus_lost"` (focus left the target and nothing is focused).
 * `"captcha_failed"`: a captcha appeared during the fill and auto-solve could
 * not solve it, with `onFailure: "fail"`. For untargeted stream typing that
 * lets focus move (e.g. OTP), use {@link Page.type}.
 */
export class FillError extends BrowserScaleError {
  /** Machine-stable failure code (see the class doc for the full set). */
  readonly code: string;
  /**
   * The underlying click-core failure that prevented focusing/typing. Present
   * for the click-phase codes; undefined for `"focus_stolen"`/`"focus_lost"`.
   */
  readonly clickError?: ClickError;
  /**
   * Node that held focus when fill gave up (0 if nothing was focused), for the
   * `"focus_stolen"`/`"focus_lost"` codes.
   */
  readonly focusedBackendNodeId?: number;
  /**
   * The element that grabbed focus instead of the target (`"focus_stolen"`), so
   * you can act on it (e.g. a consent button).
   */
  readonly focusedElement?: ElementRef;
  /**
   * The fill target's own state at the point of failure (the focus codes):
   * whether it is still an editable text sink and its current text length.
   */
  readonly targetEditable?: boolean;
  readonly targetValueLength?: number;
  /** Resolved element + coordinates at the failed action (success is false). */
  readonly result: ElementResult;

  constructor(init: {
    code: string;
    message: string;
    clickError?: ClickError;
    focusedBackendNodeId?: number;
    focusedElement?: ElementRef;
    targetEditable?: boolean;
    targetValueLength?: number;
    result: ElementResult;
  }) {
    super(formatMessage("fill", init.code, init.message));
    this.name = "FillError";
    this.code = init.code;
    this.clickError = init.clickError;
    this.focusedBackendNodeId = init.focusedBackendNodeId;
    this.focusedElement = init.focusedElement;
    this.targetEditable = init.targetEditable;
    this.targetValueLength = init.targetValueLength;
    this.result = init.result;
  }
}

/**
 * DragError is thrown by {@link Page.dragBy} / {@link Page.dragTo}
 * when the source element could not be acquired/pressed. Drag picks up the
 * source with the same smart click as {@link Page.click}, so a pre-drag
 * failure is a click failure: `code` mirrors it and the full click diagnostics
 * live under `clickError`. `"captcha_failed"`: a captcha appeared during the
 * drag and auto-solve could not solve it, with `onFailure: "fail"`.
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
 * ScrollError is thrown by {@link Page.scrollTo} when the target could
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
 * MoveError is thrown by {@link Page.moveTo} when the target could not
 * be located. A move has no occlusion notion, so this is the only semantic
 * failure.
 */
export class MoveError extends BrowserScaleError {
  /** `"not_found"` or `"page_not_focused"`. */
  readonly code: string;
  /**
   * For code `"page_not_focused"`, the page that has the focus. The call
   * throws a {@link PageNotFocusedError} around this error then.
   */
  readonly focusedPageId?: string;
  readonly result: ElementResult;

  constructor(init: {
    code: string;
    message: string;
    focusedPageId?: string;
    result: ElementResult;
  }) {
    super(formatMessage("moveTo", init.code, init.message));
    this.name = "MoveError";
    this.code = init.code;
    this.focusedPageId = init.focusedPageId;
    this.result = init.result;
  }
}

/**
 * SelectOptionError is thrown by the {@link Page.selectByIndex} /
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
 * WaitError is thrown by {@link Page.wait} / {@link Page.waitAny}
 * when no condition matched before the deadline. `conditions` holds the
 * per-condition breakdown (same order/length as the conditions passed in)
 * explaining why each one never matched.
 */
export class WaitError extends BrowserScaleError {
  /** Machine-stable failure code, currently always `"timeout"`. */
  readonly code: string;
  /** Per-condition status, same order/length as the conditions passed to wait. */
  readonly conditions: WaitConditionStatus[];

  constructor(init: {
    code: string;
    message: string;
    conditions: WaitConditionStatus[];
  }) {
    super(formatMessage("wait", init.code, init.message));
    this.name = "WaitError";
    this.code = init.code;
    this.conditions = init.conditions;
  }
}

/**
 * PageClosedError is thrown by a {@link Page} call when the page has closed.
 * `focusedPage` is the page that has the focus now, usually the one that
 * opened the closed page.
 *
 *   try {
 *     await page.click(css("#next"));
 *   } catch (e) {
 *     if (e instanceof PageClosedError) page = e.focusedPage;
 *   }
 */
export class PageClosedError extends BrowserScaleError {
  /** The id of the page that closed. */
  readonly pageId: string;
  /** The page that has the focus now. */
  readonly focusedPage: Page;

  constructor(init: { pageId: string; focusedPage: Page; cause?: unknown }) {
    super(
      `page ${init.pageId} was closed; page ${init.focusedPage.id} has the focus`,
      init.cause,
    );
    this.name = "PageClosedError";
    this.pageId = init.pageId;
    this.focusedPage = init.focusedPage;
  }
}

/**
 * PageNotFocusedError is thrown by {@link Page.click}, {@link Page.moveTo} and
 * the calls built on them ({@link Page.fill}, {@link Page.dragBy},
 * {@link Page.dragTo}) when the page does not have the focus, typically
 * because it opened a tab or popup that came to the front. `focusedPage` is
 * that page; {@link Page.focus} brings this one back.
 *
 * `cause` is the call's own error ({@link ClickError}, {@link MoveError},
 * {@link FillError} or {@link DragError}) with its partial result.
 *
 *   try {
 *     await page.click(css("a[target=_blank]"));
 *     await page.click(css("#next"));
 *   } catch (e) {
 *     if (e instanceof PageNotFocusedError) page = e.focusedPage; // continue in the new tab
 *   }
 */
export class PageNotFocusedError extends BrowserScaleError {
  /** The page that has the focus. */
  readonly focusedPage: Page;
  declare readonly cause: ClickError | MoveError | FillError | DragError;

  constructor(init: { focusedPage: Page; cause: ClickError | MoveError | FillError | DragError }) {
    super(init.cause.message, init.cause);
    this.name = "PageNotFocusedError";
    this.focusedPage = init.focusedPage;
  }
}

const codePageNotFocused = "page_not_focused";

/**
 * @internal Returns the focused page's id when err says the page does not have
 * the focus.
 */
export function focusedPageIdOf(err: unknown): string | undefined {
  if (err instanceof ClickError || err instanceof MoveError) {
    return err.code === codePageNotFocused ? err.focusedPageId : undefined;
  }
  if (err instanceof FillError || err instanceof DragError) {
    return err.clickError?.code === codePageNotFocused ? err.clickError.focusedPageId : undefined;
  }
  return undefined;
}

/**
 * NoPageError is thrown by the calls that need the focused page
 * ({@link CloudBrowser.focusedPage}, {@link CloudBrowser.startStream}) while
 * the browser has no page yet. A browser starts without one;
 * {@link CloudBrowser.createPage} opens the first.
 *
 *   try {
 *     page = await browser.focusedPage();
 *   } catch (e) {
 *     if (e instanceof NoPageError) page = await browser.createPage();
 *   }
 */
export class NoPageError extends BrowserScaleError {
  constructor(cause?: unknown) {
    super("the browser has no page yet; createPage() opens one", cause);
    this.name = "NoPageError";
  }
}

const noPagePrefix = "NO_PAGE:";

/**
 * @internal Returns the {@link NoPageError} the server's NO_PAGE status stands
 * for, or undefined for any other error.
 */
export function noPageFrom(err: unknown): NoPageError | undefined {
  if (!(err instanceof ConnectError) || err.code !== Code.FailedPrecondition) return undefined;
  return err.rawMessage.startsWith(noPagePrefix) ? new NoPageError(err) : undefined;
}

const pageClosedPrefix = "PAGE_CLOSED: focusedPageId=";

/**
 * @internal Returns the {@link PageClosedError} the server's PAGE_CLOSED status
 * stands for, or undefined for any other error.
 */
export function pageClosedFrom(
  err: unknown,
  pageId: string,
  page: (id: string) => Page,
): PageClosedError | undefined {
  if (!(err instanceof ConnectError) || err.code !== Code.FailedPrecondition) return undefined;
  if (!err.rawMessage.startsWith(pageClosedPrefix)) return undefined;
  const focused = err.rawMessage.slice(pageClosedPrefix.length);
  return new PageClosedError({ pageId, focusedPage: page(focused), cause: err });
}

function formatMessage(action: string, code: string, message: string): string {
  const base = `${action} failed: ${code}`;
  return message ? `${base}: ${message}` : base;
}
