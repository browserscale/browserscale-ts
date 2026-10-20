import type { Client, Transport } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  Browser,
  SetProxyRequestSchema,
  GetPagesRequestSchema,
  CreatePageRequestSchema,
  GetFocusedPageRequestSchema,
  GetUsageRequestSchema,
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
  GetClientIdentityRequestSchema,
  GetAuthSessionRequestSchema,
  SetAuthSessionRequestSchema,
  GetStreamConfigRequestSchema,
  StartStreamRequestSchema,
  StopStreamRequestSchema,
  StreamContextEventsRequestSchema,
  StartNetworkCaptureRequestSchema,
  StopNetworkCaptureRequestSchema,
  StreamNetworkExchangesRequestSchema,
  GetNetworkBodyRequestSchema,
  EnableCaptchaAutoSolveRequestSchema,
  DisableCaptchaAutoSolveRequestSchema,
} from "./gen/wrc_pb.ts";
import { BrowserScaleError, CommandError, noPageFrom, pageClosedFrom, throwCommandError } from "./errors.ts";
import { Page } from "./page.ts";
import type {
  CaptchaAutoSolveOpts,
  InterceptedRequest,
  InterceptedResponse,
  NetworkBody,
  NetworkBodyRange,
  NetworkCaptureOptions,
  PageInfo,
  ReactionInfo,
  SessionUsage,
  IceServer,
  StreamAnswer,
} from "./types.ts";
import type { Locator } from "./locator.ts";
import type { ReactionOpts } from "./options.ts";
import { addReaction, listReactions, removeReaction, type ReactionScope } from "./internal/reactions.ts";
import type { HeaderModification, RequestPattern } from "./network.ts";
import { NetworkCapture, type NetworkExchangeHandler } from "./network-capture.ts";
import { ContextEvents, type ContextEventHandler } from "./context-events.ts";
import type { CookieParam } from "./cookies.ts";
import type { StorageOriginEntry } from "./storage.ts";
import type { AuthSession } from "./auth-session.ts";
import type { ClientIdentity, ClientIdentityOptions } from "./identity.ts";
import type { ProxyOptions } from "./config.ts";
import {
  authSessionFromProto,
  authSessionToProto,
  clientIdentityFromProto,
  cookieParamFromProto,
  cookieParamsToProto,
  headerModsToProto,
  interceptedRequestFromProto,
  interceptedResponseFromProto,
  pageInfoFromProto,
  sessionUsageFromProto,
  splitRequestPatterns,
  storageEntriesToProto,
  storageEntryFromProto,
} from "./internal/convert.ts";

type BrowserRpcClient = Client<typeof Browser>;

