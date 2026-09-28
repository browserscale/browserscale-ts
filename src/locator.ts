import { BrowserScaleError } from "./errors.ts";

/**
 * AllFrames is the sentinel for "match in every frame on the page".
 * Use it for any field documented as accepting a frameId — both
 * Locator.inFrame and *Opts.inFrame.
 */
export const AllFrames = "ALL_FRAMES";

/**
 * Locator is the universal "what element / what condition" type. It is used
 * both as a wait condition (passed to wait()/waitAny()) and as a target for
 * element actions (passed to click(), fill(), …).
 *
 * Not every field is meaningful in every context:
 *   - selector / jsExpression  → both wait and actions
 *   - backendNodeId            → actions only (wait rejects it)
 *   - visible / steadyMs       → wait only (silently ignored by actions)
 *   - x / y                    → actions only (wait rejects it)
 *   - frameId                  → both, may be overridden by call-level
 *                                opts.inFrame
 *
 * Use the css() / js() / node() / at() constructors instead of building
 * this class by hand.
 *
 * Modifiers (visible, steady, inFrame, inAllFrames) are immutable — they
 * return a new Locator and leave the original untouched, so it's safe to
 * share a base locator across calls.
 */
export class Locator {
  readonly selector: string = "";
  readonly jsExpression: string = "";
  readonly backendNodeId: number = 0;
  readonly frameId: string = "";

  readonly visibleFlag?: boolean;
  readonly steadyMs?: number;

  readonly x?: number;
  readonly y?: number;

  private constructor(init: Partial<Locator>) {
    Object.assign(this, init);
  }

  /** Internal — clone the locator with one or more fields overridden. */
  private with(patch: Partial<Locator>): Locator {
    return new Locator({
      selector: this.selector,
      jsExpression: this.jsExpression,
      backendNodeId: this.backendNodeId,
      frameId: this.frameId,
      visibleFlag: this.visibleFlag,
      steadyMs: this.steadyMs,
      x: this.x,
      y: this.y,
      ...patch,
    });
  }

  // ── Modifiers (return new Locator) ──────────────────────────────────

  /**
   * Enforces or disables the visibility check for this Locator's wait
   * condition.
   *
   * Visibility is required by default, so pass `false` to wait for DOM
   * presence alone. Has no effect when used as an action target — actions
   * never check visibility before dispatching.
   *
   * @param v - true to require visibility, false to skip the check
   *
   * @returns a new Locator with the override applied
   *
   * @example
   * await browser.wait(css("#hidden").visible(false));
   */
  visible(v: boolean): Locator {
    return this.with({ visibleFlag: v });
  }

  /**
   * Requires the element to keep a stable position and size for at least
   * `ms` milliseconds before the wait matches.
   *
   * Settling defaults to 500ms, so pass 0 to match the instant the element
   * is found. Has no effect for js() expressions that return a non-Element
   * value, nor when used as an action target.
   *
   * @param ms - steady-state duration in milliseconds; 0 disables
   *
   * @returns a new Locator with the override applied
   *
   * @example
   * await browser.wait(css(".banner").steady(0));
   */
  steady(ms: number): Locator {
    return this.with({ steadyMs: ms });
  }

  /**
   * Scopes this Locator to a specific frameId.
   *
   * Use the frameId from a previous result or {@link CloudBrowser.getPages}
   * to target elements inside a known iframe.
   *
   * @param frameId - id of the frame to scope to
   *
   * @returns a new Locator scoped to that frame
   *
   * @example
   * const pages = await browser.getPages();
   * const iframeId = pages[0].frameTree.children[0].frameId;
   * await browser.click(css("button").inFrame(iframeId));
   */
  inFrame(frameId: string): Locator {
    return this.with({ frameId });
  }

  /**
   * Scopes this Locator to every frame.
   *
   * Equivalent to `.inFrame(AllFrames)`. Use this when an element might
   * appear inside any of several frames and you do not want to enumerate
   * them.
   *
   * @returns a new Locator scoped to all frames
   *
   * @example
   * await browser.wait(css("button.consent").inAllFrames());
   */
  inAllFrames(): Locator {
    return this.with({ frameId: AllFrames });
  }

