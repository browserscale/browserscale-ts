// Option bags for the element-action methods. All fields are optional —
// pass nothing (or `{}`) to take all defaults. Empty/zero values mean
// "use server default".
//
// `inFrame` on each opts struct wins over the locator's own .inFrame(...)
// chain — useful when reusing a locator across frames.

import type { Locator } from "./locator.ts";

/** Mouse button used by {@link CloudBrowser.click}. */
export type Button = "left" | "right" | "middle";

/** Mouse phase performed by {@link CloudBrowser.click}. */
export type ClickAction = "click" | "press" | "release";

/**
 * Optional customization for {@link CloudBrowser.click}. All fields are
 * optional; missing or zero values mean "use the server default".
 */
export interface ClickOpts {
  /**
   * Override the locator's frame. Omit to use the locator's own
   * {@link Locator.inFrame} (or the main frame). Pass a specific
   * `frameId` or {@link AllFrames} to search elsewhere.
   */
  inFrame?: string;

  /** Mouse button. Default `"left"`. */
  button?: Button;

  /** `1` = single click (default), `2` = double-click. */
  clickCount?: number;

  /**
   * `"click"` (default) performs a full mouseDown+mouseUp.
   * `"press"` only dispatches mouseDown, `"release"` only mouseUp at
   * the current cursor position.
   */
  action?: ClickAction;
}

/**
 * Optional customization for {@link CloudBrowser.addReaction}. All fields are
 * optional; missing or zero values mean "use the server default".
 */
export interface ReactionOpts {
  /**
   * Override the click target. Omit to click the matched element itself.
   * Provide a `css()`/`js()` {@link Locator} to click a different element,
   * resolved in the matched element's frame (e.g. a modal's close "X").
   * `node()`/`at()` locators are rejected.
   */
  on?: Locator;

  /** Mouse button for the click. Default `"left"`. */
  button?: Button;

  /** `1` = single click (default), `2` = double-click. */
  clickCount?: number;

  /** Poll cadence in milliseconds for the shared page loop. Default 300. */
  intervalMs?: number;
}

/**
 * Optional customization for {@link CloudBrowser.fill}. All fields are
 * optional; missing values mean "use the server default".
 */
export interface FillOpts {
  /**
   * Override the locator's frame. Omit to use the locator's own
   * {@link Locator.inFrame} (or the main frame). Pass a specific
   * `frameId` or {@link AllFrames} to search elsewhere.
   */
  inFrame?: string;

  /**
   * `true` wipes the field's existing content with Ctrl+A, Delete
   * before typing. Default (`false`) appends to whatever is already
   * in the field.
   */
  clearFirst?: boolean;

  /**
   * Budget in ms to make the field focusable+clickable (locate, scroll,
   * settle, un-occlude), mirroring the click timeout. Omit for the server
   * default (5000). `0` makes fill one-shot (no retry).
   */
  timeoutMs?: number;

  /**
   * Settle window in ms before the focus click, mirroring the click
   * steady-time. Omit for the server default (750). `0` skips settling.
   */
  steadyMs?: number;
}

/**
 * Optional customization for {@link CloudBrowser.selectByIndex},
 * {@link CloudBrowser.selectByValue} and {@link CloudBrowser.selectByText}.
 */
export interface SelectOpts {
  /**
   * Override the locator's frame. Omit to use the locator's own
   * {@link Locator.inFrame} (or the main frame). Pass a specific
   * `frameId` or {@link AllFrames} to search elsewhere.
   */
  inFrame?: string;

  /**
   * `false` suppresses change/input events. Default (`true`) fires the
   * standard events after the selection.
   */
  fireEvents?: boolean;
}

/** Optional customization for {@link CloudBrowser.wait} / {@link CloudBrowser.waitForAny}. */
export interface WaitOpts {
  /** Default `DefaultWaitTimeoutMs` (30 000 ms). */
  timeoutMs?: number;
}

/** Lifecycle event {@link CloudBrowser.navigate} waits for before returning. */
export type WaitUntil = "load" | "domcontentloaded" | "networkidle";

