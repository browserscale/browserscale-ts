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
  InspectAtPositionRequestSchema,
  HighlightNodeRequestSchema,
  InsertTextRequestSchema,
  PressKeyRequestSchema,
  ReleaseKeyRequestSchema,
  GetSelectionRequestSchema,
  SolveCaptchaRequestSchema,
} from "./gen/wrc_pb.ts";
import type { Locator } from "./locator.ts";
import { DefaultWaitTimeoutMs } from "./defaults.ts";
import { BrowserScaleError } from "./errors.ts";
import type {
  DOMResult,
  DragResult,
  ElementResult,
  EvaluateResult,
  InterceptedRequest,
  InterceptedResponse,
  InspectResult,
  NavigateResult,
  ObservationResult,
  PageInfo,
  ScreenshotResult,
  ReadCanvasResult,
  SelectOptionResult,
  WaitResult,
} from "./types.ts";
import type {
  ClickOpts,
  FillOpts,
  GetDOMOpts,
  GetObservationOpts,
  LoadHTMLOpts,
  NavigateOpts,
  ScreenshotOpts,
  ReadCanvasOpts,
  SelectOpts,
  WaitOpts,
} from "./options.ts";
import type { HeaderModification, RequestPattern } from "./network.ts";
import type { CookieParam } from "./cookies.ts";
import type { StorageOriginEntry } from "./storage.ts";
import {
  cookieParamFromProto,
  cookieParamsToProto,
  dragResultFromProto,
  elementFields,
  elementResultFromProto,
  headerModsToProto,
  headersToProto,
  interceptedRequestFromProto,
  interceptedResponseFromProto,
  pageInfoFromProto,
  rectFromProto,
  splitRequestPatterns,
  storageEntriesToProto,
  storageEntryFromProto,
  waitResultFromProto,
} from "./internal/convert.ts";

type BrowserRpcClient = Client<typeof Browser>;

