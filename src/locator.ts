import { create } from "@bufbuild/protobuf";
import { BrowserScaleError } from "./errors.ts";
import { type Container, ContainerSchema } from "./gen/wrc_pb.ts";

/**
 * Locator says what a call is about: an element, and where on the page to
 * look for it. It is used as a wait condition (passed to
 * {@link Page.wait}/{@link Page.waitAny}), as the target of an action (passed
 * to {@link Page.click}, {@link Page.fill}, …), and as a container that
 * another locator is looked for in (passed to {@link Locator.in}). wait()
 * additionally takes conditions that are not elements — {@link captcha},
 * {@link request} and {@link response} — which no action accepts.
 *
 * Build one with a constructor, never by hand:
 *   - {@link css}, {@link js}: an element by selector or by expression
 *   - a result's `ref` (or {@link ref} for a reference read from an
 *     observation): the very element an earlier call found
 *   - {@link at}: a point instead of an element, for {@link Page.click} and
 *     {@link Page.moveTo}
 *   - {@link frameUrl}, {@link frameName}, {@link frameById},
 *     {@link mainFrame}, {@link anyFrame}: a frame, to look in
 *
 * Where a locator looks is decided by {@link Locator.in}. Without it a
 * {@link css} locator means the whole page, every frame included, and a
 * {@link js} locator runs in the page's main document.
 *
 * Not every part is meaningful everywhere: visible and steady apply to wait
 * conditions and reactions, {@link at} to click and moveTo, and the frame
 * constructors only name a place to look in, never a target.
 *
 * Modifiers (in, visible, steady) are immutable — they return a new Locator
 * and leave the original untouched, so it's safe to share a base locator or a
 * container across calls.
 */
export class Locator {
  readonly selector: string = "";
  readonly jsExpression: string = "";
  /** @internal The reference this locator stands for; read it with {@link Locator.refString}. */
  readonly refValue: string = "";

  /** @internal A frame, named directly. These only work as a container. */
  readonly frameUrlPattern: string = "";
  /** @internal */
  readonly frameNameValue?: string;
  /** @internal */
  readonly frameIdValue: string = "";
  /** @internal */
  readonly isMainFrame: boolean = false;
  /** @internal */
  readonly isAnyFrame: boolean = false;

  /** @internal The element has to hold a document of its own; see {@link frame}. */
  readonly mustBeFrame: boolean = false;

  /** @internal What this locator is looked for in; undefined for the default. */
  readonly container?: Locator;