/** Optional customization for {@link CloudBrowser.navigate}. */
export interface NavigateOpts {
  /** Default 30 000 ms. */
  timeoutMs?: number;
  /** Default "load". */
  waitUntil?: WaitUntil;
}

/** Optional customization for {@link CloudBrowser.loadHTML}. */
export interface LoadHTMLOpts {
  /** Extra headers to attach to the synthetic response. */
  headers?: { name: string; value: string }[];
  /** Default 200. */
  statusCode?: number;
}

/** Depth used by getDOM(). 0 = whole tree (default), >0 = limited depth. */
export interface GetDOMOpts {
  depth?: number;
}

/** Optional customization for {@link CloudBrowser.getObservation}. */
export interface GetObservationOpts {
  /**
   * `"text"` (default) for the compact line format meant to be handed to a
   * model as-is, or `"json"` for the structured form. Only the requested
   * representation is built, so asking for one does not cost the other.
   */
  format?: "text" | "json";
  /**
   * Cap on emitted elements per frame. Default 800 — a safety net against
   * runaway documents; `maxTotalTokens` is the limit that normally binds.
   */
  maxElementsPerFrame?: number;
  /**
   * Cap on human-readable strings (labels, text, values) in characters.
   * Default 300. Identifier-like attributes (type, name, role) have their own
   * fixed, shorter cap and are unaffected.
   */
  maxTextLength?: number;
  /**
   * Budget across ALL frames, in estimated tokens rather than characters —
   * the same character count is worth roughly four times as many tokens in
   * CJK text as in ASCII. Default 8000. Frames are visited in tree order and
   * each gets whatever is left.
   */
  maxTotalTokens?: number;
  /**
   * Include element bounds as `bounds="x,y,w,h"`. Off by default; bounds cost
   * about as much as the rest of a row and are rarely needed, since elements
   * are addressed by backendNodeId.
   */
  includeBounds?: boolean;
  /** Only emit elements intersecting the frame's current viewport. */
  viewportOnly?: boolean;
  /**
   * Subtree scope — set exactly one of `backendNodeId`, `selector` or
   * `jsExpression` to observe only that element's subtree (follow-up looks at
   * a form then cost the form, not the ads around it). Omit all three for the
   * whole page. Child iframes reached inside the scope are still visited.
   */
  backendNodeId?: number;
  /** Scope root by CSS selector. */
  selector?: string;
  /**
   * Scope root by JS expression that evaluates to a DOM Element (including
   * `__wrc.shadow(...)` for closed shadow roots).
   */
  jsExpression?: string;
  /**
   * Where to look up the scope root: a specific `frameId`, omit for the main
   * frame, or {@link AllFrames} to search every frame until found. Ignored when
   * observing the whole page.
   */
  frameId?: string;
}

/** Optional customization for {@link CloudBrowser.screenshot}. */
export interface ScreenshotOpts {
  /** Image format: "png" (default), "jpeg", or "webp". */
  format?: "png" | "jpeg" | "webp";
  /** Encode quality 0-100 for "jpeg"/"webp" (ignored for "png"). Default 90. */
  quality?: number;
}

/** Optional customization for {@link CloudBrowser.readCanvas}. */
export interface ReadCanvasOpts {
  /**
   * Override the locator's frame. Omit to use the locator's own
   * {@link Locator.inFrame} (or the main frame). Pass a specific
   * `frameId` or {@link AllFrames} to search elsewhere.
   */
  inFrame?: string;

  /**
   * Output encoding: `"png"` (default), `"jpeg"`, `"webp"`, or `"rgba"` for
   * the raw unpremultiplied RGBA pixel buffer.
   */
  format?: "png" | "jpeg" | "webp" | "rgba";

  /** Encode quality 0-100 for "jpeg"/"webp" (ignored otherwise). Default 90. */
  quality?: number;

  /**
   * Optional sub-rectangle in canvas pixels (mirrors
   * `getImageData(sx, sy, sw, sh)`). The full canvas is read when `sw`/`sh`
   * are omitted or <= 0.
   */
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
}
