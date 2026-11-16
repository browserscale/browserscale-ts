// Option bags for the element-action methods. All fields are optional —
// pass nothing (or `{}`) to take all defaults. Empty/zero values mean
// "use server default".
//
// Where a call looks for its element is part of the locator, not of the
// options: see Locator.in().

import type { Locator } from "./locator.ts";

/** Mouse button used by {@link Page.click}. */
export type Button = "left" | "right" | "middle";

/** Mouse phase performed by {@link Page.click}. */
export type ClickAction = "click" | "press" | "release";

/**
 * Optional customization for {@link Page.click}. All fields are
 * optional; missing or zero values mean "use the server default".
 */
export interface ClickOpts {
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
 * Optional customization for {@link Page.addReaction} and
 * {@link CloudBrowser.addReaction}. All fields are
 * optional; missing or zero values mean "use the server default".
 */
export interface ReactionOpts {
  /**
   * Override the click target. Omit to click the matched element itself.
   * Provide a `css()`/`js()` {@link Locator} to click a different element,
   * resolved in the matched element's frame (e.g. a modal's close "X"). It
   * takes no container of its own; a reference or `at()` locator is rejected.
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
 * Optional customization for {@link Page.fill}. All fields are
 * optional; missing values mean "use the server default".
 */
export interface FillOpts {
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
 * Optional customization for {@link Page.selectByIndex},
 * {@link Page.selectByValue} and {@link Page.selectByText}.
 */
export interface SelectOpts {
  /**
   * `false` suppresses change/input events. Default (`true`) fires the
   * standard events after the selection.
   */
  fireEvents?: boolean;
}

/** Optional customization for {@link Page.wait} / {@link Page.waitAny}. */
export interface WaitOpts {
  /** Omitted leaves it to the API, which defaults to 30 000 ms. */
  timeoutMs?: number;
}

/** Lifecycle event {@link Page.navigate} waits for before returning. */
export type WaitUntil = "load" | "domcontentloaded" | "networkidle";

/** Optional customization for {@link Page.navigate}. */
export interface NavigateOpts {
  /** Default 30 000 ms. */
  timeoutMs?: number;
  /** Default "load". */
  waitUntil?: WaitUntil;
}

/** Optional customization for {@link Page.loadHTML}. */
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

/** Optional customization for {@link Page.getObservation}. */
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
   * each gets whatever is left. A reserve on top of the budget, a quarter of
   * it and at most 2000 tokens, is kept for child frames, so a long main
   * document does not push out the consent or payment frame further down.
   *
   * The budget is where a frame starts leaving things out, not the size of
   * the result: from a `# budget spent` line on, the frame lists only what can
   * be acted on, with its headings. A result can therefore come to about twice
   * this value.
   */
  maxTotalTokens?: number;
  /**
   * Include element bounds as `bounds="x,y,w,h"`. Off by default; bounds cost
   * about as much as the rest of a row and are rarely needed, since elements
   * are addressed by their reference.
   */
  includeBounds?: boolean;
  /** Only emit elements intersecting the frame's current viewport. */
  viewportOnly?: boolean;
  /**
   * Observes only part of the page, so a follow-up look at a form costs the
   * form and not the ads around it. Omit for the whole page.
   *
   * An element locator ({@link css}, {@link js} or a reference) scopes to that
   * element's subtree; like any locator it can be confined with
   * {@link Locator.in}. A frame ({@link frameUrl}, {@link frameName},
   * {@link frameById}, {@link mainFrame}) scopes to that frame's document.
   * Child iframes reached inside the scope are still visited.
   */
  scope?: Locator;
}

/** Optional customization for {@link Page.screenshot}. */
export interface ScreenshotOpts {
  /** Image format: "png" (default), "jpeg", or "webp". */
  format?: "png" | "jpeg" | "webp";
  /** Encode quality 0-100 for "jpeg"/"webp" (ignored for "png"). Default 90. */
  quality?: number;
}

/** Optional customization for {@link Page.readCanvas}. */
export interface ReadCanvasOpts {
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
