import type { Client } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  Browser,
  FocusPageRequestSchema,
  ClosePageRequestSchema,
  NavigateRequestSchema,
  LoadHTMLRequestSchema,
  EvaluateRequestSchema,
  WaitForAnyParamsSchema,
  WaitConditionSchema,
  WaitNetworkConditionSchema,
  ClickRequestSchema,
  FillRequestSchema,
  MoveToRequestSchema,
  ScrollToRequestSchema,
  DragRequestSchema,
  SelectOptionRequestSchema,
  GetDOMRequestSchema,
  GetDOMHashRequestSchema,
  GetObservationRequestSchema,
  ScreenshotRequestSchema,
  ReadCanvasRequestSchema,
  InspectAtPositionRequestSchema,
  HighlightNodeRequestSchema,
  InsertTextRequestSchema,
  TypeRequestSchema,
  PressKeyRequestSchema,
  ReleaseKeyRequestSchema,
  GetSelectionRequestSchema,
  SolveCaptchaRequestSchema,
  StartDomMirrorRequestSchema,
  StopDomMirrorRequestSchema,
  GetDomChildrenRequestSchema,
  ReleaseDomSubtreeRequestSchema,
  RevealDomNodeRequestSchema,
  GetDomRevisionRequestSchema,
  StreamDomEventsRequestSchema,
  RunScriptRequestSchema,
  StartScriptRequestSchema,
  StopScriptsRequestSchema,
  ListScriptRunsRequestSchema,
  StreamScriptEventsRequestSchema,
} from "./gen/wrc_pb.ts";
import {
  CaptchaCondition,
  Locator,
  RequestCondition,
  ResponseCondition,
  type WaitCondition,
} from "./locator.ts";
import {
  BrowserScaleError,
  CommandError,
  PageNotFocusedError,
  focusedPageIdOf,
  throwCommandError,
  type ClickError,
  type DragError,
  type FillError,
  type MoveError,
} from "./errors.ts";
import type {
  DOMResult,
  DragResult,
  ElementResult,
  EvaluateResult,
  InspectResult,
  NavigateResult,
  ScreenshotResult,
  ReadCanvasResult,
  SelectOptionResult,
  WaitResult,
  WaitElementResult,
  WaitCaptchaResult,
  WaitRequestResult,
  WaitResponseResult,
  ReactionInfo,
} from "./types.ts";
import type {
  ClickOpts,
  FillOpts,
  GetDOMOpts,
  GetObservationOpts,
  LoadHTMLOpts,
  NavigateOpts,
  ReactionOpts,
  ScreenshotOpts,
  ReadCanvasOpts,
  SelectOpts,
  WaitOpts,
} from "./options.ts";
import {
  ScriptFollow,
  ScriptRun,
  scriptLogEntryFromProto,
  type ScriptEventHandler,
  type ScriptResult,
  type ScriptRunInfo,
} from "./scripts.ts";
import {
  DomMirror,
  type DomChangeHandler,
  type DomMirrorOptions,
  type DomResyncHandler,
  type DomSnapshot,
} from "./dom-mirror.ts";
import {
  elementFields,
  headersToProto,
  rectFromProto,
  unwrapClick,
  unwrapDrag,
  unwrapFill,
  unwrapMove,
  unwrapScroll,
  unwrapSelect,
  unwrapWait,
} from "./internal/convert.ts";
import { addReaction, listReactions, removeReaction, type ReactionScope } from "./internal/reactions.ts";
import type { CloudBrowser } from "./client.ts";

type BrowserRpcClient = Client<typeof Browser>;

/**
 * Page is one page (tab or popup) of the browser. Everything that acts on a
 * document — navigating, waiting, clicking, typing, reading — is a Page method.
 *
 * A Page is only the page's id: it holds no state and asks for none, so it
 * never goes stale on its own. Which pages exist and which has the focus is
 * the browser's to know. When the page closes, its next call rejects with a
 * {@link PageClosedError} that names the page that has the focus now.
 *
 * A browser starts without a page: {@link CloudBrowser.createPage} opens the
 * first. Get one from {@link CloudBrowser.createPage},
 * {@link CloudBrowser.focusedPage}, {@link CloudBrowser.pages} or
 * {@link CloudBrowser.getPage} — never construct it directly.
 */
export class Page {
  /** The page's id, stable for the life of the page. */
  readonly id: string;
  /** The browser the page belongs to. */
  readonly browser: CloudBrowser;
  private readonly client: BrowserRpcClient;
  private readonly sessionId: string;
  private readonly apiKey: string;

  /** @internal Constructed by CloudBrowser; get a Page from createPage(), focusedPage(), pages() or getPage(). */
  constructor(browser: CloudBrowser, client: BrowserRpcClient, sessionId: string, apiKey: string, id: string) {
    this.browser = browser;
    this.client = client;
    this.sessionId = sessionId;
    this.apiKey = apiKey;
    this.id = id;
  }

  // ──────────────────────────────────────────────────────────────────
  // Focus / lifecycle
  // ──────────────────────────────────────────────────────────────────