/**
 * CloudBrowser is the SDK-side handle for an active browserscale browser session.
 *
 * One CloudBrowser corresponds to exactly one browser context, which always
 * has at least one page. Its own methods are what the pages share: proxy,
 * cookies, storage, network rules and capture. Everything that acts on a
 * document is a {@link Page} method; get the page from {@link focusedPage},
 * {@link pages} or {@link getPage}.
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
  private readonly _stopFn?: () => Promise<SessionUsage | undefined>;

  constructor(
    transport: Transport,
    sessionId: string,
    apiKey: string,
    fingerprint: string,
    stopFn?: () => Promise<SessionUsage | undefined>,
  ) {
    this._transport = transport;
    this.sessionId = sessionId;
    this.apiKey = apiKey;
    this._fingerprint = fingerprint;
    this.client = withPageClosed(createClient(Browser, transport), (id) => this.getPage(id));
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
   * @returns SessionUsage what the session consumed over its whole life, read
   *   as it was torn down - no {@link CloudBrowser.getUsage} call is needed
   *   before stopping. Undefined when the server could not report it, and for
   *   a handle that owns no rental.
   *
   * Rejects only when the stop API or the transport close fails. The session is
   * released either way; retrying a stop is safe.
   *
   * @example
   * const usage = await browser.stopBrowser();
   * if (usage) {
   *   console.log(`ran ${usage.wallTime}s, ${usage.cpuTime}s CPU, peak ${usage.peakMemory} bytes`);
   * }
   */
  async stopBrowser(): Promise<SessionUsage | undefined> {
    if (this._stopFn) {
      return await this._stopFn();
    }
    return undefined;
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
   * @param options - the proxy's protocol and a MASQUE proxy, as for a rental
   *
   * Unlike a rental, the new proxy is not checked first. An invalid scheme or
   * MASQUE address is rejected with INVALID_PROXY; otherwise this rejects only
   * on a transport failure - a dead session, a broken connection.
   *
   * @example
   * await browser.setProxy("proxy.example.com", 8080, "user", "pass");
   * await browser.setProxy("proxy.example.com", 1080, "user", "pass", { scheme: "socks5" });
   */
  async setProxy(
    proxyHost: string,
    proxyPort: number,
    proxyUsername: string = "",
    proxyPassword: string = "",
    options: ProxyOptions = {},
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
      if (options.scheme) req.proxyScheme = options.scheme;
      if (options.masque) req.masqueProxy = options.masque;
    }
    const res = await this.client.setProxy(req);
    throwCommandError("setProxy", res.error);
  }

  // ──────────────────────────────────────────────────────────────────
  // Pages
  // ──────────────────────────────────────────────────────────────────

  /**
   * Opens a page the way opening a new tab does: an about:blank tab that takes
   * the focus. A browser starts without a page, so this is the first call after
   * renting one. Resolves once the page is ready for {@link Page.navigate}.
   *
   * @throws {@link CommandError} create_failed - the browser could not open the
   * page, typically capacity
   *
   * @example
   * const page = await browser.createPage();
   * await page.navigate("https://example.com");
   */
  async createPage(): Promise<Page> {
    const resp = await this.client.createPage(
      create(CreatePageRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("createPage", resp.error);
    return this.getPage(resp.page?.pageId ?? "");
  }

  /**
   * Returns the page that has the focus: the one a person would be looking
   * at. Once the browser has a page, exactly one has it. A tab or popup a page
   * opens takes it, and closing the focused page hands it on, the way it does
   * for a person.
   *
   * Input ({@link Page.click}, {@link Page.moveTo} and what builds on them)
   * only acts on the focused page; {@link Page.focus} moves the focus.
   *
   * @throws {@link NoPageError} - the browser has no page yet;
   * {@link createPage} opens the first
   *
   * @example
   * const page = await browser.focusedPage();
   * await page.navigate("https://example.com");
   */
  async focusedPage(): Promise<Page> {
    const resp = await this.client.getFocusedPage(
      create(GetFocusedPageRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    return this.getPage(resp.pageId);
  }

  /**
   * Returns all open pages (tabs and popups) for this session's browser
   * context.
   *
   * Each PageInfo carries the {@link Page} to act on, the page's URL, title,
   * viewport, a full nested frame tree (out-of-process iframes are children
   * of the page's main frame), whether it has the focus, and where it came
   * from (popup or tab, and its opener).
   *
   * @returns PageInfo[] for every page currently open in the context
   *
   * Rejects only on a transport failure - a dead session, a broken connection.
   * This call has no semantic failure of its own, so there are no error codes to
   * branch on.
   *
   * @example
   * const pages = await browser.pages();
   * const popup = pages.find((p) => p.isPopup)?.page;
   */
  async pages(): Promise<PageInfo[]> {
    const resp = await this.client.getPages(
      create(GetPagesRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("pages", resp.error);
    return resp.pages.map((p) => pageInfoFromProto(p, (id) => this.getPage(id)));
  }

  /**
   * Returns the {@link Page} with this id. It makes no call and does not check
   * the id: a page that is gone shows on the Page's first call.
   *
   * @param pageId - a page id, as reported by {@link pages} or an error
   *
   * @example
   * const page = browser.getPage(savedPageId);
   * await page.navigate("https://example.com");
   */
  getPage(pageId: string): Page {
    return new Page(this, this.client, this.sessionId, this.apiKey, pageId);
  }

  /**
   * Registers a listener for the browser's pages: first a snapshot of every
   * page, then each page opening, closing, taking the focus or changing its
   * address or title. Use it to keep a tab list current without polling
   * {@link CloudBrowser.pages}. It also reports every captcha solve
   * (`captchaDetected`, `captchaResolved`) and every reaction's click
   * (`reactionFired`).
   *
   * Resolves once the snapshot has been handed to `onEvent`; the events after
   * it then arrive in the background. Call {@link ContextEvents.stop} when
   * done.
   *
   * @param onEvent - called per event; see {@link ContextEventHandler} for the
   *   ordering rules
   *
   * @returns ContextEvents handle for stopping the listener and inspecting how
   *   it ended
   *
   * Rejects only on a transport failure: listening has no semantic failure of
   * its own.
   *
   * @example
   * const tabs = new Map<string, PageInfo>();
   * const listener = await browser.contextEvents((ev) => {
   *   switch (ev.kind) {
   *     case "snapshot":
   *       tabs.clear();
   *       for (const p of ev.pages) tabs.set(p.page.id, p);
   *       break;
   *     case "pageOpened":
   *       tabs.set(ev.page.id, ev.info);
   *       break;
   *     case "pageClosed":
   *       tabs.delete(ev.page.id);
   *       break;
   *     case "pageUpdated": {
   *       const t = tabs.get(ev.page.id);
   *       if (t) Object.assign(t, { url: ev.url, title: ev.title });
   *       break;
   *     }
   *   }
   * });
   * // later
   * await listener.stop();
   */
  async contextEvents(onEvent: ContextEventHandler): Promise<ContextEvents> {
    const abort = new AbortController();
    let received!: () => void;
    const first = new Promise<void>((resolve) => {
      received = resolve;
    });
    const stream = this.client.streamContextEvents(
      create(StreamContextEventsRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
      { signal: abort.signal },
    );
    const listener = new ContextEvents({
      stream,
      onEvent,
      page: (id) => this.getPage(id),
      abort,
      onFirst: () => received(),
    });

    // A stream that dies before the snapshot would leave the wait hanging, so
    // race the two outcomes.
    const ended = listener.wait().then(() => {
      throw new BrowserScaleError(
        "browserscale.contextEvents: stream closed before the snapshot arrived",
      );
    });
    ended.catch(() => {}); // the loser of the race must not look unhandled
    await Promise.race([first, ended]);
    return listener;
  }

  /**
   * Reports what this session's browser has consumed so far.
   *
   * Everything but minMemory and averageMemory only ever grows, so polling and
   * diffing two readings gives the cost of what ran in between. The final
   * figures need no call of their own: {@link CloudBrowser.stopBrowser} resolves
   * with them.
   *
   * @returns SessionUsage as of now
   *
   * Rejects only on a transport failure - a dead session, a broken connection.
   * This call has no semantic failure of its own, so there are no error codes to
   * branch on.
   *
   * @example
   * const before = await browser.getUsage();
   * await page.navigate("https://example.com");
   * const after = await browser.getUsage();
   * console.log(`navigation cost ${after.cpuTime - before.cpuTime}s of CPU`);
   */
  async getUsage(): Promise<SessionUsage> {
    const resp = await this.client.getUsage(
      create(GetUsageRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("getUsage", resp.error);
    if (!resp.usage) {
      throw new BrowserScaleError("getUsage: the server sent no usage");
    }
    return sessionUsageFromProto(resp.usage);
  }

  // ──────────────────────────────────────────────────────────────────
  // Captcha auto-solve
  // ──────────────────────────────────────────────────────────────────

  /**
   * Makes the browser solve captchas as they appear, on every page, frame and
   * popup of the session, including ones opened later. Nothing has to call
   * {@link Page.solveCaptcha} or wait for a {@link captcha} condition.
   *
   * An action running on the page when a captcha appears
   * ({@link Page.click}, {@link Page.fill}, {@link Page.type},
   * {@link Page.dragBy}, {@link Page.dragTo}) is held at its next safe point
   * — between two keys, before the button goes down — and carries on after
   * the solve: a fill types the rest of its text, a click goes for its target
   * again. Its result lists the solve under `captchas`. An action started
   * while a solve runs waits for it. Time spent held does not count against
   * the action's timeout, nor against a {@link Page.wait}.
   * {@link Page.insertText}, {@link Page.pressKey} and
   * {@link Page.releaseKey} are refused with code `"busy"` while a solve runs.
   *
   * While a {@link Page.wait} with a {@link captcha} condition runs on a page,
   * auto-solve leaves that page's captchas alone, so the wait sees them first.
   *
   * Each solve is reported on {@link CloudBrowser.contextEvents}: a
   * `captchaDetected` and then exactly one `captchaResolved` with the same
   * `solveId`.
   *
   * Calling it again replaces the settings; solves already running keep the
   * ones they started with. Auto-solve lasts until
   * {@link CloudBrowser.disableCaptchaAutoSolve} or the end of the session.
   *
   * @param opts - settings; see {@link CaptchaAutoSolveOpts}. Omitted uses the
   *   defaults
   *
   * @throws {@link BrowserScaleError} - an `onFailure` or `unfocused` value
   *   other than the documented ones, or a negative number (rejected before
   *   anything is sent), or a transport failure
   *
   * @example
   * await browser.enableCaptchaAutoSolve({ unfocused: "focus" });
   * // A captcha that shows up during the fill is solved, then the fill
   * // carries on.
   * const res = await page.fill(css("#email"), "user@example.com");
   * if (res.captchas) console.log(`held by ${res.captchas.length} solve(s)`);
   */
  async enableCaptchaAutoSolve(opts?: CaptchaAutoSolveOpts): Promise<void> {
    const o = opts ?? {};
    if (o.onFailure !== undefined && o.onFailure !== "fail" && o.onFailure !== "continue") {
      throw new BrowserScaleError(
        `enableCaptchaAutoSolve: onFailure must be "fail" or "continue", got ${JSON.stringify(o.onFailure)}`,
      );
    }
    if (o.unfocused !== undefined && o.unfocused !== "wait" && o.unfocused !== "focus") {
      throw new BrowserScaleError(
        `enableCaptchaAutoSolve: unfocused must be "wait" or "focus", got ${JSON.stringify(o.unfocused)}`,
      );
    }
    for (const [name, v] of [
      ["solveTimeoutMs", o.solveTimeoutMs],
      ["retryAmount", o.retryAmount],
      ["maxSolvesPerMinute", o.maxSolvesPerMinute],
    ] as const) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0)) {
        throw new BrowserScaleError(
          `enableCaptchaAutoSolve: ${name} must be a non-negative integer, got ${v}`,
        );
      }
    }
    const req = create(EnableCaptchaAutoSolveRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
    });
    if (o.solveTimeoutMs) req.solveTimeoutMs = o.solveTimeoutMs;
    if (o.retryAmount) req.retryAmount = o.retryAmount;
    if (o.onFailure) req.onFailure = o.onFailure;
    if (o.unfocused) req.unfocused = o.unfocused;
    if (o.maxSolvesPerMinute) req.maxSolvesPerMinute = o.maxSolvesPerMinute;
    const resp = await this.client.enableCaptchaAutoSolve(req);
    throwCommandError("enableCaptchaAutoSolve", resp.error);
  }

  /**
   * Stops {@link CloudBrowser.enableCaptchaAutoSolve}. A solve already
   * running finishes; one waiting for the focus is resolved with code
   * `"disabled"`.
   *
   * @returns whether auto-solve was enabled
   *
   * Rejects only on a transport failure: disabling without auto-solve is a
   * no-op.
   *
   * @example
   * await browser.disableCaptchaAutoSolve();
   */
  async disableCaptchaAutoSolve(): Promise<boolean> {
    const resp = await this.client.disableCaptchaAutoSolve(
      create(DisableCaptchaAutoSolveRequestSchema, {
        sessionId: this.sessionId,
        apiKey: this.apiKey,
      }),
    );
    throwCommandError("disableCaptchaAutoSolve", resp.error);
    return resp.disabled;
  }

  // ──────────────────────────────────────────────────────────────────
  // Reactions
  // ──────────────────────────────────────────────────────────────────

  /**
   * Registers a one-shot reaction for every page of the browser: it is armed
   * on the pages open now and on every page that opens later — tabs, popups,
   * pages you create — and fires once on each. Use it for the interruptions
   * a site shows wherever you are on it, such as a consent banner. Otherwise
   * it behaves exactly like {@link Page.addReaction}.
   *
   * The reaction stays registered until you remove it or the session ends;
   * {@link CloudBrowser.listReactions} lists it, and
   * {@link Page.listReactions} lists it on each page where it has not fired
   * yet. Every click is reported as a `reactionFired` event on
   * {@link CloudBrowser.contextEvents}, carrying the page it fired on.
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
   * // Accept the consent banner on whichever page it shows up.
   * const id = await browser.addReaction(css("button#accept").inAllFrames());
   */
  async addReaction(match: Locator, opts?: ReactionOpts): Promise<string> {
    return addReaction(this.reactionScope(), match, opts);
  }

  /**
   * Removes a reaction by id, wherever it is pending: a reaction from
   * {@link CloudBrowser.addReaction} stops for every page, including the ones
   * that open later. Returns `false` if no reaction with this id was pending
   * anywhere.
   *
   * @param reactionId - id returned by {@link CloudBrowser.addReaction} or
   *   {@link Page.addReaction}
   *
   * @returns true if a pending reaction with this id existed and was removed
   *
   * Removing an id that is not registered is a no-op rather than an error.
   * Rejects only on a transport failure.
   *
   * @example
   * const removed = await browser.removeReaction(id);
   */
  async removeReaction(reactionId: string): Promise<boolean> {
    return removeReaction(this.reactionScope(), reactionId);
  }

  /**
   * Returns the reactions registered with {@link CloudBrowser.addReaction}
   * that have not been removed. Each stays listed while it fires on page
   * after page; {@link Page.listReactions} shows where it is still pending.
   *
   * @returns the reactions registered for every page
   *
   * Rejects only on a transport failure. This call has no semantic failure of
   * its own, so there are no error codes to branch on.
   *
   * @example
   * for (const r of await browser.listReactions()) console.log(r.reactionId);
   */
  async listReactions(): Promise<ReactionInfo[]> {
    return listReactions(this.reactionScope());
  }

  private reactionScope(): ReactionScope {
    return { client: this.client, sessionId: this.sessionId, apiKey: this.apiKey, pageId: "" };
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
   *   await page.navigate("https://example.com");
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
   * Reads a whole captured body: an exchange's `requestBodyId` or
   * `responseBodyId`.
   *
   * Bodies are stored by the browser, not sent with the exchange, so reading
   * one is a separate call. They stay readable after the capture stops, until
   * the session ends.
   *
   * The body is fetched in ranges and assembled in memory. For very large
   * bodies, use {@link CloudBrowser.readNetworkBodyRange} to process them piece
   * by piece.
   *
   * @param bodyId - `requestBodyId` or `responseBodyId` from a NetworkExchange
   *
   * @returns the body and whether the kept body is shorter than the original
   *
   * @throws not_found - no body with this id was kept in this session
   * @throws evicted - the body was dropped to stay within the session's storage
   *   quota; read bodies sooner, or narrow bodyPatterns
   * @throws unavailable - the body could not be stored or read back
   *
   * @example
   * const capture = await browser.captureNetwork(
   *   { patterns: ["*\/api/*"], bodies: "text" },
   *   (ex) => {
   *     if (!ex.responseBodyId) return;
   *     void browser.readNetworkBody(ex.responseBodyId).then(({ data }) =>
   *       console.log(ex.url, new TextDecoder().decode(data)),
   *     );
   *   },
   * );
   */
  async readNetworkBody(bodyId: string): Promise<NetworkBody> {
    const parts: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      const r = await this.readNetworkBodyRange(bodyId, offset);
      parts.push(r.data);
      offset += r.data.length;
      if (r.data.length === 0 || offset >= r.totalSize) {
        if (parts.length === 1) return { data: r.data, truncated: r.truncated };
        const data = new Uint8Array(offset);
        let at = 0;
        for (const p of parts) {
          data.set(p, at);
          at += p.length;
        }
        return { data, truncated: r.truncated };
      }
    }
  }

  /**
   * Reads up to `length` bytes of a captured body starting at `offset`.
   *
   * A single call returns at most 2 MiB; omit `length` to read that much. Loop
   * on `offset + data.length` until it reaches `totalSize` to stream a large
   * body.
   *
   * @param bodyId - `requestBodyId` or `responseBodyId` from a NetworkExchange
   * @param offset - first byte to read (default 0)
   * @param length - bytes to read (default and maximum 2 MiB)
   *
   * @returns NetworkBodyRange with the bytes and the body's total size
   *
   * @inheritDoc CloudBrowser.readNetworkBody
   */
  async readNetworkBodyRange(
    bodyId: string,
    offset?: number,
    length?: number,
  ): Promise<NetworkBodyRange> {
    if (!bodyId) {
      throw new BrowserScaleError("browserscale.readNetworkBody: bodyId must not be empty");
    }
    const req = create(GetNetworkBodyRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
      bodyId,
    });
    if (offset && offset > 0) req.offset = BigInt(Math.floor(offset));
    if (length && length > 0) req.length = BigInt(Math.floor(length));
    const resp = await this.client.getNetworkBody(req);
    throwCommandError("getNetworkBody", resp.error);
    return {
      data: resp.data,
      totalSize: Number(resp.totalSize),
      truncated: resp.truncated,
    };
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
  // Client identity
  // ──────────────────────────────────────────────────────────────────

  /**
   * Returns the session's client identity in one call: the User-Agent, the
   * full UA client-hint set, the Accept-Language and the session's proxy — so
   * an out-of-browser HTTP client can continue the session with matching
   * request headers through the same proxy. With `withCookies` / `withStorage`
   * the cookies and localStorage are folded into the same response.
   *
   * The context configuration is read directly in the browser process, so no
   * page needs to be open.
   *
   * @param opts - optionally fold in cookies / storage
   *
   * @returns the session's {@link ClientIdentity}
   *
   * Rejects only on a transport failure - a dead session, a page that is gone,
   * a broken connection. This call has no semantic failure of its own, so there
   * are no error codes to branch on.
   *
   * @example
   * const id = await browser.getClientIdentity({ withCookies: true });
   * console.log(id.userAgent, id.proxy.host, id.cookies?.length);
   */
  async getClientIdentity(opts: ClientIdentityOptions = {}): Promise<ClientIdentity> {
    const req = create(GetClientIdentityRequestSchema, {
      sessionId: this.sessionId,
      apiKey: this.apiKey,
    });
    if (opts.withCookies) req.includeCookies = true;
    if (opts.withStorage || opts.storageOrigin) req.includeStorage = true;
    if (opts.storageOrigin) req.storageOrigin = opts.storageOrigin;
    const resp = await this.client.getClientIdentity(req);
    throwCommandError("getClientIdentity", resp.error);
    return clientIdentityFromProto(resp);
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
   * await page.navigate("https://mail.google.com");
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
  // Live streaming (WebRTC)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Returns the ICE servers (TURN URL + short-lived credentials) to put in
   * your `RTCPeerConnection` BEFORE creating the offer, so it can gather relay
   * candidates.
   *
   * Live streaming is a two-step, client-offerer handshake: call
   * `getStreamConfig`, build your peer with the returned servers, create an
   * offer, then pass its SDP to {@link CloudBrowser.startStream} and apply the
   * answer.
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
   * Answers your WebRTC SDP offer and starts streaming the session as a video
   * track. The browser is the answerer; you are the offerer (see
   * {@link CloudBrowser.getStreamConfig} for the credentials to build the offer).
   *
   * The stream shows the page that has the focus and follows it: when a tab or
   * popup comes to the front, or {@link Page.focus} brings another page
   * forward, picture and input move there and the new viewport arrives as
   * `{"type":"viewport","width":W,"height":H}` on the reliable `input`
   * channel. While the shown page closes, the last picture stays until the
   * next page is shown; the stream keeps running.
   *
   * @param offerSdp - your `RTCPeerConnection`'s SDP offer
   *
   * @returns the SDP answer to apply as the remote description, plus the
   *   viewport to map input coordinates into
   *
   * @throws {@link NoPageError} - the browser has no page to show yet;
   *   {@link createPage} opens the first
   * @throws already_active - the session already has a stream; stop it before
   *   starting another
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
   * Tears down the session's live video stream. Safe to call even if no
   * stream is running.
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
}

/**
 * Turns the server's PAGE_CLOSED status into a {@link PageClosedError} and its
 * NO_PAGE status into a {@link NoPageError} for every unary call. Server
 * streams pass through untouched.
 */
function withPageClosed(client: BrowserRpcClient, page: (id: string) => Page): BrowserRpcClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const member: unknown = Reflect.get(target, prop, receiver);
      if (typeof member !== "function") return member;
      return (req: { pageId?: string } | undefined, ...rest: unknown[]) => {
        const out: unknown = member.call(target, req, ...rest);
        if (!(out instanceof Promise)) return out;
        return out.catch((e: unknown) => {
          throw pageClosedFrom(e, req?.pageId ?? "", page) ?? noPageFrom(e) ?? e;
        });
      };
    },
  });
}