/**
 * CloudBrowser is the SDK-side handle for an active browserscale browser session.
 *
 * One CloudBrowser corresponds to exactly one browser context, which
 * always has at least one page. The session is implicitly bound to its
 * primary page server-side — the proto's page_id field is currently
 * ignored server-side, so the SDK never sets it.
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
   * @throws UNKNOWN_ERROR - the stop API or the transport close failed
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
   * @throws UNKNOWN_ERROR - the proxy could not be applied
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
    await this.client.setProxy(req);
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
   * @throws UNKNOWN_ERROR - the pages could not be enumerated
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
   * @throws UNKNOWN_ERROR - the navigation failed or timed out
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
   * @throws UNKNOWN_ERROR - the interceptor could not be installed
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
    await this.client.loadHTML(req);
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
   * @param expression - JavaScript expression evaluated in the main frame
   *
   * @returns EvaluateResult with either value (non-Element) or element
   *   metadata (Element)
   *
   * @throws UNKNOWN_ERROR - the expression threw or could not be compiled
   *
   * @example
   * const res = await browser.evaluate<string>("document.title");
   * console.log(res.value);
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
    let value: T | null = null;
    if (resp.result !== "") {
      try {
        value = JSON.parse(resp.result) as T;
      } catch {
        value = resp.result as unknown as T;
      }
    }
    return {
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
   * @throws UNKNOWN_ERROR - the wait timed out or a condition was invalid
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
      timeout: opts?.timeoutMs ?? DefaultWaitTimeoutMs,
    });
    if (frameId) req.frameId = frameId;

    const resp = await this.client.waitForAny(req);
    return waitResultFromProto(resp);
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
   * @throws INVALID_LOCATOR - target is empty or has multiple targets set
   * @throws ELEMENT_NOT_FOUND - no element matched the locator
   * @throws FRAME_NOT_FOUND - the requested frame does not exist
   * @throws CLICK_FAILED - the click could not be dispatched
   * @throws TIMEOUT - the operation exceeded the server-side timeout
   * @throws PAGE_NOT_ALIVE - the page has been closed
   *
   * @example
   * await browser.click(css("button.submit"));
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
    const resp = await this.client.click(req);
    return elementResultFromProto(resp);
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
   * @throws INVALID_LOCATOR - target is empty or has multiple targets set
   * @throws ELEMENT_NOT_FOUND - no element matched the locator
   * @throws FRAME_NOT_FOUND - the requested frame does not exist
   * @throws FILL_FAILED - the input could not be filled
   * @throws TIMEOUT - the operation exceeded the server-side timeout
   * @throws PAGE_NOT_ALIVE - the page has been closed
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
    const resp = await this.client.fill(req);
    return elementResultFromProto(resp);
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
   * @throws UNKNOWN_ERROR - the move could not be completed
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
    const resp = await this.client.moveTo(req);
    return elementResultFromProto(resp);
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
   * @throws UNKNOWN_ERROR - the element could not be scrolled into view
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
    const resp = await this.client.scrollTo(req);
    return elementResultFromProto(resp);
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
   * @throws UNKNOWN_ERROR - the drag could not be performed
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
   * @throws UNKNOWN_ERROR - the drag could not be performed
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
    const resp = await this.client.drag(req);
    return dragResultFromProto(resp);
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
   * @throws INVALID_LOCATOR - target is empty or has multiple targets set
   * @throws ELEMENT_NOT_FOUND - no element matched the locator
   * @throws FRAME_NOT_FOUND - the requested frame does not exist
   * @throws SELECT_FAILED - the option could not be selected
   *   (out of range, or element is not a `<select>`)
   * @throws TIMEOUT - the operation exceeded the server-side timeout
   * @throws PAGE_NOT_ALIVE - the page has been closed
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
    const resp = await this.client.selectOption(req);
    return {
      selectedIndex: resp.selectedIndex,
      selectedValue: resp.selectedValue,
      selectedText: resp.selectedText,
    };
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
   * @throws UNKNOWN_ERROR - the DOM could not be retrieved
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
   * @throws UNKNOWN_ERROR - the hash could not be computed
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
   * Returns a compact, agent-friendly description of every interactable
   * element currently visible on the page, together with a truncated view
   * of the surrounding text.
   *
   * Intended as input for LLM/agent loops where a full DOM dump would be
   * too large; the server filters down to elements that are actually
   * visible and interactable.
   *
   * @param opts - optional caps: `maxElementsPerFrame`, `maxTextLength`;
   *   omit either to use the server default
   *
   * @returns ObservationResult with both a human-readable `text` rendering
   *   and a `json` payload of the structured observation
   *
   * @throws UNKNOWN_ERROR - the observation could not be produced
   *
   * @example
   * const obs = await browser.getObservation({ maxElementsPerFrame: 200 });
   * console.log(obs.text);
   */
  async getObservation(opts?: GetObservationOpts): Promise<ObservationResult> {
    const req = create(GetObservationRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
    });
    if (opts?.maxElementsPerFrame !== undefined) {
      req.maxElementsPerFrame = opts.maxElementsPerFrame;
    }
    if (opts?.maxTextLength !== undefined) req.maxTextLength = opts.maxTextLength;
    const resp = await this.client.getObservation(req);
    return { text: resp.observationText, json: resp.observationJson };
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
   * @throws UNKNOWN_ERROR - the screenshot could not be captured
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
   * @throws INVALID_LOCATOR - target is empty, uses at(x,y), or has multiple targets
   * @throws ELEMENT_NOT_FOUND - no element matched the locator
   * @throws FRAME_NOT_FOUND - the requested frame does not exist
   * @throws TIMEOUT - the operation exceeded the server-side timeout
   * @throws PAGE_NOT_ALIVE - the page has been closed
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
   * @throws UNKNOWN_ERROR - the blocklist could not be applied
   *
   * @example
   * await browser.setBlockList([
   *   "*.doubleclick.net/*",
   *   "*googletagmanager.com*",
   * ]);
   */
  async setBlockList(patterns: string[]): Promise<void> {
    await this.client.setBlockList(
      create(SetBlockListRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        patterns,
      }),
    );
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
   * @throws UNKNOWN_ERROR - the static paths could not be configured
   *
   * @example
   * await browser.setStaticPaths("snap-2026-05", ["*.example.com/*"]);
   */
  async setStaticPaths(blobName: string, patterns: string[]): Promise<void> {
    await this.client.setStaticPaths(
      create(SetStaticPathsRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        blobName,
        patterns,
      }),
    );
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
   * @throws UNKNOWN_ERROR - the wait timed out or no patterns were supplied
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
   * @throws UNKNOWN_ERROR - no matching request appeared within the timeout
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
    return interceptedRequestFromProto(resp.request);
  }

  // ──────────────────────────────────────────────────────────────────
  // Cookies
  // ──────────────────────────────────────────────────────────────────

  /**
   * Returns all cookies currently stored in this session's browser context.
   *
   * @returns CookieParam[], one per cookie in the context
   *
   * @throws UNKNOWN_ERROR - the cookies could not be read
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
   * @throws UNKNOWN_ERROR - the cookies could not be written
   *
   * @example
   * await browser.setCookies([
   *   { name: "auth", value: "tok", domain: "example.com", path: "/" },
   * ]);
   */
  async setCookies(cookies: CookieParam[]): Promise<void> {
    await this.client.setCookies(
      create(SetCookiesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        cookies: cookieParamsToProto(cookies),
      }),
    );
  }

  /**
   * Deletes every cookie in the browser context.
   *
   * @throws UNKNOWN_ERROR - the cookies could not be cleared
   *
   * @example
   * await browser.clearCookies();
   */
  async clearCookies(): Promise<void> {
    await this.client.clearCookies(
      create(ClearCookiesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
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
   * @throws UNKNOWN_ERROR - the storage could not be read
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
   * @throws UNKNOWN_ERROR - the storage could not be written
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
    await this.client.setStorage(
      create(SetStorageRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        storage: storageEntriesToProto(storage),
      }),
    );
  }

  /**
   * Deletes localStorage in the browser context.
   *
   * @param origin - if set, only this origin's storage is deleted
   *   (e.g. "https://example.com"); omit to delete all origins
   *
   * @throws UNKNOWN_ERROR - the storage could not be cleared
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
    await this.client.clearStorage(req);
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
   * @throws UNKNOWN_ERROR - the hit-test failed
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
   * @throws UNKNOWN_ERROR - the highlight could not be applied
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
    await this.client.highlightNode(req);
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
   * @throws UNKNOWN_ERROR - the text could not be inserted
   *
   * @example
   * await browser.insertText("hello world");
   */
  async insertText(text: string): Promise<void> {
    await this.client.insertText(
      create(InsertTextRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
        text,
      }),
    );
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
   * @throws UNKNOWN_ERROR - the event could not be dispatched
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
    await this.client.pressKey(req);
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
    await this.client.releaseKey(req);
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
   * @throws UNKNOWN_ERROR - the selection could not be read
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
   * @throws UNKNOWN_ERROR - no captcha appeared within timeoutMs, or the
   *   detected captcha could not be solved within retryAmount attempts
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
}