  /**
   * Brings the page to the front, the way clicking its tab does: it becomes
   * visible, and the page it replaces is hidden. Focusing the page that
   * already has the focus changes nothing.
   *
   * @throws {@link PageClosedError} - the page has closed
   *
   * @example
   * await page.focus();
   */
  async focus(): Promise<void> {
    const res = await this.client.focusPage(
      create(FocusPageRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("focusPage", res.error);
  }

  /**
   * Closes the page the way closing its tab does. Its unload handlers run, but
   * no "leave site?" prompt is shown. Resolves once the page is gone.
   *
   * @returns the page that has the focus afterwards; when the closed page had
   *   it, the browser hands it on, usually to the page that opened it
   *
   * @throws last_page - it is the browser's only page; a browser keeps at least
   *   one, stop the browser to end it
   * @throws timeout - the close was started but the page was still open after a
   *   few seconds
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * page = await popup.close();
   */
  async close(): Promise<Page> {
    const resp = await this.client.closePage(
      create(ClosePageRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("closePage", resp.error);
    return this.browser.getPage(resp.focusedPageId ?? "");
  }

  /**
   * Wraps err in a {@link PageNotFocusedError} when it says the page does not
   * have the focus, and returns it unchanged otherwise.
   */
  private notFocused(err: unknown): unknown {
    const focused = focusedPageIdOf(err);
    if (focused === undefined) return err;
    return new PageNotFocusedError({
      focusedPage: this.browser.getPage(focused),
      cause: err as ClickError | MoveError | FillError | DragError,
    });
  }

  /** Runs unwrap, rethrowing a not-focused failure as {@link PageNotFocusedError}. */
  private focusGuard<T>(unwrap: () => T): T {
    try {
      return unwrap();
    } catch (e) {
      throw this.notFocused(e);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Page navigation / content
  // ──────────────────────────────────────────────────────────────────

  /**
   * Navigates the page to url.
   *
   * Returns once the primary main-frame navigation commits (the response
   * is received and a new document is selected), before DOMContentLoaded or
   * load fire. Cross-origin redirects are followed.
   *
   * @param url - destination URL
   * @param opts - optional navigation customization (e.g. timeoutMs)
   *
   * @returns NavigateResult with the final resolved URL and the frameId
   *   of the main frame after navigation
   *
   * @throws timeout - nothing committed before the deadline; the page may still
   *   be loading, so a longer timeout can be the whole fix
   * @throws net_error - the URL never loaded: DNS, TLS, a refused connection, or
   *   a proxy that could not reach it. The message carries the underlying net
   *   error name, which is what separates a bad proxy from a bad host - worth
   *   logging, since the two need different fixes
   * @throws crashed - the renderer died mid-navigation; the page is unusable and
   *   has to be navigated again
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * await page.navigate("https://example.com");
   */
  async navigate(url: string, opts?: NavigateOpts): Promise<NavigateResult> {
    const req = create(NavigateRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      url,
    });
    if (opts?.timeoutMs) req.timeout = opts.timeoutMs;
    const resp = await this.client.navigate(req);
    throwCommandError("navigate", resp.error);
    return { frameId: resp.frameId, url: resp.url };
  }

  /**
   * Serves a synthetic response for the next navigation to url.
   *
   * Registers a one-shot interceptor that intercepts the next request to
   * url and replies with the supplied html and headers instead of going to
   * the network. Useful for snapshotted pages, test fixtures, and offline
   * replays. Pair with {@link navigate} to trigger the load.
   *
   * @param url - URL pattern that, when navigated to, returns the html
   * @param html - response body to serve
   * @param opts - optional headers and statusCode (default 200)
   *
   * @throws timeout - the page never requested the URL, so the prepared
   *   response had nobody to hand it to; usually the navigation was cancelled
   *   or redirected away before reaching it
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * await page.loadHTML("https://example.com", "<h1>hi</h1>");
   * await page.navigate("https://example.com");
   */
  async loadHTML(url: string, html: string, opts?: LoadHTMLOpts): Promise<void> {
    const req = create(LoadHTMLRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      url,
      html,
      headers: headersToProto(opts?.headers),
    });
    if (opts?.statusCode) req.statusCode = opts.statusCode;
    const res = await this.client.loadHTML(req);
    throwCommandError("loadHTML", res.error);
  }

  // ──────────────────────────────────────────────────────────────────
  // Evaluation
  // ──────────────────────────────────────────────────────────────────

  /**
   * Runs a JavaScript expression in the page's main frame.
   *
   * The expression's return value is JSON-serialized server-side and
   * parsed eagerly into `.value`. When the expression returns a DOM
   * element the `.value` is null and the element metadata
   * (backendNodeId, isVisible, bounds) is populated instead — use
   * {@link node} in subsequent calls to act on it.
   *
   * The generic T is a TypeScript hint only — there is no runtime
   * validation that the JS expression actually returned that type.
   *
   * A falsy answer and a broken expression are different outcomes. Returning
   * null, false or undefined is a successful evaluation and resolves normally;
   * an expression that throws or will not compile rejects with a
   * {@link CommandError}, so a typo can never read as "the page says null".
   *
   * @param expression - JavaScript expression evaluated in the main frame
   *
   * @returns EvaluateResult with either value (non-Element) or element
   *   metadata (Element)
   *
   * @throws {@link CommandError} - code `"threw"` (the expression raised; the
   *   message carries the exception text), `"not_run"` (it could not be
   *   compiled, or execution never started), `"aborted"` (the browser stopped
   *   execution) or `"no_context"` (the frame had no live script context)
   *
   * @example
   * const res = await browser.evaluate<string>("document.title");
   * console.log(res.value);
   *
   * @example
   * // Telling a false answer from a broken expression.
   * try {
   *   const res = await browser.evaluate<boolean>("window.__ready === true");
   *   if (!res.value) { /* legitimately not ready yet *\/ }
   * } catch (e) {
   *   if (e instanceof CommandError) throw new Error(`expression broken: ${e.message}`);
   *   throw e;
   * }
   */
  async evaluate<T = unknown>(expression: string): Promise<EvaluateResult<T>> {
    return this._evaluate<T>("", expression);
  }

  /**
   * Runs a JavaScript expression in the given frame.
   *
   * Same semantics as {@link evaluate} but targets a specific frame
   * instead of the main frame. Useful for evaluating inside OOPIFs (out-
   * of-process iframes) found via {@link CloudBrowser.pages}. ALL_FRAMES is not
   * supported here.
   *
   * @inheritDoc CloudBrowser.evaluate
   * @param frameId - id of the frame to evaluate in
   *
   * @example
   * const pages = await browser.pages();
   * const iframeId = pages[0].frameTree.children[0].frameId;
   * await page.evaluateInFrame(iframeId, "location.href");
   */
  async evaluateInFrame<T = unknown>(
    frameId: string,
    expression: string,
  ): Promise<EvaluateResult<T>> {
    return this._evaluate<T>(frameId, expression);
  }

  private async _evaluate<T>(
    frameId: string,
    expression: string,
  ): Promise<EvaluateResult<T>> {
    const req = create(EvaluateRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      expression,
    });
    if (frameId) req.frameId = frameId;
    const resp = await this.client.evaluate(req);
    // An expression that threw arrives as success=false in the payload, not as a
    // transport error, so it is raised here rather than by the call above.
    if (resp.error) {
      throw new CommandError({
        command: "evaluate",
        code: resp.error.code,
        message: resp.error.message,
      });
    }
    let value: T | null = null;
    if (resp.result !== "") {
      try {
        value = JSON.parse(resp.result) as T;
      } catch {
        value = resp.result as unknown as T;
      }
    }
    return {
      success: resp.success,
      value: value as T,
      backendNodeId: resp.backendNodeId,
      isVisible: resp.isVisible,
      bounds: rectFromProto(resp.bounds),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Waiting
  // ──────────────────────────────────────────────────────────────────

  /**
   * Blocks until the given condition matches.
   *
   * Shortcut for `waitAny([condition], opts)`. See {@link waitAny} for the
   * kinds of condition, timeout handling, per-locator visible/steady defaults
   * and the locators that are not valid wait conditions.
   *
   * With a single condition the kind of the result is known up front, so the
   * return type is already narrowed: a locator yields `element`, request()
   * yields `request`, and so on.
   *
   * @inheritDoc CloudBrowser.waitAny
   * @param condition - the single condition to wait for
   *
   * @example
   * const r = await page.wait(css(".success"));
   * console.log(r.element.bounds);
   */
  async wait(condition: Locator, opts?: WaitOpts): Promise<WaitElementResult>;
  async wait(condition: CaptchaCondition, opts?: WaitOpts): Promise<WaitCaptchaResult>;
  async wait(condition: RequestCondition, opts?: WaitOpts): Promise<WaitRequestResult>;
  async wait(condition: ResponseCondition, opts?: WaitOpts): Promise<WaitResponseResult>;
  async wait(condition: WaitCondition, opts?: WaitOpts): Promise<WaitResult>;
  async wait(condition: WaitCondition, opts?: WaitOpts): Promise<WaitResult> {
    return this.waitAny([condition], opts);
  }

  /**
   * Blocks until any of the supplied conditions matches.
   *
   * Conditions can be mixed freely and are watched in parallel; the first one
   * to match wins and the others are abandoned:
   *   - {@link css} / {@link js} — an element (or a truthy expression)
   *   - {@link captcha} — a supported captcha or bot-protection challenge
   *   - {@link request} / {@link response} — a network request or its response
   *
   * Element and captcha conditions are states: they match if the page already
   * is (or becomes) in that state. Request and response conditions are
   * events: only what happens after the wait started counts. A wait does not
   * block the page, so start it first, trigger the action (click,
   * solveCaptcha, navigate…), then await it.
   *
   * The result's `.index` points to the entry in `conditions` that matched
   * and `.kind` says which kind it was; narrow on `kind` to reach `element`,
   * `request` or `response`.
   *
   * Defaults applied automatically:
   *   - timeout: 30000 ms — override via `opts.timeoutMs`
   *   - per-locator visible/steady: `true` / `500` for css() and js()
   *     locators. For js() expressions returning a non-Element value both
   *     flags are no-ops. Override with `.visible(false)` / `.steady(ms)`
   *     on individual locators.
   *
   * {@link node} and {@link at} are not valid wait conditions — they only
   * make sense as action targets — and throw at send time.
   *
   * @param conditions - one or more conditions to wait for; must be non-empty
   * @param opts - optional wait customization (timeoutMs)
   *
   * @returns WaitResult for the first matching condition
   *
   * @throws {@link WaitError} - no condition matched before the deadline;
   *   `.conditions` holds the per-condition breakdown of why each never matched
   * @throws {@link BrowserScaleError} - a condition was invalid, or a
   *   server/transport error occurred
   *
   * @example
   * // Whatever comes first: the inbox, a captcha, or the error page.
   * const r = await page.waitAny(
   *   [css("#inbox"), captcha(), request("https://example.com/error*")],
   *   { timeoutMs: 60000 },
   * );
   * if (r.kind === "captcha") await page.solveCaptcha();
   *
   * @example
   * // Start the wait first, then trigger the response it waits for.
   * const pending = page.wait(response("https://example.com/api/login*"));
   * await page.click(css("button[type=submit]"));
   * console.log((await pending).response.statusCode);
   */
  async waitAny(conditions: WaitCondition[], opts?: WaitOpts): Promise<WaitResult> {
    if (conditions.length === 0) {
      throw new BrowserScaleError("browserscale.waitAny: at least one condition required");
    }
    const pbConds = conditions.map((cond, i) => {
      if (cond instanceof CaptchaCondition) {
        return create(WaitConditionSchema, { captcha: true });
      }
      if (cond instanceof RequestCondition || cond instanceof ResponseCondition) {
        if (!cond.urlPattern) {
          throw new BrowserScaleError(
            `browserscale.waitAny: condition ${i}: ${cond.type}() needs a URL pattern`,
          );
        }
        const net = create(WaitNetworkConditionSchema, {
          urlPattern: cond.urlPattern,
          abort: cond.abortFlag,
        });
        return cond.type === "request"
          ? create(WaitConditionSchema, { request: net })
          : create(WaitConditionSchema, { response: net });
      }
      if (!cond.selector && !cond.jsExpression) {
        throw new BrowserScaleError(
          `browserscale.waitAny: condition ${i} has neither selector nor JS expression (node()/at() are not valid wait conditions)`,
        );
      }
      const pc = create(WaitConditionSchema);
      if (cond.selector) pc.selector = cond.selector;
      if (cond.jsExpression) pc.jsExpression = cond.jsExpression;
      if (cond.visibleFlag !== undefined) pc.visible = cond.visibleFlag;
      if (cond.steadyMs !== undefined) pc.steadyTime = cond.steadyMs;
      return pc;
    });

    // Call-level frameId: take from the first locator that has one (Wait
    // doesn't accept a separate frame override yet — mirrors Go wait.go).
    // captcha() / request() / response() have no frame of their own.
    let frameId = "";
    for (const c of conditions) {
      if (c instanceof Locator && c.frameId) {
        frameId = c.frameId;
        break;
      }
    }

    const req = create(WaitForAnyParamsSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      conditions: pbConds,
      // Left unset unless the caller passed one, so the API applies its default.
      timeout: opts?.timeoutMs,
    });
    if (frameId) req.frameId = frameId;

    return unwrapWait(await this.client.waitForAny(req));
  }

  // ──────────────────────────────────────────────────────────────────
  // Element actions
  // ──────────────────────────────────────────────────────────────────

  /**
   * Triggers a single left mouse click on the given target.
   *
   * The browser scrolls the element into view if needed, moves the
   * cursor along a human-like path, then dispatches a full
   * mouseDown+mouseUp at a randomized point inside the element's
   * bounding rect.
   *
   * For right-click, double-click, press/release-only, or to override
   * the target frame, pass a `ClickOpts` object as the second argument.
   *
   * @param target - locator describing what to click; {@link at} is also valid
   * @param opts - optional click customization; see {@link ClickOpts}
   *
   * @returns ElementResult with success, resolved frameId, backendNodeId,
   *   post-scroll isVisible, element bounds, and the root-viewport
   *   (rootX, rootY) where the click landed
   *
   * @throws {@link ClickError} - the target was found but the click could not
   *   land because another element covered it; `.code`, `.occluder` and
   *   `.result` describe the blocker and the resolved coordinates. Code
   *   `"captcha_failed"`: a captcha appeared during the click and was not
   *   solved, with auto-solve set to `onFailure: "fail"`
   *   ({@link CloudBrowser.enableCaptchaAutoSolve}); `.result.captchas` lists it
   * @throws {@link BrowserScaleError} - invalid locator, or a server/transport
   *   error (element not found, frame not found, timeout, page closed)
   *
   * @example
   * try {
   *   await page.click(css("button.submit"));
   * } catch (e) {
   *   if (e instanceof ClickError) console.log(e.code, e.occluder?.tagName);
   * }
   *
   * @example
   * // Right double-click on a context menu trigger.
   * await page.click(css("li.menu"), { button: "right", clickCount: 2 });
   */
  async click(target: Locator, opts?: ClickOpts): Promise<ElementResult> {
    target.validateTarget("click", true);
    const req = create(ClickRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      ...elementFields(target, opts?.inFrame),
    });
    if (opts?.button) req.button = opts.button;
    if (opts?.clickCount) req.clickCount = opts.clickCount;
    if (opts?.action) req.action = opts.action;
    const resp = await this.client.click(req);
    return this.focusGuard(() => unwrapClick(resp));
  }

  /**
   * Clicks the target and types text into it, appending to any existing
   * content.
   *
   * The browser scrolls the element into view, moves the cursor along
   * a human-like path, clicks to focus, then types the text character-
   * by-character with QWERTZ keyboard simulation and human-like timing.
   *
   * To overwrite the field instead of appending, pass `{ clearFirst: true }`.
   *
   * {@link at} is not a valid target — fill requires an actual element.
   *
   * @param target - locator describing the input element
   * @param text - text to type into the element
   * @param opts - optional fill customization; see {@link FillOpts}
   *
   * @returns ElementResult with success, resolved frameId, backendNodeId
   *   and the root-viewport (rootX, rootY) where the element was clicked
   *
   * @throws {@link FillError} - the field could not be focused/typed; `.code`
   *   and `.clickError` (the underlying click-core failure) describe why. Code
   *   `"captcha_failed"`: a captcha appeared during the fill and was not
   *   solved, with auto-solve set to `onFailure: "fail"`
   *   ({@link CloudBrowser.enableCaptchaAutoSolve})
   * @throws {@link BrowserScaleError} - invalid locator, or a server/transport
   *   error (element not found, frame not found, timeout, page closed)
   *
   * @example
   * await page.fill(css("input[name=email]"), "user@example.com");
   *
   * @example
   * // Wipe the field first, then type fresh content.
   * await page.fill(css("input[name=email]"), "user@example.com", { clearFirst: true });
   */
  async fill(target: Locator, text: string, opts?: FillOpts): Promise<ElementResult> {
    target.validateTarget("fill", false);
    const req = create(FillRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      text,
      ...elementFields(target, opts?.inFrame),
    });
    if (opts?.clearFirst) req.clearFirst = true;
    if (opts?.timeoutMs !== undefined) req.timeout = opts.timeoutMs;
    if (opts?.steadyMs !== undefined) req.steadyTime = opts.steadyMs;
    const resp = await this.client.fill(req);
    return this.focusGuard(() => unwrapFill(resp));
  }

  /**
   * Moves the mouse cursor over the given target.
   *
   * The browser scrolls the target into view first if necessary, then
   * animates the cursor along a human-like path to the element's center
   * (or to the viewport coordinate when target is {@link at}).
   *
   * @param target - locator describing where to move; {@link at} is also valid
   *
   * @returns ElementResult with the resolved frameId, backendNodeId,
   *   post-scroll isVisible, element bounds and the root-viewport
   *   (rootX, rootY) where the cursor ended up
   *
   * @throws {@link MoveError} - the target could not be located (`.code` is
   *   `"not_found"`); `.result` carries the resolved payload
   * @throws {@link BrowserScaleError} - invalid locator or a server/transport error
   *
   * @example
   * await page.moveTo(css("nav .menu"));
   */
  async moveTo(target: Locator): Promise<ElementResult> {
    target.validateTarget("moveTo", true);
    const req = create(MoveToRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      ...elementFields(target),
    });
    const resp = await this.client.moveTo(req);
    return this.focusGuard(() => unwrapMove(resp));
  }

  /**
   * Scrolls the given element into view.
   *
   * Whatever scroll container is closest to the element does the
   * scrolling — nested scroll containers and out-of-process iframe chains
   * are walked automatically. {@link at} is not a valid target here;
   * scrolling needs a real element.
   *
   * @param target - locator describing the element to bring into view;
   *   {@link at} is rejected
   *
   * @returns ElementResult with the resolved frameId, backendNodeId,
   *   post-scroll isVisible and the element's bounds after the scroll
   *
   * @throws {@link ScrollError} - the target could not be located/scrolled
   *   (`.code` is `"not_found"`); `.result` carries the resolved payload
   * @throws {@link BrowserScaleError} - invalid locator or a server/transport error
   *
   * @example
   * await page.scrollTo(css("#footer"));
   */
  async scrollTo(target: Locator): Promise<ElementResult> {
    target.validateTarget("scrollTo", false);
    const req = create(ScrollToRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      ...elementFields(target),
    });
    return unwrapScroll(await this.client.scrollTo(req));
  }