  /**
   * @internal The frame a reference was seen in, when it came out of a
   * result. Lets a stale reference say where that frame is now.
   */
  readonly seenIn: string = "";

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
      refValue: this.refValue,
      frameUrlPattern: this.frameUrlPattern,
      frameNameValue: this.frameNameValue,
      frameIdValue: this.frameIdValue,
      isMainFrame: this.isMainFrame,
      isAnyFrame: this.isAnyFrame,
      mustBeFrame: this.mustBeFrame,
      container: this.container,
      seenIn: this.seenIn,
      visibleFlag: this.visibleFlag,
      steadyMs: this.steadyMs,
      x: this.x,
      y: this.y,
      ...patch,
    });
  }

  // ── Modifiers (return new Locator) ──────────────────────────────────

  /**
   * Says where this locator is looked for: inside the container.
   *
   * The container is another locator, and what it means depends on what it
   * finds:
   *   - an iframe ({@link css}, {@link js} or a reference naming the iframe
   *     element): its document, same-origin or not
   *   - any other element: its subtree. For a component with a shadow tree
   *     that includes the shadow tree, open or closed, so a host element is
   *     the way into it
   *   - {@link frameUrl}, {@link frameName}, {@link frameById},
   *     {@link mainFrame}, {@link anyFrame}: that frame
   *
   * A container can itself be put in a container, to any depth. Calling in()
   * again on the result wraps one level further out, so `a.in(b).in(c)` is a
   * in b in c.
   *
   * The whole chain is looked up anew each time the call looks for its
   * element. A call that waits ({@link Page.click}, {@link Page.fill},
   * {@link Page.wait}, a reaction) therefore also waits for the iframe and
   * the container to appear, and a container that never does is reported as
   * `"container_not_found"` with the link that was missing.
   *
   * @param container - where to look
   *
   * @returns a new Locator for the same element, confined to the container
   *
   * @example
   * const pay = css("iframe[title='Secure payment']");
   * await page.fill(css("input[name=cardnumber]").in(pay), card);
   * await page.fill(css("input[name=cvc]").in(pay), cvc);
   *
   * @example
   * // A subtree, and a shadow host.
   * const dialog = css("[role=dialog]");
   * await page.click(css("button.close").in(dialog));
   * const picker = css("date-picker");
   * await page.click(css("button.next").in(picker));
   *
   * @example
   * // The iframe a wait found, as the place to look next.
   * const found = await page.wait(css("iframe.widget"));
   * await page.click(css("button").in(found.element.ref!));
   */
  in(container: Locator): Locator {
    return this.with({ container: wrapIn(this.container, container) });
  }

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
   * await page.wait(css("#hidden").visible(false));
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
   * await page.wait(css(".banner").steady(0));
   */
  steady(ms: number): Locator {
    return this.with({ steadyMs: ms });
  }

  /**
   * Returns the reference this Locator stands for, in the form {@link ref}
   * takes, or `""` when it is not a reference. For writing a reference down
   * or handing it to something that is not this program.
   *
   * @returns the reference as text, or `""`
   *
   * @example
   * const found = await page.wait(css(".result"));
   * const saved = found.element.ref!.refString();
   * // ... later, in the same session:
   * await page.click(ref(saved));
   */
  refString(): string {
    return this.refValue;
  }

  /**
   * Describes the locator for logs and error messages: what it names and
   * what it is looked for in, outermost last.
   */
  toString(): string {
    const parts: string[] = [];
    for (let cur: Locator | undefined = this; cur; cur = cur.container) {
      parts.push(cur.describe());
    }
    return parts.join(" in ");
  }

  /**
   * Writes the locator as text, so that a result printed with JSON.stringify
   * shows what its `ref` is: a reference as {@link Locator.refString} gives
   * it, ready for {@link ref}, and any other locator as
   * {@link Locator.toString} describes it.
   */
  toJSON(): string {
    if (this.refValue && !this.container) return this.refValue;
    return this.toString();
  }

  private describe(): string {
    let s: string;
    if (this.selector) s = `css ${JSON.stringify(this.selector)}`;
    else if (this.jsExpression) s = `js ${JSON.stringify(this.jsExpression)}`;
    else if (this.refValue) s = `ref ${this.refValue}`;
    else if (this.frameUrlPattern) s = `frame url ${JSON.stringify(this.frameUrlPattern)}`;
    else if (this.frameNameValue !== undefined) s = `frame name ${JSON.stringify(this.frameNameValue)}`;
    else if (this.frameIdValue) s = `frame ${this.frameIdValue}`;
    else if (this.isMainFrame) s = "main frame";
    else if (this.isAnyFrame) s = "any frame";
    else if (this.x !== undefined && this.y !== undefined) s = `at (${this.x}, ${this.y})`;
    else s = "empty locator";
    return this.mustBeFrame ? `frame(${s})` : s;
  }

  // ── Internals ───────────────────────────────────────────────────────

  /** @internal Whether the locator names an element (rather than a frame or a point). */
  isElement(): boolean {
    return this.selector !== "" || this.jsExpression !== "" || this.refValue !== "";
  }

  /** @internal Whether the locator names a frame directly. */
  isFrame(): boolean {
    return (
      this.frameUrlPattern !== "" ||
      this.frameNameValue !== undefined ||
      this.frameIdValue !== "" ||
      this.isMainFrame ||
      this.isAnyFrame
    );
  }

  /** @internal — used by action methods to validate at send time. */
  validateTarget(cmd: string, allowCoords: boolean): void {
    const hasCoords = this.x !== undefined && this.y !== undefined;
    if (this.isFrame()) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: ${this.describe()} names a frame, not an element; put the element's locator in it with in()`,
      );
    }
    if (!this.isElement() && !hasCoords) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: target must be a css(), js() or reference locator, or at(x,y)`,
      );
    }
    if (hasCoords && !allowCoords) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: at(x,y) is not supported here — use an element locator`,
      );
    }
    if (hasCoords && this.container) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: at(x,y) is a point of the viewport and cannot be put in a container`,
      );
    }
    this.validateChain(cmd);
  }

  /** @internal Checks the containers the locator is looked for in. */
  validateChain(cmd: string): void {
    if (this.refValue && this.container) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: a reference names its element and frame by itself; in() does not apply to it`,
      );
    }
    for (let c = this.container; c; c = c.container) c.validateContainer(cmd);
  }

  /** @internal Checks that the locator can serve as a place to look in. */
  validateContainer(cmd: string): void {
    if (this.x !== undefined || this.y !== undefined) {
      throw new BrowserScaleError(`browserscale.${cmd}: at(x,y) cannot be a container`);
    }
    if (!this.isElement() && !this.isFrame()) {
      throw new BrowserScaleError(`browserscale.${cmd}: an empty locator cannot be a container`);
    }
    if (this.refValue && this.container) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: a reference names its element and frame by itself; in() does not apply to it`,
      );
    }
  }

  /** @internal This locator as one step of a chain. */
  private link(): Container {
    const c = create(ContainerSchema, { frame: this.mustBeFrame });
    if (this.selector) c.link = { case: "selector", value: this.selector };
    else if (this.jsExpression) c.link = { case: "jsExpression", value: this.jsExpression };
    else if (this.refValue) c.link = { case: "ref", value: this.refValue };
    else if (this.frameUrlPattern) c.link = { case: "frameUrl", value: this.frameUrlPattern };
    else if (this.frameNameValue !== undefined) c.link = { case: "frameName", value: this.frameNameValue };
    else if (this.frameIdValue) c.link = { case: "frameId", value: this.frameIdValue };
    else if (this.isMainFrame) c.link = { case: "main", value: true };
    else if (this.isAnyFrame) c.link = { case: "any", value: true };
    return c;
  }

  /**
   * @internal Where this locator is looked for, as the wire wants it:
   * outermost first, this locator itself not included.
   */
  chain(): Container[] {
    return this.container ? this.container.chainWithSelf() : [];
  }

  /**
   * @internal The chain that leads to this locator and into it: what a call
   * uses when the locator is itself the place to act in.
   */
  chainWithSelf(): Container[] {
    const out = this.container ? this.container.chainWithSelf() : [];
    out.push(this.link());
    return out;
  }

  /**
   * @internal The reference the locator is, or the first one among the
   * containers it is looked for in.
   */
  firstRef(): Locator | undefined {
    for (let cur: Locator | undefined = this; cur; cur = cur.container) {
      if (cur.refValue) return cur;
    }
    return undefined;
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
  static _ref(value: string, seenIn: string = ""): Locator {
    return new Locator({ refValue: value, seenIn });
  }

  /** @internal */
  static _at(x: number, y: number): Locator {
    return new Locator({ x, y });
  }

  /** @internal */
  static _frame(init: {
    frameUrlPattern?: string;
    frameNameValue?: string;
    frameIdValue?: string;
    isMainFrame?: boolean;
    isAnyFrame?: boolean;
  }): Locator {
    return new Locator(init);
  }

  /** @internal */
  static _mustBeFrame(container: Locator): Locator {
    return container.with({ mustBeFrame: true });
  }

  /**
   * @internal Rebuilds the container a chain describes (outermost first), the
   * inverse of chainWithSelf. Undefined for an empty chain.
   */
  static _fromChain(chain: Container[]): Locator | undefined {
    let outer: Locator | undefined;
    for (const c of chain) {
      const init: Partial<Locator> = { mustBeFrame: c.frame, container: outer };
      switch (c.link.case) {
        case "selector":
          outer = new Locator({ ...init, selector: c.link.value });
          break;
        case "jsExpression":
          outer = new Locator({ ...init, jsExpression: c.link.value });
          break;
        case "ref":
          outer = new Locator({ ...init, refValue: c.link.value });
          break;
        case "frameUrl":
          outer = new Locator({ ...init, frameUrlPattern: c.link.value });
          break;
        case "frameName":
          outer = new Locator({ ...init, frameNameValue: c.link.value });
          break;
        case "frameId":
          outer = new Locator({ ...init, frameIdValue: c.link.value });
          break;
        case "main":
          outer = new Locator({ ...init, isMainFrame: true });
          break;
        case "any":
          outer = new Locator({ ...init, isAnyFrame: true });
          break;
        default:
          outer = new Locator(init);
      }
    }
    return outer;
  }

  /**
   * @internal The locator a reaction was registered with, as the server
   * reports it.
   */
  static _reactionMatch(init: {
    selector: string;
    jsExpression: string;
    chain: Container[];
    visible: boolean;
  }): Locator {
    return new Locator({
      selector: init.selector,
      jsExpression: init.jsExpression,
      container: Locator._fromChain(init.chain),
      visibleFlag: init.visible,
    });
  }
}

/**
 * Returns the chain `inner` with `container` put around its outermost link.
 * Locators are immutable, so nothing is copied that does not change.
 */
function wrapIn(inner: Locator | undefined, container: Locator): Locator {
  if (!inner) return container;
  return inner.in(container);
}

// ──────────────────────────────────────────────────────────────────────
// Top-level constructors (preferred over Locator.* statics)
// ──────────────────────────────────────────────────────────────────────

/**
 * css waits for / targets an element matching the given CSS selector.
 *
 * Without {@link Locator.in} the selector is looked for on the whole page:
 * the main document first, then every frame in the order they appear, frames
 * nobody can see last. The result says which frame it was found in, so a
 * button inside a consent or payment iframe needs no frame named. Use in() to
 * confine the search to one frame, one dialog or one component.
 *
 * Where the element has to be visible (a wait condition or reaction, and every
 * action), the selector means its first rendered match: matches that are not
 * rendered at all (display:none, visibility:hidden, no size) are passed over,
 * so a hidden copy such as the one in a closed mobile menu does not shadow the
 * visible element. A covered or offscreen match is still rendered and stays
 * the target. When a later match was taken, the result says which one in
 * `selectorMatch`. With `.visible(false)` a wait or reaction takes the first
 * match.
 *
 * When used in {@link Page.wait}/{@link Page.waitAny}, the
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
 * @returns Locator usable as a wait condition, an action target or a container
 *
 * @example
 * // As a wait condition.
 * await page.wait(css("button.submit"));
 * // As an action target. Found wherever it is, also inside an iframe.
 * const res = await page.click(css("button.accept"));
 * console.log(res.frame.main, res.frame.url);
 */
export function css(selector: string): Locator {
  return Locator._css(selector);
}

/**
 * js waits for / targets the result of a JavaScript expression.
 *
 * Without {@link Locator.in} the expression runs in the page's main document,
 * and only there. With in() it runs in the document the container leads to;
 * when the container is an element rather than a frame, the expression gets
 * that element as `__wrc.scope` and has to return an element inside it.
 *
 * Same wait defaults as {@link css} (visible, 500ms steady); these only
 * apply when the expression returns a
 * DOM Element. For non-Element truthy values (boolean, string, number,
 * plain object) both fields are no-ops and the condition matches as soon
 * as the value is truthy. Use `.visible(false)` / `.steady(0)` to opt out.
 *
 * @param expression - JavaScript expression
 *
 * @returns Locator usable as a wait condition, an action target or a container
 *
 * @example
 * await page.wait(js("window.__ready === true"));
 *
 * @example
 * // By text, inside one frame.
 * const pay = frameUrl("*checkout.example.com/*");
 * await page.click(
 *   js(`[...document.querySelectorAll('button')].find(b => /Pay/.test(b.innerText))`).in(pay),
 * );
 */
export function js(expression: string): Locator {
  return Locator._js(expression);
}

/**
 * ref targets the very element an earlier call found, by its reference.
 *
 * Every result that names an element carries its reference as a ready
 * Locator (`WaitElement.ref`, `ElementResult.ref`, `OccluderInfo.ref`, …), so
 * this constructor is only needed for a reference that arrived as text: an
 * observation prints one per frame (`# ref @<document>`), and a row's number
 * followed by that suffix is the element's reference.
 *
 * A reference names its element and the document it lives in, so no frame is
 * named with it and {@link Locator.in} does not apply. It stays good while
 * the element is in its document. Once a navigation replaced the document, or
 * the element was removed, a call given it rejects with a
 * {@link StaleRefError} instead of acting on whatever took its place.
 *
 * @param value - the reference, as {@link Locator.refString} returns it
 *
 * @returns Locator usable as an action target or a container
 *
 * @example
 * const found = await page.wait(css(".result"));
 * await page.click(found.element.ref!);
 *
 * @example
 * // From an observation: row 47 of the frame whose header says "# ref @9F2C...".
 * await page.click(ref("47@9F2C41D0A1B24C7E8F3A5D6B7C8E9F01"));
 */
export function ref(value: string): Locator {
  return Locator._ref(value);
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
 * await page.click(at(120, 240));
 */
export function at(x: number, y: number): Locator {
  return Locator._at(x, y);
}

// ──────────────────────────────────────────────────────────────────────
// Frames, as places to look in
// ──────────────────────────────────────────────────────────────────────

/**
 * frameUrl names a frame by the URL of the document it shows.
 *
 * It is a container: pass it to {@link Locator.in}, {@link Page.evaluateIn}
 * or `GetObservationOpts.scope`. The frame is looked for at any depth below
 * the page, or below the container it is itself put in with in(), and a frame
 * a person can see is preferred over one that is hidden or has no size. Use
 * this when the iframe element has nothing stable to select it by.
 *
 * @param pattern - URL wildcard; `*` matches any character span
 *
 * @returns Locator usable only as a container
 *
 * @example
 * const challenge = frameUrl("*hcaptcha.com/*frame=checkbox*");
 * await page.click(css("#checkbox").in(challenge));
 *
 * @example
 * // A frame inside a frame.
 * const outer = frameUrl("*\/_Incapsula_Resource*");
 * const inner = frameUrl("*hcaptcha.com/*frame=checkbox*").in(outer);
 * await page.click(css("#checkbox").in(inner));
 */
export function frameUrl(pattern: string): Locator {
  return Locator._frame({ frameUrlPattern: pattern });
}

/**
 * frameName names a frame by its name: `window.name`, which starts out as the
 * iframe's name attribute. Otherwise as {@link frameUrl}.
 *
 * @param name - the frame's name
 *
 * @returns Locator usable only as a container
 *
 * @example
 * await page.fill(css("input[name=q]").in(frameName("search")), "shoes");
 */
export function frameName(name: string): Locator {
  return Locator._frame({ frameNameValue: name });
}

/**
 * frameById names one frame by its id, as a result's `frame.id` or
 * {@link Page.frames} report it. The id stays the same across navigations of
 * the frame, but belongs to this session: prefer {@link frameUrl},
 * {@link frameName} or the iframe's own selector in anything that is written
 * down.
 *
 * @param frameId - the frame's id
 *
 * @returns Locator usable only as a container
 *
 * @example
 * const found = await page.wait(css("#card"));
 * const title = await page.evaluateIn(frameById(found.element.frame.id), "document.title");
 */
export function frameById(frameId: string): Locator {
  return Locator._frame({ frameIdValue: frameId });
}

/**
 * mainFrame names the page's main document. A {@link css} locator put in it
 * is not looked for in any iframe.
 *
 * @returns Locator usable only as a container
 *
 * @example
 * // Only the page's own button, not one in an embedded widget.
 * await page.click(css("button.accept").in(mainFrame()));
 */
export function mainFrame(): Locator {
  return Locator._frame({ isMainFrame: true });
}

/**
 * anyFrame names every frame, one after the other: the main document, then
 * each iframe. It is what makes a {@link js} locator search all frames, which
 * it does not do by itself. Put in a frame container with in(), it means that
 * frame and the frames below it.
 *
 * @returns Locator usable only as a container
 *
 * @example
 * await page.wait(
 *   js(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Accept all')`)
 *     .in(anyFrame()),
 * );
 */
export function anyFrame(): Locator {
  return Locator._frame({ isAnyFrame: true });
}

/**
 * frame requires the element a locator names to be an iframe.
 *
 * A container made with {@link css}, {@link js} or a reference is entered as
 * a frame when the element is an iframe and searched as a subtree when it is
 * anything else, which is usually what is wanted. Wrap it in frame() to hear
 * about it when the page gave something else: the call then fails with code
 * `"container_not_found"`, saying the element is not a frame, instead of
 * quietly searching a subtree.
 *
 * @param container - a css(), js() or reference locator
 *
 * @returns Locator usable as a container
 *
 * @example
 * const pay = frame(css("iframe.pay"));
 * await page.fill(css("input[name=cardnumber]").in(pay), card);
 */
export function frame(container: Locator): Locator {
  return Locator._mustBeFrame(container);
}

// ──────────────────────────────────────────────────────────────────────
// Wait-only conditions
// ──────────────────────────────────────────────────────────────────────

/**
 * CaptchaCondition is the wait condition built by {@link captcha}. It is
 * accepted by {@link Page.wait}/{@link Page.waitAny} only — it is not a
 * {@link Locator}, so no element action takes it.
 */
export class CaptchaCondition {
  readonly type = "captcha" as const;

  /** @internal Where the challenge has to be; undefined for the whole page. */
  constructor(readonly container?: Locator) {}

  /**
   * Confines the captcha condition to a container, the way
   * {@link Locator.in} does for an element: only a challenge inside that
   * frame or element counts. Without it, a challenge anywhere on the page
   * does.
   *
   * @param container - where to look
   *
   * @returns a new CaptchaCondition confined to the container
   *
   * @example
   * // Only a challenge in the checkout frame, not the one in the chat widget.
   * const checkout = frameUrl("*checkout.example.com/*");
   * await page.wait(captcha().in(checkout));
   */
  in(container: Locator): CaptchaCondition {
    return new CaptchaCondition(wrapIn(this.container, container));
  }
}

/**
 * RequestCondition is the wait condition built by {@link request}. It is
 * accepted by {@link Page.wait}/{@link Page.waitAny} only.
 */
export class RequestCondition {
  readonly type = "request" as const;

  constructor(
    readonly urlPattern: string,
    readonly abortFlag: boolean = false,
  ) {}

  /**
   * Drops the matching request: it is not sent, and the page receives an
   * empty 200 instead. The request is still returned in the wait result.
   *
   * @param v - true (the default) to drop the request, false to only observe it
   *
   * @returns a new RequestCondition with the flag applied
   *
   * @example
   * await page.wait(request("https://tracker.example.com/*").abort());
   */
  abort(v: boolean = true): RequestCondition {
    return new RequestCondition(this.urlPattern, v);
  }
}

/**
 * ResponseCondition is the wait condition built by {@link response}. It is
 * accepted by {@link Page.wait}/{@link Page.waitAny} only.
 */
export class ResponseCondition {
  readonly type = "response" as const;

  constructor(
    readonly urlPattern: string,
    readonly abortFlag: boolean = false,
  ) {}

  /**
   * Hides the matching response from the page: it receives an empty 200
   * instead. The real response is still returned in the wait result.
   *
   * @param v - true (the default) to hide the response, false to pass it through
   *
   * @returns a new ResponseCondition with the flag applied
   *
   * @example
   * await page.wait(response("https://example.com/api/token*").abort());
   */
  abort(v: boolean = true): ResponseCondition {
    return new ResponseCondition(this.urlPattern, v);
  }
}

/**
 * Anything {@link Page.wait}/{@link Page.waitAny} accepts: an element
 * {@link Locator} ({@link css} / {@link js}), {@link captcha},
 * {@link request} or {@link response}.
 */
export type WaitCondition = Locator | CaptchaCondition | RequestCondition | ResponseCondition;

/**
 * captcha matches as soon as a supported captcha or bot-protection
 * challenge is on the page and waits for an answer. A widget that passed, or
 * passes without interaction, does not count.
 *
 * It is a state, like {@link css}: a challenge that is already showing
 * matches at once. On a match the result's `kind` is `"captcha"` and its
 * `captcha` names the kind of challenge and the frame it sits in; hand the
 * page to {@link Page.solveCaptcha} to solve it.
 *
 * Most challenges live in an iframe, so the condition looks at the whole
 * page, every frame included. That is its own scope: the other conditions of
 * the same wait keep theirs. Use {@link CaptchaCondition.in} to confine it.
 *
 * @returns CaptchaCondition usable only as a wait condition
 *
 * @example
 * const r = await page.waitAny([css("#inbox"), captcha()]);
 * if (r.kind === "captcha") await page.solveCaptcha();
 */
export function captcha(): CaptchaCondition {
  return new CaptchaCondition();
}

/**
 * request matches the first request whose URL matches `urlPattern`.
 *
 * Unlike {@link css} or {@link captcha}, a request is an event, not a state:
 * only a request issued after the wait started counts. Start the wait before
 * the action that triggers the request, then await it. It watches the whole
 * browser session — the page, its frames, and any tab or popup it opens,
 * across navigations.
 *
 * On a match the result's `kind` is `"request"` and `request` carries the
 * method, URL, headers and body.
 *
 * @param urlPattern - URL wildcard; `*` matches any character span
 *
 * @returns RequestCondition usable only as a wait condition
 *
 * @example
 * const pending = page.wait(request("https://example.com/api/submit*"));
 * await page.click(css("button[type=submit]"));
 * const r = await pending;
 * if (r.kind === "request") console.log(r.request.method, r.request.body);
 */
export function request(urlPattern: string): RequestCondition {
  return new RequestCondition(urlPattern);
}

/**
 * response matches the response to the first request whose URL matches
 * `urlPattern`, once it has fully arrived.
 *
 * Same event semantics and scope as {@link request}: only a request issued
 * after the wait started counts, so start the wait before the action. On a
 * match the result's `kind` is `"response"` and `response` carries the
 * status, headers and body.
 *
 * @param urlPattern - URL wildcard, matched against the request URL
 *
 * @returns ResponseCondition usable only as a wait condition
 *
 * @example
 * const pending = page.wait(response("https://example.com/api/token*"));
 * await page.click(css("#login"));
 * const r = await pending;
 * if (r.kind === "response") console.log(r.response.statusCode, r.response.body);
 */
export function response(urlPattern: string): ResponseCondition {
  return new ResponseCondition(urlPattern);
}