  /** @internal — used by action methods to validate at send time. */
  validateTarget(cmd: string, allowCoords: boolean): void {
    const hasCoords = this.x !== undefined && this.y !== undefined;
    const hasElement =
      this.selector !== "" || this.jsExpression !== "" || this.backendNodeId !== 0;
    if (!hasElement && !hasCoords) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: target must have selector, JS expression, backendNodeId, or at(x,y)`,
      );
    }
    if (hasCoords && !allowCoords) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: at(x,y) is not supported here — use an element locator`,
      );
    }
  }

  // ── Constructors (top-level functions re-export these) ──────────────

  /** @internal */
  static _css(selector: string): Locator {
    return new Locator({ selector });
  }

  /** @internal */
  static _js(expression: string): Locator {
    return new Locator({ jsExpression: expression });
  }

  /** @internal */
  static _node(backendNodeId: number): Locator {
    return new Locator({ backendNodeId });
  }

  /** @internal */
  static _at(x: number, y: number): Locator {
    return new Locator({ x, y });
  }
}

// ──────────────────────────────────────────────────────────────────────
// Top-level constructors (preferred over Locator.* statics)
// ──────────────────────────────────────────────────────────────────────

/**
 * css waits for / targets an element matching the given CSS selector.
 *
 * When used in {@link CloudBrowser.wait}/{@link CloudBrowser.waitAny}, the
 * condition requires the element to be visible and to hold still for 500ms
 * before it matches — the API's defaults for a condition that does not set
 * them. Override per call with `.visible(false)` / `.steady(ms)` (use
 * `.steady(0)` to disable the steady check).
 *
 * When used as an action target (click, fill, …) the visible/steady
 * fields are ignored — there are no corresponding fields on the action
 * requests.
 *
 * @param selector - CSS selector matching the element
 *
 * @returns Locator usable as a wait condition or as an action target
 *
 * @example
 * // As a wait condition.
 * await browser.wait(css("button.submit"));
 * // As an action target.
 * await browser.click(css("button.submit"));
 */
export function css(selector: string): Locator {
  return Locator._css(selector);
}

/**
 * js waits for / targets the result of a JavaScript expression.
 *
 * Same wait defaults as {@link css} (visible, 500ms steady); these only
 * apply when the expression returns a
 * DOM Element. For non-Element truthy values (boolean, string, number,
 * plain object) both fields are no-ops and the condition matches as soon
 * as the value is truthy. Use `.visible(false)` / `.steady(0)` to opt out.
 *
 * @param expression - JavaScript expression evaluated in the target frame
 *
 * @returns Locator usable as a wait condition or as an action target
 *
 * @example
 * await browser.wait(js("window.__ready === true"));
 */
export function js(expression: string): Locator {
  return Locator._js(expression);
}

/**
 * node targets an element by its DevTools backendNodeId.
 *
 * Use this when you already have a backendNodeId from a previous result
 * (e.g. a wait or evaluate result) and want to act on the exact same
 * element without re-resolving by selector. Action-only — using it in
 * wait() throws at send time.
 *
 * @param backendNodeId - DevTools backendNodeId of the target element
 *
 * @returns Locator usable only as an action target
 *
 * @example
 * const r = await browser.click(css("button.open"));
 * await browser.click(node(r.backendNodeId));
 */
export function node(backendNodeId: number): Locator {
  return Locator._node(backendNodeId);
}

/**
 * at targets viewport coordinates instead of an element.
 *
 * Useful for clicking inside a canvas, hovering decorative regions, or
 * dispatching events at synthetic positions. Action-only — using it in
 * wait() throws at send time. Note that only click and moveTo accept at;
 * scrollTo, drag, fill and select all require a real element.
 *
 * @param x - viewport-relative x in CSS pixels
 * @param y - viewport-relative y in CSS pixels
 *
 * @returns Locator usable only as an action target
 *
 * @example
 * // Click at canvas-relative coordinates.
 * await browser.click(at(120, 240));
 */
export function at(x: number, y: number): Locator {
  return Locator._at(x, y);
}

/**
 * @internal — returns the frame to send on the wire: opts.inFrame wins
 * over the locator's own frameId. Empty everywhere → undefined (server
 * uses main frame).
 */
export function pickFrame(optsFrame: string | undefined, locator: Locator): string | undefined {
  if (optsFrame) return optsFrame;
  if (locator.frameId) return locator.frameId;
  return undefined;
}