  /**
   * Picks up the target and drops it at an offset relative to the pickup
   * point.
   *
   * The browser presses the left mouse button at a pickup point inside
   * the element, drags along a human-like path to (pickupX+offsetX,
   * pickupY+offsetY), then releases. {@link at} is not a valid target —
   * drag needs a real element.
   *
   * @param target - locator describing the element to pick up
   * @param offsetX - horizontal distance to drag, in CSS pixels
   * @param offsetY - vertical distance to drag, in CSS pixels
   *
   * @returns DragResult with the resolved frameId, backendNodeId and the
   *   final cursor position (rootX, rootY) where the drop happened
   *
   * @throws {@link DragError} - the source could not be acquired/pressed;
   *   `.code` and `.clickError` describe the underlying click-core failure.
   *   Code `"captcha_failed"`: a captcha appeared during the drag and was not
   *   solved, with auto-solve set to `onFailure: "fail"`
   *   ({@link CloudBrowser.enableCaptchaAutoSolve})
   * @throws {@link BrowserScaleError} - invalid locator or a server/transport error
   *
   * @example
   * await page.dragBy(css(".slider .handle"), 120, 0);
   */
  async dragBy(
    target: Locator,
    offsetX: number,
    offsetY: number,
  ): Promise<DragResult> {
    return this._drag(target, { offsetX, offsetY });
  }

