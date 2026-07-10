// Option bags for the element-action methods. All fields are optional —
// pass nothing (or `{}`) to take all defaults. Empty/zero values mean
// "use server default".
//
// `inFrame` on each opts struct wins over the locator's own .inFrame(...)
// chain — useful when reusing a locator across frames.

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
  /** Default 200. */
  maxElementsPerFrame?: number;
  /** Default 200. */
  maxTextLength?: number;
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
