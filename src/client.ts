import type { Client, Transport } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  Browser,
  // request / response schemas
  SetProxyRequestSchema,
  GetPagesRequestSchema,
  NavigateRequestSchema,
  LoadHTMLRequestSchema,
  EvaluateRequestSchema,
  WaitForAnyParamsSchema,
  WaitConditionSchema,
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
  SetBlockListRequestSchema,
  SetStaticPathsRequestSchema,
  WaitForAnyRequestRequestSchema,
  WaitForAnyResponseRequestSchema,
  ModifyRequestRequestSchema,
  GetCookiesRequestSchema,
  SetCookiesRequestSchema,
  ClearCookiesRequestSchema,
  GetStorageRequestSchema,
  SetStorageRequestSchema,
  ClearStorageRequestSchema,
  GetAuthSessionRequestSchema,
  SetAuthSessionRequestSchema,
  InspectAtPositionRequestSchema,
  HighlightNodeRequestSchema,
  InsertTextRequestSchema,
  TypeRequestSchema,
  PressKeyRequestSchema,
  ReleaseKeyRequestSchema,
  GetSelectionRequestSchema,
  SolveCaptchaRequestSchema,
  GetStreamConfigRequestSchema,
  StartStreamRequestSchema,
  StopStreamRequestSchema,
  AddReactionRequestSchema,
  RemoveReactionRequestSchema,
  ListReactionsRequestSchema,
  StartNetworkCaptureRequestSchema,
  StopNetworkCaptureRequestSchema,
  StartDomMirrorRequestSchema,
  StopDomMirrorRequestSchema,
  GetDomChildrenRequestSchema,
  ReleaseDomSubtreeRequestSchema,
  RevealDomNodeRequestSchema,
  GetDomRevisionRequestSchema,
  StreamDomEventsRequestSchema,
  StreamNetworkExchangesRequestSchema,
  RunScriptRequestSchema,
  StartScriptRequestSchema,
  StopScriptsRequestSchema,
  ListScriptRunsRequestSchema,
  StreamScriptEventsRequestSchema,
} from "./gen/wrc_pb.ts";
import type { Locator } from "./locator.ts";
import { BrowserScaleError, CommandError, throwCommandError } from "./errors.ts";
import type {
  DOMResult,
  DragResult,
  ElementResult,
  EvaluateResult,
  InterceptedRequest,
  InterceptedResponse,
  InspectResult,
  NavigateResult,
  NetworkCaptureOptions,
  PageInfo,
  ScreenshotResult,
  ReadCanvasResult,
  SelectOptionResult,
  WaitResult,
  IceServer,
  StreamAnswer,
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
import type { HeaderModification, RequestPattern } from "./network.ts";
import { NetworkCapture, type NetworkExchangeHandler } from "./network-capture.ts";
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
import type { CookieParam } from "./cookies.ts";
import type { StorageOriginEntry } from "./storage.ts";
import type { AuthSession } from "./auth-session.ts";
import {
  authSessionFromProto,
  authSessionToProto,
  cookieParamFromProto,
  cookieParamsToProto,
  elementFields,
  headerModsToProto,
  headersToProto,
  interceptedRequestFromProto,
  interceptedResponseFromProto,
  pageInfoFromProto,
  rectFromProto,
  splitRequestPatterns,
  storageEntriesToProto,
  storageEntryFromProto,
  unwrapClick,
  unwrapDrag,
  unwrapFill,
  unwrapMove,
  unwrapScroll,
  unwrapSelect,
  unwrapWait,
} from "./internal/convert.ts";

type BrowserRpcClient = Client<typeof Browser>;

/**
 * CloudBrowser is the SDK-side handle for an active browserscale browser session.
 *
 * One CloudBrowser corresponds to exactly one browser context, which
 * always has at least one page; its commands act on the primary page.
 *
 * Construct via rentBrowser() / createWebSocketBrowser() — never
 * directly.
 */
export class CloudBrowser {
  private readonly client: BrowserRpcClient;
  private readonly sessionId: string;
  private readonly apiKey: string;
  private readonly _transport: Transport;
  private readonly _fingerprint: string;
  private readonly _stopFn?: () => Promise<void>;

  constructor(
    transport: Transport,
    sessionId: string,
    apiKey: string,
    fingerprint: string,
    stopFn?: () => Promise<void>,
  ) {
    this._transport = transport;
    this.sessionId = sessionId;
    this.apiKey = apiKey;
    this._fingerprint = fingerprint;
    this.client = createClient(Browser, transport);
    this._stopFn = stopFn;
  }

  // ──────────────────────────────────────────────────────────────────
  // Lifecycle / metadata
  // ──────────────────────────────────────────────────────────────────

  /** Returns the unique server-assigned id for this browser session. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Returns the API key used to rent this session. */
  getApiKey(): string {
    return this.apiKey;
  }

  /** Returns the browser fingerprint id in use for this session. */
  getFingerprint(): string {
    return this._fingerprint;
  }

  /**
   * Releases the session and closes the underlying transport.
   *
   * For sessions created via {@link rentBrowser} this also calls the browserscale
   * stop endpoint to release the rental. For sessions attached with
   * {@link createWebSocketBrowser} the rental stays untouched; only the
   * transport is closed.
   *
   * Rejects only when the stop API or the transport close fails. The session is
   * released either way; retrying a stop is safe.
   *
   * @example
   * await browser.stopBrowser();
   */
  async stopBrowser(): Promise<void> {
    if (this._stopFn) {
      await this._stopFn();
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Context-level
  // ──────────────────────────────────────────────────────────────────

  /**
   * Changes the runtime proxy for this session.
   *
   * Takes effect for new requests immediately; in-flight requests keep
   * their original routing. Pass an empty proxyHost to clear the proxy and
   * route directly.
   *
   * @param proxyHost - upstream proxy host; empty disables the proxy
   * @param proxyPort - upstream proxy port; ignored when proxyHost is empty
   * @param proxyUsername - proxy auth user; empty for unauthenticated proxies
   * @param proxyPassword - proxy auth password; empty for unauthenticated proxies
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await browser.setProxy("proxy.example.com", 8080, "user", "pass");
   */
  async setProxy(
    proxyHost: string,
    proxyPort: number,
    proxyUsername: string = "",
    proxyPassword: string = "",
  ): Promise<void> {
    const req = create(SetProxyRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
    });
    if (proxyHost) {
      req.proxyHost = proxyHost;
      req.proxyPort = proxyPort;
      if (proxyUsername) req.proxyUsername = proxyUsername;
      if (proxyPassword) req.proxyPassword = proxyPassword;
    }
    const res = await this.client.setProxy(req);
    throwCommandError("setProxy", res.error);
  }

  /**
   * Returns all open pages (tabs and popups) for this session's browser
   * context.
   *
   * Each PageInfo carries the page's URL, title, viewport and a full
   * nested frame tree (out-of-process iframes are children of the page's
   * main frame).
   *
   * @returns PageInfo[] for every page currently open in the context
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const pages = await browser.getPages();
   * for (const p of pages) console.log(p.url, p.title);
   */
  async getPages(): Promise<PageInfo[]> {
    const resp = await this.client.getPages(
      create(GetPagesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("getPages", resp.error);
    return resp.pages.map(pageInfoFromProto);
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
   * await browser.navigate("https://example.com");
   */
  async navigate(url: string, opts?: NavigateOpts): Promise<NavigateResult> {
    const req = create(NavigateRequestSchema, {
      sessionId: this.sessionId,
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
   * await browser.loadHTML("https://example.com", "<h1>hi</h1>");
   * await browser.navigate("https://example.com");
   */
  async loadHTML(url: string, html: string, opts?: LoadHTMLOpts): Promise<void> {
    const req = create(LoadHTMLRequestSchema, {
      sessionId: this.sessionId,
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
   * of-process iframes) found via {@link getPages}. ALL_FRAMES is not
   * supported here.
   *
   * @inheritDoc CloudBrowser.evaluate
   * @param frameId - id of the frame to evaluate in
   *
   * @example
   * const pages = await browser.getPages();
   * const iframeId = pages[0].frameTree.children[0].frameId;
   * await browser.evaluateInFrame(iframeId, "location.href");
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
   * Blocks until the given locator matches.
   *
   * Shortcut for `waitAny([condition], opts)`. See {@link waitAny} for
   * timeout handling, per-locator visible/steady defaults and the list of
   * locators that are not valid wait conditions.
   *
   * @inheritDoc CloudBrowser.waitAny
   * @param condition - the single locator to wait for
   *
   * @example
   * await browser.wait(css(".success"));
   */
  async wait(condition: Locator, opts?: WaitOpts): Promise<WaitResult> {
    return this.waitAny([condition], opts);
  }

  /**
   * Blocks until any of the supplied locators matches.
   *
   * When several conditions are supplied, the first one to match wins;
   * the others are abandoned. The returned WaitResult's `.index` points
   * to the entry in `conditions` that matched.
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
   * @param conditions - one or more {@link Locator}s to wait for; must be non-empty
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
   * const r = await browser.waitAny(
   *   [css(".success"), js("window.__ready === true")],
   *   { timeoutMs: 5000 },
   * );
   * console.log("matched index:", r.index);
   */
  async waitAny(conditions: Locator[], opts?: WaitOpts): Promise<WaitResult> {
    if (conditions.length === 0) {
      throw new BrowserScaleError("browserscale.waitAny: at least one condition required");
    }
    const pbConds = conditions.map((cond, i) => {
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

    // Call-level frameId: take from first condition that has one (Wait
    // doesn't accept a separate frame override yet — mirrors Go wait.go).
    let frameId = "";
    for (const c of conditions) {
      if (c.frameId) {
        frameId = c.frameId;
        break;
      }
    }

    const req = create(WaitForAnyParamsSchema, {
      sessionId: this.sessionId,
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
   *   `.result` describe the blocker and the resolved coordinates
   * @throws {@link BrowserScaleError} - invalid locator, or a server/transport
   *   error (element not found, frame not found, timeout, page closed)
   *
   * @example
   * try {
   *   await browser.click(css("button.submit"));
   * } catch (e) {
   *   if (e instanceof ClickError) console.log(e.code, e.occluder?.tagName);
   * }
   *
   * @example
   * // Right double-click on a context menu trigger.
   * await browser.click(css("li.menu"), { button: "right", clickCount: 2 });
   */
  async click(target: Locator, opts?: ClickOpts): Promise<ElementResult> {
    target.validateTarget("click", true);
    const req = create(ClickRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
      ...elementFields(target, opts?.inFrame),
    });
    if (opts?.button) req.button = opts.button;
    if (opts?.clickCount) req.clickCount = opts.clickCount;
    if (opts?.action) req.action = opts.action;
    return unwrapClick(await this.client.click(req));
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
   *   and `.clickError` (the underlying click-core failure) describe why
   * @throws {@link BrowserScaleError} - invalid locator, or a server/transport
   *   error (element not found, frame not found, timeout, page closed)
   *
   * @example
   * await browser.fill(css("input[name=email]"), "user@example.com");
   *
   * @example
   * // Wipe the field first, then type fresh content.
   * await browser.fill(css("input[name=email]"), "user@example.com", { clearFirst: true });
   */
  async fill(target: Locator, text: string, opts?: FillOpts): Promise<ElementResult> {
    target.validateTarget("fill", false);
    const req = create(FillRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
      text,
      ...elementFields(target, opts?.inFrame),
    });
    if (opts?.clearFirst) req.clearFirst = true;
    if (opts?.timeoutMs !== undefined) req.timeout = opts.timeoutMs;
    if (opts?.steadyMs !== undefined) req.steadyTime = opts.steadyMs;
    return unwrapFill(await this.client.fill(req));
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
   * await browser.moveTo(css("nav .menu"));
   */
  async moveTo(target: Locator): Promise<ElementResult> {
    target.validateTarget("moveTo", true);
    const req = create(MoveToRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
      ...elementFields(target),
    });
    return unwrapMove(await this.client.moveTo(req));
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
   * await browser.scrollTo(css("#footer"));
   */
  async scrollTo(target: Locator): Promise<ElementResult> {
    target.validateTarget("scrollTo", false);
    const req = create(ScrollToRequestSchema, {
      sessionId: this.sessionId,
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
   *   `.code` and `.clickError` describe the underlying click-core failure
   * @throws {@link BrowserScaleError} - invalid locator or a server/transport error
   *
   * @example
   * await browser.dragBy(css(".slider .handle"), 120, 0);
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
   *   `.code` and `.clickError` describe the underlying click-core failure
   * @throws {@link BrowserScaleError} - invalid locator or a server/transport error
   *
   * @example
   * await browser.dragTo(css(".card"), 800, 400);
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
      apiKey: this.apiKey,
      ...elementFields(target),
    });
    if (spec.offsetX !== undefined) req.offsetX = spec.offsetX;
    if (spec.offsetY !== undefined) req.offsetY = spec.offsetY;
    if (spec.absoluteX !== undefined) req.absoluteX = spec.absoluteX;
    if (spec.absoluteY !== undefined) req.absoluteY = spec.absoluteY;
    return unwrapDrag(await this.client.drag(req));
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
   * await browser.selectByIndex(css("select#country"), 2);
   *
   * @example
   * // Pick the option silently, no input/change events.
   * await browser.selectByIndex(css("select#hidden"), 0, { fireEvents: false });
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
   * @inheritDoc {@link CloudBrowser.selectByIndex}
   * @param value - the `value` attribute to match
   *
   * @example
   * await browser.selectByValue(css("select#country"), "DE");
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
   * @inheritDoc {@link CloudBrowser.selectByIndex}
   * @param text - the visible option text to match
   *
   * @example
   * await browser.selectByText(css("select#country"), "Germany");
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
   * const { dom } = await browser.getDOM();
   */
  async getDOM(frameId: string = "", opts?: GetDOMOpts): Promise<DOMResult> {
    const req = create(GetDOMRequestSchema, {
      sessionId: this.sessionId,
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
   * const hash = await browser.getDOMHash();
   * if (hash !== lastHash) {
   *   // DOM changed → re-fetch
   * }
   */
  async getDOMHash(frameId: string = ""): Promise<string> {
    const req = create(GetDOMHashRequestSchema, {
      sessionId: this.sessionId,
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
   * const obs = await browser.getObservation();
   * console.log(obs);
   */
  async getObservation(opts?: GetObservationOpts): Promise<string> {
    const req = create(GetObservationRequestSchema, {
      sessionId: this.sessionId,
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
   * const shot = await browser.screenshot({ format: "png" });
   * await fs.writeFile("page.png", Buffer.from(shot.dataBase64, "base64"));
   */
  async screenshot(opts?: ScreenshotOpts): Promise<ScreenshotResult> {
    const req = create(ScreenshotRequestSchema, {
      sessionId: this.sessionId,
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
   * const res = await browser.readCanvas(css("#game canvas"));
   * await fs.writeFile("canvas.png", Buffer.from(res.dataBase64, "base64"));
   *
   * @example
   * // Read the left half as JPEG at quality 80.
   * const res = await browser.readCanvas(css("canvas"), {
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
  // Network interception
  // ──────────────────────────────────────────────────────────────────

  /**
   * Replaces the session's URL blocklist.
   *
   * Any request whose URL matches one of the supplied patterns is blocked
   * before it leaves the browser. Patterns are simple URL wildcards (`*`
   * matches any character span). Pass an empty array to clear the
   * blocklist and let everything through.
   *
   * @param patterns - URL wildcards to block; empty array clears the list
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await browser.setBlockList([
   *   "*.doubleclick.net/*",
   *   "*googletagmanager.com*",
   * ]);
   */
  async setBlockList(patterns: string[]): Promise<void> {
    const res = await this.client.setBlockList(
      create(SetBlockListRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        patterns,
      }),
    );
    throwCommandError("setBlockList", res.error);
  }

  /**
   * Configures the session to serve cached static responses for requests
   * matching the given patterns from blobName.
   *
   * Useful for replaying frozen page assets (HTML/JS/CSS/images) without
   * hitting the origin every time. The cache backend itself is configured
   * server-side. Pass an empty patterns array to disable caching for this
   * session.
   *
   * @param blobName - server-side identifier of the snapshot to serve from
   * @param patterns - URL wildcards to redirect to the cache; empty disables
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await browser.setStaticPaths("snap-2026-05", ["*.example.com/*"]);
   */
  async setStaticPaths(blobName: string, patterns: string[]): Promise<void> {
    const res = await this.client.setStaticPaths(
      create(SetStaticPathsRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        blobName,
        patterns,
      }),
    );
    throwCommandError("setStaticPaths", res.error);
  }

  /**
   * Blocks until the next request whose URL matches one of the supplied
   * patterns is observed.
   *
   * Returns the matched pattern's index and the captured request. When
   * `patterns[i].abort` is true the request is dropped with an empty 200
   * response instead of being sent to the network.
   *
   * @param patterns - one or more URL patterns (with optional abort flags)
   * @param opts - optional `timeoutMs`; omit to use the server default
   *
   * @returns object with `index` (matched pattern index) and `request`
   *   (the captured method/URL/headers/body; null if intercepted with
   *   no body)
   *
   * @throws timeout - no request matched any pattern before the deadline.
   *   Nothing occurring is an answer, and it stays distinguishable from a
   *   connection that died on the way. Supplying no patterns is a caller mistake
   *   rather than an outcome, and rejects separately
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * const { index, request } = await browser.waitForAnyRequest(
   *   [{ url: "*\/api/login" }],
   *   { timeoutMs: 5000 },
   * );
   * console.log(index, request?.method, request?.url);
   */
  async waitForAnyRequest(
    patterns: RequestPattern[],
    opts?: { timeoutMs?: number },
  ): Promise<{ index: number; request: InterceptedRequest | null }> {
    if (patterns.length === 0) {
      throw new BrowserScaleError("browserscale.waitForAnyRequest: at least one pattern required");
    }
    const { urls, aborts } = splitRequestPatterns(patterns);
    const req = create(WaitForAnyRequestRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
      patterns: urls,
      abortFlags: aborts,
    });
    if (opts?.timeoutMs) req.timeout = opts.timeoutMs;
    const resp = await this.client.waitForAnyRequest(req);
    throwCommandError("waitForAnyRequest", resp.error);
    return {
      index: resp.index,
      request: interceptedRequestFromProto(resp.request),
    };
  }

  /**
   * Blocks until the next response whose URL matches one of the supplied
   * patterns is observed.
   *
   * Same shape as {@link waitForAnyRequest} but on the response phase.
   * When `patterns[i].abort` is true the page receives an empty 200
   * instead of the real response.
   *
   * @inheritDoc CloudBrowser.waitForAnyRequest
   *
   * @returns object with `index` (matched pattern index) and `response`
   *   (the captured status/headers/body; null if no body was returned)
   *
   * @throws timeout - no response matched any pattern before the deadline.
   *   Nothing occurring is an answer, and it stays distinguishable from a
   *   connection that died on the way. Supplying no patterns is a caller mistake
   *   rather than an outcome, and rejects separately
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * const { index, response } = await browser.waitForAnyResponse(
   *   [{ url: "*\/api/login" }],
   *   { timeoutMs: 5000 },
   * );
   * console.log(index, response?.statusCode);
   */
  async waitForAnyResponse(
    patterns: RequestPattern[],
    opts?: { timeoutMs?: number },
  ): Promise<{ index: number; response: InterceptedResponse | null }> {
    if (patterns.length === 0) {
      throw new BrowserScaleError("browserscale.waitForAnyResponse: at least one pattern required");
    }
    const { urls, aborts } = splitRequestPatterns(patterns);
    const req = create(WaitForAnyResponseRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
      patterns: urls,
      abortFlags: aborts,
    });
    if (opts?.timeoutMs) req.timeout = opts.timeoutMs;
    const resp = await this.client.waitForAnyResponse(req);
    throwCommandError("waitForAnyResponse", resp.error);
    return {
      index: resp.index,
      response: interceptedResponseFromProto(resp.response),
    };
  }

  /**
   * Waits for the next request whose URL matches urlPattern, applies the
   * supplied header modifications (and optional body replacement), then
   * forwards the modified request.
   *
   * One-shot: consumes the first matching request. Each modification is a
   * plain {@link HeaderModification} object literal.
   *
   * @param urlPattern - URL wildcard to wait for
   * @param opts - optional `body` (replacement request body), `modifications`
   *   (header changes), and `timeoutMs` (per-call timeout)
   *
   * @returns InterceptedRequest carrying the method/URL/headers/body that
   *   were actually sent on the wire after modifications were applied;
   *   null when no request payload was reported
   *
   * @throws timeout - no matching request appeared before the deadline, so
   *   nothing was modified
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * const req = await browser.modifyRequest("*\/api/me", {
   *   modifications: [
   *     { action: "add", name: "X-Trace", value: "abc123" },
   *     { action: "remove", name: "Cookie" },
   *   ],
   *   timeoutMs: 5000,
   * });
   * console.log("forwarded headers:", req?.headers);
   */
  async modifyRequest(
    urlPattern: string,
    opts?: {
      body?: string;
      modifications?: HeaderModification[];
      timeoutMs?: number;
    },
  ): Promise<InterceptedRequest | null> {
    const req = create(ModifyRequestRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
      urlPattern,
      modifications: headerModsToProto(opts?.modifications),
    });
    if (opts?.body) req.body = opts.body;
    if (opts?.timeoutMs) req.timeout = opts.timeoutMs;
    const resp = await this.client.modifyRequest(req);
    throwCommandError("modifyRequest", resp.error);
    return interceptedRequestFromProto(resp.request);
  }

  // ──────────────────────────────────────────────────────────────────
  // Network capture
  // ──────────────────────────────────────────────────────────────────

  /**
   * Starts capturing the session's network traffic and returns a live view of
   * it.
   *
   * Every request matching `opts.patterns` is reported once it completes, and
   * "every request" is literal: capture sits in the browser process rather than
   * in a page, so cross-process iframes, workers and service workers are
   * included, the headers are the ones actually put on the wire (Cookie and
   * Sec-* included), and each hop of a redirect chain arrives as its own
   * exchange. Requests are never paused, so the page loads at full speed.
   *
   * This resolves as soon as the capture is running; onExchange then fires in
   * the background while you drive the browser. The capture is armed only after
   * the subscription exists, so nothing that happens after this resolves is
   * missed. Call {@link NetworkCapture.stop} when done — it disarms the capture
   * server-side, which an aborted transport alone does not.
   *
   * @param opts - which requests to capture and whether to keep bodies
   * @param onExchange - called per exchange; see {@link NetworkExchangeHandler}
   *   for the ordering and blocking rules
   *
   * @returns NetworkCapture handle for stopping the capture and inspecting how
   *   it ended
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const capture = await browser.captureNetwork(
   *   { patterns: ["*\/api/*"], bodies: "text" },
   *   (ex) => console.log(ex.statusCode, ex.method, ex.url),
   * );
   * try {
   *   await browser.navigate("https://example.com");
   * } finally {
   *   await capture.stop();
   * }
   */
  async captureNetwork(
    opts: NetworkCaptureOptions,
    onExchange: NetworkExchangeHandler,
  ): Promise<NetworkCapture> {
    const capture = await this.subscribeNetworkExchanges(onExchange);
    try {
      await this.startNetworkCapture(opts);
    } catch (err) {
      // Not armed yet, so this only tears down the local subscription.
      await capture.stop();
      throw err;
    }
    capture.arm();
    return capture;
  }

  /**
   * Arms a capture without subscribing to it.
   *
   * Use it when the reader lives somewhere else — another tab, or a later
   * {@link createWebSocketBrowser} against the same session. Most callers want
   * {@link CloudBrowser.captureNetwork} instead, which arms and subscribes
   * together. Calling this again replaces the running capture.
   *
   * @param opts - which requests to capture and whether to keep bodies
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   */
  async startNetworkCapture(opts: NetworkCaptureOptions): Promise<void> {
    const res = await this.client.startNetworkCapture(
      create(StartNetworkCaptureRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        patterns: opts.patterns ?? [],
        bodies: opts.bodies ?? "none",
        bodyPatterns: opts.bodyPatterns ?? [],
      }),
    );
    throwCommandError("startNetworkCapture", res.error);
  }

  /**
   * Disarms the session's capture.
   *
   * @returns whether a capture was running
   *
   * Rejects only on a transport failure. Stopping a capture that is not running
   * is a no-op rather than a failure, so there are no error codes to branch on.
   */
  async stopNetworkCapture(): Promise<boolean> {
    const resp = await this.client.stopNetworkCapture(
      create(StopNetworkCaptureRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("stopNetworkCapture", resp.error);
    return resp.stopped;
  }

  /**
   * Subscribes to the session's capture without arming one, for reading a
   * capture that {@link CloudBrowser.startNetworkCapture} armed elsewhere.
   * Several readers can watch the same capture, each with its own buffer.
   *
   * Stopping the returned view detaches this reader and leaves the capture
   * running, since other readers may still be attached.
   *
   * @param onExchange - called per exchange; see {@link NetworkExchangeHandler}
   *   for the ordering and blocking rules
   *
   * @returns NetworkCapture attached to whatever capture is running; onExchange
   *   simply never fires when none is
   *
   * Rejects only on a transport failure: opening the subscription has no semantic
   * failure of its own.
   */
  async streamNetworkExchanges(
    onExchange: NetworkExchangeHandler,
  ): Promise<NetworkCapture> {
    return this.subscribeNetworkExchanges(onExchange);
  }

  /**
   * Opens the stream and waits for the server to acknowledge the subscription
   * before resolving.
   *
   * Merely calling the streaming method does not wait for the server to start
   * handling it, so arming a capture straight after could outrun the
   * subscription and lose the first exchanges. The response headers arrive once
   * the handler is subscribed, and onHeader reports exactly that — over native
   * gRPC as well as over the WebSocket transport, which forwards the event as
   * its own frame.
   */
  private async subscribeNetworkExchanges(
    onExchange: NetworkExchangeHandler,
  ): Promise<NetworkCapture> {
    const abort = new AbortController();
    let subscribed!: () => void;
    const ready = new Promise<void>((resolve) => {
      subscribed = resolve;
    });

    const stream = this.client.streamNetworkExchanges(
      create(StreamNetworkExchangesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
      { signal: abort.signal, onHeader: () => subscribed() },
    );

    const capture = new NetworkCapture({
      stream,
      onExchange,
      abort,
      disarm: () => this.stopNetworkCapture(),
    });

    // A stream that dies before it is acknowledged would leave the wait above
    // hanging, so race the two outcomes.
    const ended = capture.wait().then(() => {
      throw new BrowserScaleError(
        "browserscale.captureNetwork: stream closed before the subscription was established",
      );
    });
    ended.catch(() => {}); // the loser of the race must not look unhandled
    await Promise.race([ready, ended]);

    return capture;
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
   * {@link CloudBrowser.getDOM} does, these regions stay live — and frames
   * nobody opened cost nothing.
   *
   * ```ts
   * const mirror = await browser.mirrorDom({ pierce: true }, () => {
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
   * without subscribing to changes. {@link CloudBrowser.mirrorDom} is what you
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
   * Prefer this over {@link CloudBrowser.getDOMHash}, which serializes the
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
      apiKey: this.apiKey,
    });
    if (frameId) req.frameId = frameId;
    const resp = await this.client.getDomRevision(req);
    throwCommandError("getDomRevision", resp.error);
    return Number(resp.revision);
  }

  // ──────────────────────────────────────────────────────────────────
  // Cookies
  // ──────────────────────────────────────────────────────────────────

  /**
   * Returns all cookies currently stored in this session's browser context.
   *
   * @returns CookieParam[], one per cookie in the context
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const cookies = await browser.getCookies();
   * for (const c of cookies) console.log(c.name, "=", c.value);
   */
  async getCookies(): Promise<CookieParam[]> {
    const resp = await this.client.getCookies(
      create(GetCookiesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("getCookies", resp.error);
    return resp.cookies.map(cookieParamFromProto);
  }

  /**
   * Writes the supplied cookies into the browser context.
   *
   * Existing cookies with the same (name, domain, path) tuple are
   * overwritten. Pass an empty array for a no-op.
   *
   * @param cookies - cookies to write; empty array is a no-op
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await browser.setCookies([
   *   { name: "auth", value: "tok", domain: "example.com", path: "/" },
   * ]);
   */
  async setCookies(cookies: CookieParam[]): Promise<void> {
    const res = await this.client.setCookies(
      create(SetCookiesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        cookies: cookieParamsToProto(cookies),
      }),
    );
    throwCommandError("setCookies", res.error);
  }

  /**
   * Deletes every cookie in the browser context.
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await browser.clearCookies();
   */
  async clearCookies(): Promise<void> {
    const res = await this.client.clearCookies(
      create(ClearCookiesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("clearCookies", res.error);
  }

  // ──────────────────────────────────────────────────────────────────
  // Storage (localStorage)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Returns the localStorage contents of this session's browser context,
   * grouped by origin.
   *
   * The storage database is read directly in the browser process, so no
   * page needs to be open. Only first-party localStorage is included —
   * sessionStorage is per-tab and not covered.
   *
   * @param origin - if set, only this origin is returned
   *   (e.g. "https://example.com"); omit to get all origins
   *
   * @returns StorageOriginEntry[], one per origin with localStorage data
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const storage = await browser.getStorage();
   * for (const e of storage) {
   *   for (const { key, value } of e.items) console.log(e.origin, key, "=", value);
   * }
   */
  async getStorage(origin?: string): Promise<StorageOriginEntry[]> {
    const req = create(GetStorageRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
    });
    if (origin) req.origin = origin;
    const resp = await this.client.getStorage(req);
    throwCommandError("getStorage", resp.error);
    return resp.storage.map(storageEntryFromProto);
  }

  /**
   * Writes localStorage entries into the browser context, grouped by
   * origin.
   *
   * Accepts the same structure getStorage() returns, so a dump can be
   * fed back verbatim. Existing keys are overwritten. Works without any
   * open page; pages that are already open will not observe the writes
   * until they reload.
   *
   * @param storage - entries to write, grouped by origin
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await browser.setStorage([
   *   {
   *     origin: "https://example.com",
   *     items: [
   *       { key: "token", value: "abc123" },
   *       { key: "theme", value: "dark" },
   *     ],
   *   },
   * ]);
   */
  async setStorage(storage: StorageOriginEntry[]): Promise<void> {
    const res = await this.client.setStorage(
      create(SetStorageRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        storage: storageEntriesToProto(storage),
      }),
    );
    throwCommandError("setStorage", res.error);
  }

  /**
   * Deletes localStorage in the browser context.
   *
   * @param origin - if set, only this origin's storage is deleted
   *   (e.g. "https://example.com"); omit to delete all origins
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * // Wipe one origin.
   * await browser.clearStorage("https://example.com");
   *
   * // Wipe everything.
   * await browser.clearStorage();
   */
  async clearStorage(origin?: string): Promise<void> {
    const req = create(ClearStorageRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
    });
    if (origin) req.origin = origin;
    const res = await this.client.clearStorage(req);
    throwCommandError("clearStorage", res.error);
  }

  // ──────────────────────────────────────────────────────────────────
  // Auth / DBSC (portable signed-in persona)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Exports the signed-in primary account and DBSC sessions of this
   * browser context.
   *
   * State is read in the browser process, so no page needs to be open.
   * Returns undefined when the context has neither a signed-in account
   * nor DBSC sessions.
   *
   * @returns AuthSession, or undefined when there is nothing to export
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const auth = await browser.getAuthSession();
   * if (auth) await fs.writeFile("auth.json", JSON.stringify(auth));
   */
  async getAuthSession(): Promise<AuthSession | undefined> {
    const resp = await this.client.getAuthSession(
      create(GetAuthSessionRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("getAuthSession", resp.error);
    return resp.session ? authSessionFromProto(resp.session) : undefined;
  }

  /**
   * Imports an auth session so the context comes up signed in (and syncing
   * if syncConsent) with its DBSC sessions restored.
   *
   * Call it before navigating. Pair with setCookies() / setStorage() to
   * restore a full persona.
   *
   * @param session - session as returned by getAuthSession()
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * await browser.setAuthSession(saved);
   * await browser.navigate("https://mail.google.com");
   */
  async setAuthSession(session: AuthSession): Promise<void> {
    const res = await this.client.setAuthSession(
      create(SetAuthSessionRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        session: authSessionToProto(session),
      }),
    );
    throwCommandError("setAuthSession", res.error);
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
   * const r = await browser.inspectAtPosition(200, 300);
   * console.log(r.tagName, r.textContent);
   */
  async inspectAtPosition(x: number, y: number): Promise<InspectResult> {
    const resp = await this.client.inspectAtPosition(
      create(InspectAtPositionRequestSchema, {
        sessionId: this.sessionId,
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
   * await browser.highlightNode(res.backendNodeId, res.frameId);
   */
  async highlightNode(backendNodeId: number, frameId: string = ""): Promise<void> {
    const req = create(HighlightNodeRequestSchema, {
      sessionId: this.sessionId,
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
   * @throws busy - another action is already running on this page
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * await browser.insertText("hello world");
   */
  async insertText(text: string): Promise<void> {
    const res = await this.client.insertText(
      create(InsertTextRequestSchema, {
        sessionId: this.sessionId,
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
   * `type` has no semantic failure of its own: the keys land wherever focus
   * happens to be, so there is no target it can miss. Only the page or context
   * being torn down mid-stream surfaces, and that is a transport failure rather
   * than a code.
   *
   * @example
   * // OTP field that auto-advances across boxes.
   * await browser.click(css("input.otp-0"));
   * await browser.type("123456");
   */
  async type(text: string, opts?: { clearFirst?: boolean }): Promise<void> {
    const req = create(TypeRequestSchema, {
      sessionId: this.sessionId,
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
   * @throws busy - another action is already running on this page
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * // Ctrl+A
   * await browser.pressKey("a", { code: "KeyA", modifiers: 2 });
   * await browser.releaseKey("a", { code: "KeyA", modifiers: 2 });
   */
  async pressKey(
    key: string,
    opts?: { code?: string; modifiers?: number; location?: number },
  ): Promise<void> {
    const req = create(PressKeyRequestSchema, {
      sessionId: this.sessionId,
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
   * await browser.pressKey("Shift", { code: "ShiftLeft", location: 1 });
   * await browser.releaseKey("Shift", { code: "ShiftLeft", location: 1 });
   */
  async releaseKey(
    key: string,
    opts?: { code?: string; modifiers?: number; location?: number },
  ): Promise<void> {
    const req = create(ReleaseKeyRequestSchema, {
      sessionId: this.sessionId,
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
   * const sel = await browser.getSelection();
   * console.log("user selected:", sel);
   */
  async getSelection(): Promise<string> {
    const resp = await this.client.getSelection(
      create(GetSelectionRequestSchema, {
        sessionId: this.sessionId,
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
   * wild. The challenge is completed in-page server-side (the resulting
   * token / bypass cookies are wired into the page automatically), so
   * callers can ignore the returned string.
   *
   * @param opts - optional `timeoutMs` (how long to wait for a captcha to
   *   appear; omit for server default 60s) and `retryAmount` (failures
   *   tolerated before giving up)
   *
   * @returns empty string on success — the solution is applied server-side
   *
   * Rejects when no captcha appeared within 	imeoutMs, or when the one that did
   * could not be solved within 
etryAmount attempts. Neither carries a code:
   * solving runs outside the page, so there is no per-command code set here.
   *
   * @example
   * await browser.solveCaptcha({ retryAmount: 2 });
   */
  async solveCaptcha(opts?: { timeoutMs?: number; retryAmount?: number }): Promise<string> {
    const resp = await this.client.solveCaptcha(
      create(SolveCaptchaRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        timeoutMs: opts?.timeoutMs ?? 0,
        retryAmount: opts?.retryAmount ?? 0,
      }),
    );
    return resp.result;
  }

  // ──────────────────────────────────────────────────────────────────
  // Live streaming (WebRTC)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Returns the ICE servers (TURN URL + short-lived credentials) to put in
   * your `RTCPeerConnection` BEFORE creating the offer, so it can gather relay
   * candidates.
   *
   * Live streaming is a two-step, client-offerer handshake: call
   * `getStreamConfig`, build your peer with the returned servers, create an
   * offer, then pass its SDP to {@link startStream} and apply the answer.
   *
   * @returns the ICE servers for the client `RTCPeerConnection`
   *
   * Rejects when TURN is not configured on the server. That is a deployment
   * condition rather than a per-call outcome, so it carries no code.
   *
   * @example
   * const ice = await browser.getStreamConfig();
   * const pc = new RTCPeerConnection({ iceServers: ice });
   */
  async getStreamConfig(): Promise<IceServer[]> {
    const resp = await this.client.getStreamConfig(
      create(GetStreamConfigRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    return resp.iceServers.map((s) => ({
      urls: s.urls,
      username: s.username ?? "",
      credential: s.credential ?? "",
    }));
  }

  /**
   * Answers your WebRTC SDP offer and starts streaming the page as a video
   * track. The browser is the answerer; you are the offerer (see
   * {@link getStreamConfig} for the credentials to build the offer).
   *
   * @param offerSdp - your `RTCPeerConnection`'s SDP offer
   *
   * @returns the SDP answer to apply as the remote description, plus the
   *   viewport to map input coordinates into
   *
   * @throws already_active - a stream is already running on this session; stop it
   *   before starting another
   * @throws negotiation_failed - the browser could not agree on a connection. The
   *   message carries the negotiator's own diagnostic, which is usually where the
   *   actual cause is
   *
   * An empty offer or an unconfigured TURN setup is a caller mistake rather than
   * an outcome, and rejects separately.
   *
   * @see {@link CommandError} for reading the code off the rejection
   *
   * @example
   * const { answerSdp, viewport } = await browser.startStream(offer.sdp);
   * await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
   */
  async startStream(offerSdp: string): Promise<StreamAnswer> {
    const resp = await this.client.startStream(
      create(StartStreamRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        offerSdp,
      }),
    );
    throwCommandError("startStream", resp.error);
    return {
      answerSdp: resp.answerSdp,
      viewport: resp.viewport
        ? { width: resp.viewport.width, height: resp.viewport.height }
        : null,
    };
  }

  /**
   * Tears down the live video stream for the session's page. Safe to call even
   * if no stream is running.
   *
   * Rejects only on a transport failure. Stopping a stream that is not running is
   * a no-op rather than a failure, so there are no error codes to branch on.
   *
   * @example
   * await browser.stopStream();
   */
  async stopStream(): Promise<void> {
    const res = await this.client.stopStream(
      create(StopStreamRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("stopStream", res.error);
  }

  // ──────────────────────────────────────────────────────────────────
  // Reactions
  // ──────────────────────────────────────────────────────────────────

  /**
   * Registers a one-shot "reaction": the browser watches for the `match`
   * locator in the background and, as soon as it matches, clicks it the same
   * way {@link CloudBrowser.click} does (scroll, human path, occlusion check) —
   * then removes itself. The reaction yields to any in-flight input
   * action and only fires while the pointer is idle, so a reaction naturally
   * slots into the gaps of a retrying foreground action (e.g. it dismisses a
   * newsletter modal blocking a {@link CloudBrowser.click}, after which the
   * click's own retry succeeds). Reactions are scoped to the page and torn
   * down automatically when the page/session ends.
   *
   * `match` must be a `css()` or `js()` {@link Locator} — `node()`/`at()` are
   * rejected. Use `.inAllFrames()` to watch every frame and `.visible(false)`
   * to opt out of the default visibility gate. Pass a `ReactionOpts` to click a
   * different target (`on`), change the button/click count, or the poll cadence.
   *
   * @param match - the css()/js() locator to watch for
   * @param opts - optional reaction customization; see {@link ReactionOpts}
   *
   * @returns the reactionId (pass to {@link CloudBrowser.removeReaction})
   *
   * @throws {@link BrowserScaleError} - `match` (or `opts.on`) is not a css()/js()
   *   locator, or a server/transport error
   *
   * @example
   * // Auto-dismiss a consent button whenever it appears, in any frame.
   * const id = await browser.addReaction(css("button#accept").inAllFrames());
   *
   * @example
   * // Watch for a newsletter modal, but click its close "X" instead.
   * const id = await browser.addReaction(css("#newsletter-modal"), {
   *   on: css(".modal-close"),
   * });
   */
  async addReaction(match: Locator, opts?: ReactionOpts): Promise<string> {
    this.assertReactionLocator("addReaction", match, "match");
    const req = create(AddReactionRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
    });
    if (match.selector) req.matchSelector = match.selector;
    if (match.jsExpression) req.matchJsExpression = match.jsExpression;
    if (match.frameId) req.frameId = match.frameId;
    if (match.visibleFlag !== undefined) req.visible = match.visibleFlag;
    if (opts?.on) {
      this.assertReactionLocator("addReaction", opts.on, "on");
      if (opts.on.selector) req.actionSelector = opts.on.selector;
      if (opts.on.jsExpression) req.actionJsExpression = opts.on.jsExpression;
    }
    if (opts?.button) req.button = opts.button;
    if (opts?.clickCount) req.clickCount = opts.clickCount;
    if (opts?.intervalMs) req.interval = opts.intervalMs;
    const resp = await this.client.addReaction(req);
    throwCommandError("addReaction", resp.error);
    return resp.reactionId;
  }

  /**
   * Removes a pending reaction by id. Returns `false` if the reaction had
   * already fired (one-shot) or was never registered.
   *
   * @param reactionId - id returned by {@link CloudBrowser.addReaction}
   *
   * @returns true if a pending reaction with this id existed and was removed
   *
   * Removing an id that is not registered is a no-op rather than an error, so the
   * returned boolean - not a rejection - is what tells you whether anything was
   * there. Rejects only on a transport failure.
   *
   * @example
   * const removed = await browser.removeReaction(id);
   */
  async removeReaction(reactionId: string): Promise<boolean> {
    const resp = await this.client.removeReaction(
      create(RemoveReactionRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        reactionId,
      }),
    );
    throwCommandError("removeReaction", resp.error);
    return resp.removed;
  }

  /**
   * Returns the still-pending reactions registered for the current page.
   * Reactions that have already fired (one-shot) are not included.
   *
   * @returns the pending reactions for the page
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const pending = await browser.listReactions();
   * for (const r of pending) console.log(r.reactionId, r.matchSelector);
   */
  async listReactions(): Promise<ReactionInfo[]> {
    const resp = await this.client.listReactions(
      create(ListReactionsRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("listReactions", resp.error);
    return resp.reactions.map((r) => ({
      reactionId: r.reactionId,
      matchSelector: r.matchSelector ?? "",
      matchJsExpression: r.matchJsExpression ?? "",
      actionSelector: r.actionSelector ?? "",
      actionJsExpression: r.actionJsExpression ?? "",
      frameId: r.frameId,
      visible: r.visible,
    }));
  }

  // ──────────────────────────────────────────────────────────────────
  // Scripts
  // ──────────────────────────────────────────────────────────────────

  /**
   * Runs `source` in the session's browser and waits for it to finish.
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
   * {@link CloudBrowser.startScript} when the script may outlive the caller's
   * patience, or {@link CloudBrowser.stopScripts} to abandon what this session
   * is running.
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
   * const result = await browser.runScript(`
   *   await browser.navigate("https://example.com");
   *   const items = [];
   *   for (const el of await browser.getDOM().querySelectorAll("h1")) {
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
   * Launches `source` in the session's browser and resolves as soon as the run
   * is under way.
   *
   * The counterpart to {@link CloudBrowser.runScript}, for scripts that are not
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
   * const run = await browser.startScript(source, (ev) => {
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
   * Watches script output in this session without starting anything.
   *
   * For the case {@link CloudBrowser.startScript} cannot cover: a run somebody
   * else launched, or one this page started before it reloaded. Several readers
   * can watch the same session, each with its own buffer.
   *
   * Only output produced from now on arrives — lines printed before the
   * subscription existed are not kept. A run that has already finished is
   * therefore invisible here; {@link CloudBrowser.listScriptRuns} is how you
   * tell that apart from a run that is merely quiet.
   *
   * @param runId - run to follow, or `""` to follow every run in the session
   * @param onEvent - called per event; see {@link ScriptEventHandler} for the
   *   ordering and blocking rules
   *
   * @returns ScriptFollow handle for stopping the subscription
   *
   * Rejects only on a transport failure: opening the subscription has no semantic
   * failure of its own.
   *
   * @example
   * const follow = await browser.followScript(runId, (ev) => {
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
        apiKey: this.apiKey,
        runId,
      }),
      { signal: abort.signal },
    );
    return new ScriptFollow({ stream, onEvent, abort });
  }

  /**
   * Cancels runs in this session and reports how many it ended.
   *
   * An empty `runId` cancels every run in the session, which is the only form
   * available to a caller that never learned an id — notably one abandoning a
   * {@link CloudBrowser.runScript}.
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
   * await browser.stopScripts(""); // abandon everything running
   */
  async stopScripts(runId: string): Promise<number> {
    const resp = await this.client.stopScripts(
      create(StopScriptsRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        runId,
      }),
    );
    return resp.stopped;
  }

  /**
   * Reports the scripts still running in this session.
   *
   * Only runs in flight — a finished run is reported once on the event stream
   * and then forgotten, so this is not a history. Its use is finding work this
   * caller did not start: a script a previous page left behind, which
   * {@link CloudBrowser.stopScripts} needs an id to name.
   *
   * @returns one entry per run still executing
   *
   * Rejects only on a transport failure - a dead session, a broken connection.
   * This call has no semantic failure of its own, so there are no error codes to
   * branch on.
   *
   * @example
   * for (const run of await browser.listScriptRuns()) {
   *   console.log(run.runId, run.runningMs);
   * }
   */
  async listScriptRuns(): Promise<ScriptRunInfo[]> {
    const resp = await this.client.listScriptRuns(
      create(ListScriptRunsRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    return resp.runs.map((run) => ({
      runId: run.runId,
      runningMs: Number(run.runningMs),
    }));
  }

  /**
   * @internal — a reaction match/action must be a css()/js() locator: node()
   * and at() are rejected (a reaction watches for a condition, like a wait).
   */
  private assertReactionLocator(cmd: string, l: Locator, role: string): void {
    if (l.backendNodeId !== 0 || l.x !== undefined || l.y !== undefined) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: ${role} must be a css()/js() locator (node()/at() are not valid)`,
      );
    }
    if (!l.selector && !l.jsExpression) {
      throw new BrowserScaleError(
        `browserscale.${cmd}: ${role} must have a CSS selector or JS expression`,
      );
    }
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