  /**
   * Picks up the target and drops it at absolute root-viewport coordinates.
   *
   * Same gesture as {@link dragBy}, but the drop destination is in page
   * coordinates rather than relative to the pickup point.
   *
   * @param target - locator describing the element to pick up
   * @param absoluteX - horizontal drop coordinate in the root viewport
   * @param absoluteY - vertical drop coordinate in the root viewport
   *
   * @returns DragResult with the resolved frameId, backendNodeId and the
   *   final cursor position (rootX, rootY) where the drop happened
   *
   * @throws {@link DragError} - the source could not be acquired/pressed;
   *   `.code` and `.clickError` describe the underlying click-core failure.
   *   Code `"captcha_failed"`: as in {@link dragBy}
   * @throws {@link BrowserScaleError} - invalid locator or a server/transport error
   *
   * @example
   * await page.dragTo(css(".card"), 800, 400);
   */
  async dragTo(
    target: Locator,
    absoluteX: number,
    absoluteY: number,
  ): Promise<DragResult> {
    return this._drag(target, { absoluteX, absoluteY });
  }

  private async _drag(
    target: Locator,
    spec: { offsetX?: number; offsetY?: number; absoluteX?: number; absoluteY?: number },
  ): Promise<DragResult> {
    target.validateTarget("drag", false);
    const req = create(DragRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      ...elementFields(target),
    });
    if (spec.offsetX !== undefined) req.offsetX = spec.offsetX;
    if (spec.offsetY !== undefined) req.offsetY = spec.offsetY;
    if (spec.absoluteX !== undefined) req.absoluteX = spec.absoluteX;
    if (spec.absoluteY !== undefined) req.absoluteY = spec.absoluteY;
    const resp = await this.client.drag(req);
    return this.focusGuard(() => unwrapDrag(resp));
  }

  /**
   * Picks the `<option>` at the zero-based index inside the targeted
   * `<select>` element.
   *
   * Sets the option as selected on the targeted `<select>`, then fires
   * the standard input + change events (unless suppressed via
   * `opts.fireEvents = false`).
   *
   * {@link at} is not a valid target — select requires an actual
   * `<select>` element.
   *
   * @param target - locator describing the `<select>` element
   * @param index - zero-based option index
   * @param opts - optional select customization; see {@link SelectOpts}
   *
   * @returns SelectOptionResult with the resolved selectedIndex,
   *   selectedValue and selectedText after the change
   *
   * @throws {@link SelectOptionError} - the option could not be selected;
   *   `.code` is `"not_found"` (no `<select>`) or `"option_not_found"`
   * @throws {@link BrowserScaleError} - invalid locator, or a server/transport
   *   error (frame not found, timeout, page closed)
   *
   * @example
   * await page.selectByIndex(css("select#country"), 2);
   *
   * @example
   * // Pick the option silently, no input/change events.
   * await page.selectByIndex(css("select#hidden"), 0, { fireEvents: false });
   */
  async selectByIndex(
    target: Locator,
    index: number,
    opts?: SelectOpts,
  ): Promise<SelectOptionResult> {
    return this._select(target, opts, req => { req.index = index; });
  }

  /**
   * Picks the `<option>` whose `value` attribute matches the given
   * string exactly.
   *
   * @inheritDoc {@link Page.selectByIndex}
   * @param value - the `value` attribute to match
   *
   * @example
   * await page.selectByValue(css("select#country"), "DE");
   */
  async selectByValue(
    target: Locator,
    value: string,
    opts?: SelectOpts,
  ): Promise<SelectOptionResult> {
    return this._select(target, opts, req => { req.value = value; });
  }

  /**
   * Picks the `<option>` whose visible (trimmed) text matches the given
   * string exactly.
   *
   * @inheritDoc {@link Page.selectByIndex}
   * @param text - the visible option text to match
   *
   * @example
   * await page.selectByText(css("select#country"), "Germany");
   */
  async selectByText(
    target: Locator,
    text: string,
    opts?: SelectOpts,
  ): Promise<SelectOptionResult> {
    return this._select(target, opts, req => { req.text = text; });
  }

  private async _select(
    target: Locator,
    opts: SelectOpts | undefined,
    withKey: (req: ReturnType<typeof create<typeof SelectOptionRequestSchema>>) => void,
  ): Promise<SelectOptionResult> {
    target.validateTarget("selectOption", false);
    const req = create(SelectOptionRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      ...elementFields(target, opts?.inFrame),
    });
    withKey(req);
    if (opts?.fireEvents === false) req.fireEvents = false;
    return unwrapSelect(await this.client.selectOption(req));
  }

  // ──────────────────────────────────────────────────────────────────
  // DOM / observation
  // ──────────────────────────────────────────────────────────────────

  /**
   * Returns the DOM in CDP DOM.Node shape for the requested frame.
   *
   * The shape matches Chrome DevTools' Protocol DOM.Node — useful for
   * piping into agent loops or visualizers that already speak CDP. For a
   * much smaller agent-oriented payload, prefer {@link getObservation}
   * instead. The cheap polling endpoint is {@link getDOMHash}.
   *
   * @param frameId - id of the frame to dump; empty string targets the main frame
   * @param opts - optional `depth`: -1 full tree (default), 0 root only,
   *   N root + N descendant levels
   *
   * @returns DOMResult with the JSON string in `.dom` (the `.hash` field
   *   is populated by {@link getDOMHash}, not by this call)
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const { dom } = await page.getDOM();
   */
  async getDOM(frameId: string = "", opts?: GetDOMOpts): Promise<DOMResult> {
    const req = create(GetDOMRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
    });
    if (frameId) req.frameId = frameId;
    if (opts?.depth !== undefined) req.depth = opts.depth;
    const resp = await this.client.getDOM(req);
    throwCommandError("getDOM", resp.error);
    return { hash: "", dom: resp.dom };
  }

  /**
   * Returns sha256[:8] of the full-tree DOM JSON for cheap polling-based
   * change detection.
   *
   * Computing a hash is much cheaper than transferring the full tree —
   * pair this with {@link getDOM} only when the hash differs from your
   * last snapshot.
   *
   * @param frameId - id of the frame to hash; empty string targets the main frame
   *
   * @returns 16-char hex string (the first 8 bytes of sha256 of the DOM JSON)
   *
   * Rejects only on a transport failure. The hash is computed from a serialized
   * tree, so there is no semantic failure of its own and no error codes to branch
   * on.
   *
   * @example
   * const hash = await page.getDOMHash();
   * if (hash !== lastHash) {
   *   // DOM changed → re-fetch
   * }
   */
  async getDOMHash(frameId: string = ""): Promise<string> {
    const req = create(GetDOMHashRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
    });
    if (frameId) req.frameId = frameId;
    const resp = await this.client.getDOMHash(req);
    return resp.hash;
  }

  /**
   * Returns a compact, frame-aware view of the visible page — the first thing
   * to reach for on an unfamiliar page, and the cheapest way to re-read the
   * current state afterwards.
   *
   * Each frame opens with header lines carrying the URL, the title and the
   * scroll position, then one line per visible element:
   *
   * ```
   * input#email[47] type="email" name="loginId" value="a@b.com" required click "E-Mail"
   * ```
   *
   * It spans every frame, pierces open and closed shadow roots, enumerates
   * `<select>` options, and reports live form state: `value=` is what is typed
   * in right now (passwords as a length), `checked=` for boxes. The trailing
   * quoted string is always the label or text, never the value, so an empty and
   * a prefilled field stay distinguishable. Because the headers already carry
   * URL, title and scroll offset, this replaces the usual handful of
   * {@link evaluate} probes after each step.
   *
   * On what to do with the result: backendNodeId (the `47` above) is a handle
   * for this session and can be passed straight to click/fill via
   * {@link node}. It does not survive a new document, so for anything you write
   * into a script, target with {@link css} or {@link js} instead — those calls
   * return the backendNodeId they resolved to, which lets you confirm the
   * durable anchor hits the element you saw.
   *
   * @param opts - optional format and budget overrides; see {@link GetObservationOpts}
   *
   * @returns the observation in the requested format, ready to hand to a model
   *
   * @throws not_found - the requested scope root is not on the page, so there
   *   was nothing to observe. Distinct from an observation that comes back
   *   empty, which means the scope exists and holds nothing worth reporting
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * const obs = await page.getObservation();
   * console.log(obs);
   */
  async getObservation(opts?: GetObservationOpts): Promise<string> {
    const req = create(GetObservationRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
    });
    if (opts?.format !== undefined) req.format = opts.format;
    if (opts?.maxElementsPerFrame !== undefined) {
      req.maxElementsPerFrame = opts.maxElementsPerFrame;
    }
    if (opts?.maxTextLength !== undefined) req.maxTextLength = opts.maxTextLength;
    if (opts?.maxTotalTokens !== undefined) req.maxTotalTokens = opts.maxTotalTokens;
    if (opts?.includeBounds !== undefined) req.includeBounds = opts.includeBounds;
    if (opts?.viewportOnly !== undefined) req.viewportOnly = opts.viewportOnly;
    if (opts?.backendNodeId !== undefined) req.backendNodeId = opts.backendNodeId;
    if (opts?.selector !== undefined) req.selector = opts.selector;
    if (opts?.jsExpression !== undefined) req.jsExpression = opts.jsExpression;
    if (opts?.frameId !== undefined) req.frameId = opts.frameId;
    const resp = await this.client.getObservation(req);
    throwCommandError("getObservation", resp.error);
    return resp.observation;
  }

  /**
   * Captures a single image of the page's current frame and returns it as
   * base64-encoded image bytes.
   *
   * The capture uses a one-shot surface copy (the same mechanism as CDP
   * Page.captureScreenshot), so it is independent of any active live stream
   * and works with both GPU (hardware) and software compositing.
   *
   * @param opts - optional `format` ("png" default, "jpeg", "webp") and
   *   `quality` (0-100, for jpeg/webp only); omit to use the server defaults
   *
   * @returns ScreenshotResult with the base64 image in `dataBase64` and the
   *   physical pixel `width`/`height`
   *
   * @throws capture_failed - the page had no frame to copy. A page that has not
   *   produced one yet, or is not being composited at the moment, has nothing to
   *   hand over; retrying after it renders usually works
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * const shot = await page.screenshot({ format: "png" });
   * await fs.writeFile("page.png", Buffer.from(shot.dataBase64, "base64"));
   */
  async screenshot(opts?: ScreenshotOpts): Promise<ScreenshotResult> {
    const req = create(ScreenshotRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
    });
    if (opts?.format !== undefined) req.format = opts.format;
    if (opts?.quality !== undefined) req.quality = opts.quality;
    const resp = await this.client.screenshot(req);
    throwCommandError("screenshot", resp.error);
    return {
      dataBase64: resp.dataBase64,
      width: resp.width,
      height: resp.height,
    };
  }

  /**
   * Reads the pixels of a <canvas> element directly in the renderer,
   * bypassing the origin-clean (tainted) security check and without executing
   * any page JavaScript — so cross-origin/tainted canvases (common in
   * captchas) read fine where a normal `toDataURL` / `getImageData` would
   * throw a SecurityError.
   *
   * {@link at} is not a valid target — a real <canvas> element is required.
   *
   * @param target - locator for the <canvas>; {@link css}, {@link js} or {@link node}
   * @param opts - optional `format`, `quality`, sub-rectangle and frame
   *   override; see {@link ReadCanvasOpts}
   *
   * @returns ReadCanvasResult with the base64 image in `dataBase64`, the
   *   canvas `width`/`height`, resolved `frameId`/`backendNodeId` and the
   *   `originClean` flag
   *
   * @throws not_found - no element matched the locator
   * @throws not_element - the expression was truthy but did not yield an element
   * @throws not_readable - the target was found but is not a readable canvas
   *
   * A target that is empty, uses `at(x, y)` or names several things at once is
   * rejected before anything is sent. A closed page or a frame that is gone is a
   * transport failure rather than a code.
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * const res = await page.readCanvas(css("#game canvas"));
   * await fs.writeFile("canvas.png", Buffer.from(res.dataBase64, "base64"));
   *
   * @example
   * // Read the left half as JPEG at quality 80.
   * const res = await page.readCanvas(css("canvas"), {
   *   format: "jpeg", quality: 80, sw: 150, sh: 300,
   * });
   */
  async readCanvas(
    target: Locator,
    opts?: ReadCanvasOpts,
  ): Promise<ReadCanvasResult> {
    // A real <canvas> is required — at(x,y) coordinates are not valid here.
    target.validateTarget("readCanvas", false);
    const req = create(ReadCanvasRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      ...elementFields(target, opts?.inFrame),
    });
    if (opts?.format !== undefined) req.format = opts.format;
    if (opts?.quality !== undefined) req.quality = opts.quality;
    if (opts?.sw !== undefined && opts?.sh !== undefined &&
        opts.sw > 0 && opts.sh > 0) {
      req.sx = opts.sx ?? 0;
      req.sy = opts.sy ?? 0;
      req.sw = opts.sw;
      req.sh = opts.sh;
    }
    const resp = await this.client.readCanvas(req);
    throwCommandError("readCanvas", resp.error);
    return {
      success: resp.success,
      frameId: resp.frameId,
      backendNodeId: resp.backendNodeId,
      dataBase64: resp.dataBase64,
      width: resp.width,
      height: resp.height,
      originClean: resp.originClean,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // DOM mirror
  // ──────────────────────────────────────────────────────────────────

  /**
   * Starts a live copy of a frame's DOM and keeps it up to date.
   *
   * The browser sends the top of the tree once, then reports only what changed
   * in the part you expanded. Everything else costs a child count per batch, no
   * matter how much churns inside it — which is what makes this usable on a
   * page that rewrites a list sixty times a second, where re-fetching the
   * document on a timer is not.
   *
   * Expand and collapse as the user opens and closes nodes; that is what moves
   * the boundary of what gets reported. The returned {@link DomMirror} holds
   * the tree and exposes `expand`, `collapse` and `reveal`.
   *
   * The handler runs after each applied batch. `mirror.root` is a new object
   * whenever anything under it changed and the untouched parts keep their
   * identity, so rendering straight from it with memoized components is cheap.
   *
   * One mirror covers the whole page as ONE tree. An `<iframe>` is an
   * ordinary element whose single child is the document it hosts; expanding it
   * fetches that document and starts mirroring the frame, however deeply
   * nested and whether or not it is cross-origin. Unlike the inlining
   * {@link Page.getDOM} does, these regions stay live — and frames
   * nobody opened cost nothing.
   *
   * ```ts
   * const mirror = await page.mirrorDom({ pierce: true }, () => {
   *   render(mirror.root);
   * });
   * await mirror.expand(bodyNode);
   * // ...
   * await mirror.stop();
   * ```
   *
   * @param opts initial depth and whether to pierce shadow roots
   * @param onChange called after every change, including the first snapshot
   * @param onResync called when the copy had to be rebuilt, after the new tree
   *   is in place. Rebuilding is automatic; this is for telling the user why
   *   their expanded nodes collapsed.
   * @throws mirror_failed - the page could not be serialized, usually a document
   *   that went away while the tree was being built. No mirror is left running
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async mirrorDom(
    opts: DomMirrorOptions,
    onChange: DomChangeHandler,
    onResync?: DomResyncHandler,
  ): Promise<DomMirror> {
    const abort = new AbortController();
    let subscribed!: () => void;
    const ready = new Promise<void>((resolve) => {
      subscribed = resolve;
    });

    const stream = this.client.streamDomEvents(
      create(StreamDomEventsRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
      }),
      { signal: abort.signal, onHeader: () => subscribed() },
    );

    const mirror = new DomMirror({
      stream,
      transport: {
        start: (o) => this.startDomMirror(o),
        stop: () => this.stopDomMirror(),
        children: (id, frameId, depth) => this.getDomChildren(id, frameId, depth),
        release: (id, frameId) => this.releaseDomSubtree(id, frameId),
        reveal: (id, frameId) => this.revealDomNode(id, frameId),
      },
      options: opts,
      onChange,
      onResync,
      abort,
    });

    // A stream that dies before it is acknowledged would leave the wait below
    // hanging, so race the two outcomes.
    const ended = mirror.wait().then(() => {
      throw new BrowserScaleError(
        "browserscale.mirrorDom: stream closed before the subscription was established",
      );
    });
    ended.catch(() => {});
    await Promise.race([ready, ended]);

    // Snapshot only now: taken before the subscription exists, changes between
    // the two would be lost with nothing to indicate it.
    try {
      mirror.install(await this.startDomMirror(opts));
    } catch (err) {
      abort.abort();
      throw err;
    }
    onChange(mirror);
    return mirror;
  }

  /**
   * Starts (or restarts) the page's mirror and returns the main document,
   * without subscribing to changes. {@link Page.mirrorDom} is what you
   * normally want; this is the raw command.
   *
   * @throws mirror_failed - the page could not be serialized, usually a document
   *   that went away while the tree was being built. No mirror is left running
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async startDomMirror(opts: DomMirrorOptions = {}): Promise<DomSnapshot> {
    const req = create(StartDomMirrorRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
    });
    if (opts.depth !== undefined) req.depth = opts.depth;
    if (opts.pierce !== undefined) req.pierce = opts.pierce;
    const resp = await this.client.startDomMirror(req);
    throwCommandError("startDomMirror", resp.error);
    return {
      root: resp.root,
      frameId: resp.frameId,
      seq: Number(resp.seq),
    };
  }

  /** Stops the page's mirror, every frame of it. Idempotent. */
  async stopDomMirror(): Promise<void> {
    const res = await this.client.stopDomMirror(
      create(StopDomMirrorRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("stopDomMirror", res.error);
  }

  /**
   * Fetches a node's children and starts reporting changes inside them.
   * {@link DomMirror.expand} calls this and folds the result into the tree.
   *
   * On an `<iframe>` the one child is the document it hosts, and this call is
   * what starts mirroring that frame.
   *
   * An id that is simply unknown is not a failure: the call resolves with an
   * empty result.
   *
   * @throws not_mirrored - the page has no mirror, or frameId is not part of the
   *   one it has; start a mirror first, and after a resync fetch the current tree
   *   before addressing nodes again
   * @throws mirror_failed - the subtree could not be serialized, usually a
   *   document that went away mid-read
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async getDomChildren(
    backendNodeId: number,
    frameId: string = "",
    depth?: number,
  ): Promise<{ children: string; seq: number }> {
    const req = create(GetDomChildrenRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      backendNodeId,
    });
    if (frameId) req.frameId = frameId;
    if (depth !== undefined) req.depth = depth;
    const resp = await this.client.getDomChildren(req);
    throwCommandError("getDomChildren", resp.error);
    return { children: resp.children, seq: Number(resp.seq) };
  }

  /**
   * Stops reporting changes inside a node, and inside any frame below it.
   * {@link DomMirror.collapse} calls this.
   *
   * @throws not_mirrored - the page has no mirror, or frameId is not part of
   *   the one it has; this is what replaying ids from a tree that has since
   *   been resynced looks like, so fetch the current tree and address the node
   *   again
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async releaseDomSubtree(backendNodeId: number, frameId: string = ""): Promise<void> {
    const req = create(ReleaseDomSubtreeRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      backendNodeId,
    });
    if (frameId) req.frameId = frameId;
    const res = await this.client.releaseDomSubtree(req);
    throwCommandError("releaseDomSubtree", res.error);
  }

  /**
   * Returns the chain from the main document down to a node, each ancestor
   * with its own children, crossing into frames where it has to and starting
   * the ones it passes through. {@link DomMirror.reveal} calls this and
   * splices it in.
   *
   * An id that is simply unknown is not a failure: the call resolves with an
   * empty result.
   *
   * @throws not_mirrored - the page has no mirror, or frameId is not part of the
   *   one it has
   * @throws mirror_failed - the path could not be serialized, usually a document
   *   that went away mid-read
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async revealDomNode(
    backendNodeId: number,
    frameId: string = "",
  ): Promise<{ path: string; seq: number }> {
    const req = create(RevealDomNodeRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      backendNodeId,
    });
    if (frameId) req.frameId = frameId;
    const resp = await this.client.revealDomNode(req);
    throwCommandError("revealDomNode", resp.error);
    return { path: resp.path, seq: Number(resp.seq) };
  }

  /**
   * A frame's mutation counter, incremented on every change the document sees.
   * O(1) in the browser and the change detector to poll if you are not
   * consuming mirror events.
   *
   * Prefer this over {@link Page.getDOMHash}, which serializes the
   * whole tree just to hash it. The two answer different questions: a hash
   * compares content, a revision only says whether this document moved since
   * you last asked.
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   */
  async getDomRevision(frameId: string = ""): Promise<number> {
    const req = create(GetDomRevisionRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
    });
    if (frameId) req.frameId = frameId;
    const resp = await this.client.getDomRevision(req);
    throwCommandError("getDomRevision", resp.error);
    return Number(resp.revision);
  }

  // ──────────────────────────────────────────────────────────────────
  // Devtools / live-UI helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Hit-tests at the viewport-relative (x, y) and returns the topmost
   * element under that point.
   *
   * Mirrors what the live-UI overlay does on hover. Elements with
   * pointer-events:none are skipped — the result is the actual click
   * target, not the visually-topmost node. A `backendNodeId === 0` in
   * the result means nothing was found.
   *
   * @param x - viewport-relative x in CSS pixels
   * @param y - viewport-relative y in CSS pixels
   *
   * @returns InspectResult with the resolved backendNodeId, frameId, tag
   *   name, trimmed textContent, visibility and bounds
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const r = await page.inspectAtPosition(200, 300);
   * console.log(r.tagName, r.textContent);
   */
  async inspectAtPosition(x: number, y: number): Promise<InspectResult> {
    const resp = await this.client.inspectAtPosition(
      create(InspectAtPositionRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
        x,
        y,
      }),
    );
    throwCommandError("inspectAtPosition", resp.error);
    return {
      backendNodeId: resp.backendNodeId,
      frameId: resp.frameId,
      tagName: resp.tagName,
      textContent: resp.textContent,
      isVisible: resp.isVisible,
      bounds: rectFromProto(resp.bounds),
    };
  }

  /**
   * Paints a debug overlay over the node identified by backendNodeId.
   *
   * Useful for visual debugging of agent flows — the overlay stays until
   * the next call. Pass backendNodeId <= 0 to clear any current highlights.
   *
   * @param backendNodeId - id of the node to highlight, or <= 0 to clear
   * @param frameId - id of the frame the node lives in; empty string
   *   targets the main frame
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await page.highlightNode(res.backendNodeId, res.frameId);
   */
  async highlightNode(backendNodeId: number, frameId: string = ""): Promise<void> {
    const req = create(HighlightNodeRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      backendNodeId,
    });
    if (frameId) req.frameId = frameId;
    const res = await this.client.highlightNode(req);
    throwCommandError("highlight", res.error);
  }

  /**
   * Pastes text at the current caret using IME-style input.
   *
   * No individual key events are dispatched; the entire string is
   * committed at once via Input.insertText. Whatever element currently has
   * focus receives the text. Use {@link click} or {@link fill} first if
   * you need a specific element to be focused.
   *
   * @param text - the text to insert at the caret
   *
   * @throws no_focus - nothing in the page holds focus, so there is no caret to
   *   insert at; click the field first
   * @throws busy - another action or a captcha solve is running on this page
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * await page.insertText("hello world");
   */
  async insertText(text: string): Promise<void> {
    const res = await this.client.insertText(
      create(InsertTextRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
        text,
      }),
    );
    throwCommandError("insertText", res.error);
  }

  /**
   * Types `text` into the currently focused element as a per-key stream of real
   * keyboard events (keyDown/char/keyUp with the context's QWERTZ/QWERTY layout
   * and human cadence) — unlike {@link insertText}, a single IME-style commit
   * with no key events.
   *
   * `type` is intentionally UNtargeted and loose: it does not locate or focus
   * any element and does NOT pin focus, so the page is free to route keys and
   * move focus between fields mid-stream — ideal for one-time-code / OTP inputs
   * that auto-advance to the next box on each digit. To type one specific field
   * that must stay focused for the whole value, use {@link fill} instead
   * (strict, target-bound, per-key focus-verified).
   *
   * Nothing is focused for you: {@link click} (or {@link fill}) the field first,
   * or otherwise ensure focus, before calling `type`.
   *
   * @param text - the text to type as real key events
   * @param opts - optional: `clearFirst` clears the focused field (Ctrl+A,
   *   Delete) before typing
   *
   * With captcha auto-solve on ({@link CloudBrowser.enableCaptchaAutoSolve}),
   * a captcha that appears mid-stream holds `type` between two keys until it
   * is solved; then the rest of the text is typed.
   *
   * @throws captcha_failed - that captcha was not solved, with auto-solve set
   *   to `onFailure: "fail"`
   *
   * Otherwise `type` has no semantic failure of its own: the keys land wherever
   * focus happens to be, so there is no target it can miss. Only the page or
   * context being torn down mid-stream surfaces, and that is a transport
   * failure rather than a code.
   *
   * @example
   * // OTP field that auto-advances across boxes.
   * await page.click(css("input.otp-0"));
   * await page.type("123456");
   */
  async type(text: string, opts?: { clearFirst?: boolean }): Promise<void> {
    const req = create(TypeRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      text,
    });
    if (opts?.clearFirst) req.clearFirst = true;
    throwCommandError("type", (await this.client.type(req)).error);
  }

  /**
   * Fires a single key-down event.
   *
   * Only the keydown half is dispatched — pair with {@link releaseKey} for
   * a full press cycle. The event targets whichever element currently has
   * focus.
   *
   * @param key - DOM KeyboardEvent.key value (e.g. `"Enter"`, `"a"`, `"ArrowLeft"`)
   * @param opts - optional key customization:
   *   `code` (DOM KeyboardEvent.code, e.g. `"KeyA"`),
   *   `modifiers` (bit-flag: Alt=1, Ctrl=2, Meta=4, Shift=8),
   *   `location` (0=standard, 1=left, 2=right, 3=numpad)
   *
   * @throws no_focus - nothing in the page holds focus, so the key has nowhere
   *   to go; click the field first
   * @throws busy - another action or a captcha solve is running on this page
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * // Ctrl+A
   * await page.pressKey("a", { code: "KeyA", modifiers: 2 });
   * await page.releaseKey("a", { code: "KeyA", modifiers: 2 });
   */
  async pressKey(
    key: string,
    opts?: { code?: string; modifiers?: number; location?: number },
  ): Promise<void> {
    const req = create(PressKeyRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      key,
    });
    if (opts?.code) req.code = opts.code;
    if (opts?.modifiers !== undefined) req.modifiers = opts.modifiers;
    if (opts?.location !== undefined) req.location = opts.location;
    const res = await this.client.pressKey(req);
    throwCommandError("pressKey", res.error);
  }

  /**
   * Fires a single key-up event.
   *
   * Mirror of {@link pressKey}. Same parameter semantics; use this to
   * close a press cycle that was started with pressKey.
   *
   * @inheritDoc CloudBrowser.pressKey
   *
   * @example
   * await page.pressKey("Shift", { code: "ShiftLeft", location: 1 });
   * await page.releaseKey("Shift", { code: "ShiftLeft", location: 1 });
   */
  async releaseKey(
    key: string,
    opts?: { code?: string; modifiers?: number; location?: number },
  ): Promise<void> {
    const req = create(ReleaseKeyRequestSchema, {
      sessionId: this.sessionId,
      pageId: this.id,
      apiKey: this.apiKey,
      key,
    });
    if (opts?.code) req.code = opts.code;
    if (opts?.modifiers !== undefined) req.modifiers = opts.modifiers;
    if (opts?.location !== undefined) req.location = opts.location;
    const res = await this.client.releaseKey(req);
    throwCommandError("releaseKey", res.error);
  }

  /**
   * Returns the current text selection.
   *
   * Walks every frame and returns the first non-empty selection found —
   * useful for "copy what the user highlighted" flows. Returns an empty
   * string when nothing is selected anywhere.
   *
   * @returns the selected text, or `""` when nothing is selected
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const sel = await page.getSelection();
   * console.log("user selected:", sel);
   */
  async getSelection(): Promise<string> {
    const resp = await this.client.getSelection(
      create(GetSelectionRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("getSelection", resp.error);
    return resp.text;
  }

  // ──────────────────────────────────────────────────────────────────
  // Captcha solver
  // ──────────────────────────────────────────────────────────────────

  /**
   * Detects and solves the first supported bot-challenge it finds
   * anywhere on the page.
   *
   * Detection covers the common challenge types you run into in the
   * wild. The challenge is detected and solved in the live browser
   * session — no page scripting, no external service — and the result
   * is wired back into the page automatically, so callers can ignore
   * the returned string.
   *
   * @param opts - optional `timeoutMs` (how long to wait for a captcha to
   *   appear; omit for server default 60s) and `retryAmount` (failures
   *   tolerated before giving up)
   *
   * @returns empty string on success — the solution is applied for you
   *
   * If auto-solve ({@link CloudBrowser.enableCaptchaAutoSolve}) is already
   * solving a captcha on this page, the call waits for that solve and returns
   * its outcome instead of starting a second one. A solve this call starts is
   * reported on {@link CloudBrowser.contextEvents} with trigger `"command"`.
   *
   * Rejects when no captcha appeared within `timeoutMs`, or when the one
   * that did could not be solved within `retryAmount` attempts. Neither
   * carries a code: solving runs outside your code, so there is no
   * per-command code set here.
   *
   * @example
   * await page.solveCaptcha({ retryAmount: 2 });
   */
  async solveCaptcha(opts?: { timeoutMs?: number; retryAmount?: number }): Promise<string> {
    const resp = await this.client.solveCaptcha(
      create(SolveCaptchaRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
        timeoutMs: opts?.timeoutMs ?? 0,
        retryAmount: opts?.retryAmount ?? 0,
      }),
    );
    return resp.result;
  }

  // ──────────────────────────────────────────────────────────────────
  // Reactions
  // ──────────────────────────────────────────────────────────────────

  /**
   * Registers a one-shot "reaction": the browser watches for the `match`
   * locator in the background and, as soon as it matches, clicks it the same
   * way {@link Page.click} does (scroll, human path, occlusion check) —
   * then removes itself. When it fires, the input action you are running
   * pauses at a safe point (a click before it presses, a fill between two
   * keys), the reaction clicks, and the action carries on within its own
   * timeout — e.g. it dismisses a newsletter modal blocking a
   * {@link Page.click}, and the click then lands. A captcha solve takes the
   * page first, a button held down by a press-only click keeps reactions out
   * until its release, and a reaction waits for its page to have the focus.
   * A reaction added here belongs to this page and is torn down automatically
   * when the page/session ends; use {@link CloudBrowser.addReaction} for one
   * that covers every page. Each click is reported as a `reactionFired`
   * event on {@link CloudBrowser.contextEvents}.
   *
   * `match` must be a `css()` or `js()` {@link Locator} — `node()`/`at()` are
   * rejected. Use `.inAllFrames()` to watch every frame and `.visible(false)`
   * to opt out of the default visibility gate. Pass a `ReactionOpts` to click a
   * different target (`on`), change the button/click count, or the poll cadence.
   *
   * @param match - the css()/js() locator to watch for
   * @param opts - optional reaction customization; see {@link ReactionOpts}
   *
   * @returns the reactionId (pass to {@link Page.removeReaction})
   *
   * @throws {@link BrowserScaleError} - `match` (or `opts.on`) is not a css()/js()
   *   locator, or a server/transport error
   *
   * @example
   * // Auto-dismiss a consent button whenever it appears, in any frame.
   * const id = await page.addReaction(css("button#accept").inAllFrames());
   *
   * @example
   * // Watch for a newsletter modal, but click its close "X" instead.
   * const id = await page.addReaction(css("#newsletter-modal"), {
   *   on: css(".modal-close"),
   * });
   */
  async addReaction(match: Locator, opts?: ReactionOpts): Promise<string> {
    return addReaction(this.reactionScope(), match, opts);
  }

  /**
   * Removes a pending reaction by id. Returns `false` if the reaction had
   * already fired (one-shot) or was never registered. An id from
   * {@link CloudBrowser.addReaction} is removed from every page; it is the
   * same call as {@link CloudBrowser.removeReaction}.
   *
   * @param reactionId - id returned by {@link Page.addReaction}
   *
   * @returns true if a pending reaction with this id existed and was removed
   *
   * Removing an id that is not registered is a no-op rather than an error, so the
   * returned boolean - not a rejection - is what tells you whether anything was
   * there. Rejects only on a transport failure.
   *
   * @example
   * const removed = await page.removeReaction(id);
   */
  async removeReaction(reactionId: string): Promise<boolean> {
    return removeReaction(this.reactionScope(), reactionId);
  }

  /**
   * Returns the reactions still pending on the page, including those from
   * {@link CloudBrowser.addReaction} that have not fired here yet
   * (`allPages` is set on those). Reactions that have already fired on this
   * page are not included.
   *
   * @returns the pending reactions for the page
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const pending = await page.listReactions();
   * for (const r of pending) console.log(r.reactionId, r.matchSelector);
   */
  async listReactions(): Promise<ReactionInfo[]> {
    return listReactions(this.reactionScope());
  }

  private reactionScope(): ReactionScope {
    return { client: this.client, sessionId: this.sessionId, apiKey: this.apiKey, pageId: this.id };
  }

  // ──────────────────────────────────────────────────────────────────
  // Scripts
  // ──────────────────────────────────────────────────────────────────

  /**
   * Runs `source` on the page and waits for it to finish.
   *
   * The script runs beside the browser, in a V8 isolate of its own rather than
   * in the page, and reaches the document through the engine: a cross-origin
   * `<iframe>` is read as plain `contentDocument` with no frame ids anywhere,
   * values come back as live objects it can assign to rather than snapshots, an
   * element can be handed straight to `browser.click`, and the page sees nothing
   * injected. Steps cost microseconds rather than network round trips, so work
   * that is chatty by nature — polling for a selector, walking a list,
   * following pagination — is affordable there. A guide for it is still to come.
   *
   * This waits for as long as the script runs, and cannot be bounded: the run
   * id needed to cancel only arrives with the reply. Use
   * {@link Page.startScript} when the script may outlive the caller's
   * patience, or {@link Page.stopScripts} to abandon what is running
   * on the page.
   *
   * @param source - JavaScript to execute; its return value comes back as JSON
   *
   * @returns the return value and the script's whole console output. A script
   *   that threw is reported as `success: false`, not as a rejection
   *
   * Rejects only on a transport failure. A script that fails to compile or throws
   * is not a rejection: the returned result has success: false and 
esult holds
   * the message, so a broken script stays distinguishable from a broken connection.
   *
   * @example
   * const result = await page.runScript(`
   *   await page.navigate("https://example.com");
   *   const items = [];
   *   for (const el of await page.getDOM().querySelectorAll("h1")) {
   *     items.push(el.textContent);
   *   }
   *   return items;
   * `);
   * console.log(result.success, result.result);
   */
  async runScript(source: string): Promise<ScriptResult> {
    const resp = await this.client.runScript(
      create(RunScriptRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
        source,
      }),
    );
    return {
      success: resp.success,
      result: resp.result,
      runId: resp.runId,
      log: resp.log.map(scriptLogEntryFromProto),
      truncated: resp.truncated,
    };
  }

  /**
   * Launches `source` on the page and resolves as soon as the run
   * is under way.
   *
   * The counterpart to {@link Page.runScript}, for scripts that are not
   * worth waiting on: a watcher that runs for the life of the session, work
   * that should survive this page. Output arrives at `onEvent` while the caller
   * gets on with something else, and {@link ScriptRun.wait} collects the
   * outcome if it is wanted.
   *
   * Subscribing has to happen before the launch, because a detached run's
   * output is not kept anywhere — the browser rejects a start with nobody
   * listening rather than discard the script's log and result. This call does
   * both in that order, so nothing the script prints is missed.
   *
   * @param source - JavaScript to execute
   * @param onEvent - called per log line and once for the outcome; see
   *   {@link ScriptEventHandler} for the ordering and blocking rules
   *
   * @returns ScriptRun handle for awaiting or cancelling the run
   *
   * Rejects only on a transport failure: a script that fails to compile or throws
   * surfaces on the run itself rather than here.
   *
   * @example
   * const run = await page.startScript(source, (ev) => {
   *   if (ev.log) console.log(ev.log.level, ev.log.message);
   * });
   * const outcome = await run.wait();
   */
  async startScript(source: string, onEvent: ScriptEventHandler): Promise<ScriptRun> {
    // Subscribe unfiltered: the run id this handle filters on does not exist
    // yet. Events for it pile up in the server's per-reader buffer between the
    // subscription and the launch, which is what that buffer is for.
    const abort = new AbortController();
    let subscribed!: () => void;
    const ready = new Promise<void>((resolve) => {
      subscribed = resolve;
    });

    const stream = this.client.streamScriptEvents(
      create(StreamScriptEventsRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
      }),
      { signal: abort.signal, onHeader: () => subscribed() },
    );

    // Opening a stream does not wait for the server to start handling it. For a
    // capture that would only cost the first few events; here it would fail the
    // launch outright, since the browser refuses to start a run before a
    // subscription exists. The headers arrive once it is subscribed.
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();
    // A stream that fails or closes before it is acknowledged would leave the
    // wait below hanging, so race the two outcomes. An event arriving ahead of
    // the headers is not a failure — it proves the subscription exists.
    const ended = first.then((result) => {
      if (result.done) {
        throw new BrowserScaleError(
          "browserscale.startScript: stream closed before the subscription was established",
        );
      }
    });
    ended.catch(() => {}); // the loser of the race must not look unhandled
    try {
      await Promise.race([ready, ended]);
    } catch (err) {
      abort.abort();
      throw err;
    }

    let runId: string;
    try {
      const resp = await this.client.startScript(
        create(StartScriptRequestSchema, {
          sessionId: this.sessionId,
          pageId: this.id,
          apiKey: this.apiKey,
          source,
        }),
      );
      runId = resp.runId;
    } catch (err) {
      abort.abort();
      throw err;
    }

    // Resume from the pending read rather than iterating the stream again: the
    // first next() is already in flight and its value would otherwise be lost.
    const resumed = resumeStream(iterator, first);

    return new ScriptRun({
      runId,
      stream: resumed,
      onEvent,
      abort,
      cancel: (id) => this.stopScripts(id),
    });
  }

  /**
   * Watches script output on the page without starting anything.
   *
   * For the case {@link Page.startScript} cannot cover: a run somebody
   * else launched, or one this app started before it reloaded. Several readers
   * can watch the same page, each with its own buffer.
   *
   * Only output produced from now on arrives — lines printed before the
   * subscription existed are not kept. A run that has already finished is
   * therefore invisible here; {@link Page.listScriptRuns} is how you
   * tell that apart from a run that is merely quiet.
   *
   * @param runId - run to follow, or `""` to follow every run on the page
   * @param onEvent - called per event; see {@link ScriptEventHandler} for the
   *   ordering and blocking rules
   *
   * @returns ScriptFollow handle for stopping the subscription
   *
   * Rejects only on a transport failure: opening the subscription has no semantic
   * failure of its own.
   *
   * @example
   * const follow = await page.followScript(runId, (ev) => {
   *   if (ev.log) console.log(ev.log.message);
   * });
   * try {
   *   await follow.wait();
   * } finally {
   *   await follow.stop();
   * }
   */
  async followScript(runId: string, onEvent: ScriptEventHandler): Promise<ScriptFollow> {
    const abort = new AbortController();
    const stream = this.client.streamScriptEvents(
      create(StreamScriptEventsRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
        runId,
      }),
      { signal: abort.signal },
    );
    return new ScriptFollow({ stream, onEvent, abort });
  }

  /**
   * Cancels runs on the page and reports how many it ended.
   *
   * An empty `runId` cancels every run on the page, which is the only form
   * available to a caller that never learned an id — notably one abandoning a
   * {@link Page.runScript}.
   *
   * @param runId - run to cancel, or `""` for all of them
   *
   * @returns how many runs were cancelled; 0 when the id named nothing in
   *   flight
   *
   * Rejects only on a transport failure. Cancelling runs that have already
   * finished, or none at all, is a no-op - read the returned count to learn how
   * many were actually stopped.
   *
   * @example
   * await page.stopScripts(""); // abandon everything running
   */
  async stopScripts(runId: string): Promise<number> {
    const resp = await this.client.stopScripts(
      create(StopScriptsRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
        runId,
      }),
    );
    return resp.stopped;
  }

  /**
   * Reports the scripts still running on the page.
   *
   * Only runs in flight — a finished run is reported once on the event stream
   * and then forgotten, so this is not a history. Its use is finding work this
   * caller did not start: a script a previous page left behind, which
   * {@link Page.stopScripts} needs an id to name.
   *
   * @returns one entry per run still executing
   *
   * Rejects only on a transport failure - a dead session, a broken connection.
   * This call has no semantic failure of its own, so there are no error codes to
   * branch on.
   *
   * @example
   * for (const run of await page.listScriptRuns()) {
   *   console.log(run.runId, run.runningMs);
   * }
   */
  async listScriptRuns(): Promise<ScriptRunInfo[]> {
    const resp = await this.client.listScriptRuns(
      create(ListScriptRunsRequestSchema, {
        sessionId: this.sessionId,
        pageId: this.id,
        apiKey: this.apiKey,
      }),
    );
    return resp.runs.map((run) => ({
      runId: run.runId,
      runningMs: Number(run.runningMs),
    }));
  }
}


/**
 * Continues an async iterator whose first read is already in flight.
 *
 * startScript has to know the subscription exists before it launches anything,
 * and the only way to make the client send the request is to start reading. That
 * read cannot be discarded — it may already hold the run's first log line — so
 * the reader is handed a stream that replays it before continuing.
 */
async function* resumeStream<T>(
  iterator: AsyncIterator<T>,
  first: Promise<IteratorResult<T>>,
): AsyncGenerator<T> {
  let result = await first;
  while (!result.done) {
    yield result.value;
    result = await iterator.next();
  }
}
