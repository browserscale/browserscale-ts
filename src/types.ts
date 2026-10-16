// Plain user-facing types. These mirror browserscale-go/types.go field-for-field;
// only naming convention differs (camelCase here, PascalCase in Go).

import type { Page } from "./page.ts";

/** Rect describes a position and size in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** FrameInfo describes a single frame within a page's frame tree. */
export interface FrameInfo {
  frameId: string;
  url: string;
  isOOPIF: boolean;
  hasJSContext: boolean;
  isLoading: boolean;
  isVisible: boolean;
  absoluteRect: Rect;
  relativeRect: Rect;
  children: FrameInfo[];
}

/**
 * PageInfo describes an open page (tab or popup) inside a browser context, as
 * {@link CloudBrowser.pages} found it.
 */
export interface PageInfo {
  /** The handle to act on the page. */
  page: Page;
  browserContextId: string;
  url: string;
  title: string;
  viewport: Rect;
  frameTree: FrameInfo;
  /**
   * Whether this is the page that has the focus; exactly one page has it. See
   * {@link CloudBrowser.focusedPage}.
   */
  isFocused: boolean;
  /**
   * Whether the page is a popup window (window.open with window features)
   * rather than a tab.
   */
  isPopup: boolean;
  /**
   * The page that opened this one, if it is still open. Also set for
   * rel=noopener, since the page still came from it.
   */
  opener?: Page;
  /**
   * The frame that opened this page, which may be a frame of `opener` other
   * than its main frame.
   */
  openerFrameId?: string;
}

/**
 * SessionUsage is what a session's browser has consumed since the session
 * started: the CPU time and memory of every process that rendered its pages —
 * main frames, cross-site iframes and the workers they host — including
 * processes that have since exited. Work done on the session's behalf in
 * processes it shares with other sessions is not included.
 *
 * {@link CloudBrowser.getUsage} reports it while the session runs, and
 * {@link CloudBrowser.stopBrowser} resolves with the final figures, so there is
 * no need to read it right before stopping.
 */
export interface SessionUsage {
  /** Real time since the session's browser was created, in seconds. */
  wallTime: number;
  /**
   * User plus kernel CPU time in seconds. Only time a thread actually ran on a
   * core counts; waiting and idling do not.
   */
  cpuTime: number;
  /**
   * The least memory the session held once its browser was ready, in bytes.
   * Sampled about once a second.
   */
  minMemory: number;
  /**
   * The memory held, averaged over wallTime, in bytes; averageMemory * wallTime
   * is the memory-time used. Sampled about once a second, so short spikes count
   * toward the peak but barely toward the average.
   */
  averageMemory: number;
  /** The most memory held at any one moment, in bytes. */
  peakMemory: number;
  /**
   * Renderer processes that hosted at least one of the session's frames: one
   * per site its pages and cross-site iframes needed.
   */
  renderersUsed: number;
  /** Child frames created in the session's pages, whether or not they got a process of their own. */
  framesCreated: number;
  /**
   * Bytes the session's pages, workers and service workers received over the
   * network: HTTP responses with their headers, as transferred (before
   * decompression), and WebSocket messages. Responses served from the
   * browser's cache count nothing. A download in progress is counted while it
   * runs, at most about a second behind.
   */
  bytesReceived: number;
  /**
   * Bytes they sent the same way: HTTP requests with headers and bodies, and
   * WebSocket messages.
   */
  bytesSent: number;
}

/** Header is a single HTTP header (name/value pair) on an intercepted request or response. */
export interface Header {
  name: string;
  value: string;
}

/**
 * InterceptedRequest describes an outgoing request captured by a
 * {@link request} wait condition or {@link CloudBrowser.waitForAnyRequest}.
 */
export interface InterceptedRequest {
  method: string;
  url: string;
  headers: Header[];
  body: string;
  resourceType: string;
}

/**
 * InterceptedResponse describes a network response captured by a
 * {@link response} wait condition or {@link CloudBrowser.waitForAnyResponse}.
 */
export interface InterceptedResponse {
  url: string;
  statusCode: number;
  headers: Header[];
  body: string;
}

/**
 * NetworkResourceType is the kind of load an exchange belongs to.
 *
 * Typed as a union with a `string` fallback so an exchange from a newer browser
 * still carries its value through instead of failing to type. Note that
 * `fetch()`, XMLHttpRequest and EventSource all report `"fetch"`: they are
 * indistinguishable at the capture point.
 */
export type NetworkResourceType =
  | "document"
  | "subframe"
  | "script"
  | "stylesheet"
  | "image"
  | "font"
  | "media"
  | "fetch"
  | "worker"
  | "manifest"
  | "object"
  | "csp-report"
  | "other"
  | (string & {});

/**
 * NetworkServedFrom says where an exchange's response came from.
 * `"wrcStaticCache"` is browserscale's own static cache — see
 * {@link CloudBrowser.setStaticPaths}.
 */
export type NetworkServedFrom =
  | "network"
  | "cache"
  | "serviceWorker"
  | "wrcStaticCache"
  | "wrcSynthetic"
  | (string & {});

/**
 * NetworkExchange is one request together with the response it received, as
 * reported by {@link CloudBrowser.captureNetwork}.
 *
 * A redirect chain arrives as one exchange per hop: the hops share `chainId` and
 * count up `redirectIndex`, so a 302 and the request it points at are two
 * exchanges, each with its own headers and status.
 */
export interface NetworkExchange {
  /** Unique per hop. */
  requestId: string;
  /** Shared by every hop of one redirect chain. */
  chainId: string;
  /** 0 for the original request, incremented once per redirect followed. */
  redirectIndex: number;
  /** The frame that issued the request; empty for worker traffic. */
  frameId: string;
  /**
   * Whether that frame runs in its own process. Capture happens in the browser
   * process, so cross-process iframes are included.
   */
  isOopif: boolean;
  resourceType: NetworkResourceType;

  method: string;
  url: string;
  /** The origin that started the request; empty when the browser itself did. */
  initiatorUrl: string;
  requestHeaders: Header[];
  /**
   * Whether requestHeaders are the bytes actually sent — Cookie, User-Agent and
   * Sec-* included — rather than what the page asked for before the network
   * stack filled in the rest.
   */
  requestHeadersAreWire: boolean;
  /**
   * Names the request body; read it with {@link CloudBrowser.readNetworkBody}.
   * Empty when the request had no body. Bodies never travel with the exchange.
   */
  requestBodyId: string;
  /** Bytes kept for the request body. */
  requestBodySize: number;
  /**
   * Part of the request body is missing: it hit the per-body cap, or it was a
   * file or streamed upload, which are not kept.
   */
  requestBodyTruncated: boolean;

  /** False when the request failed before any response arrived; see error. */
  hasResponse: boolean;
  statusCode: number;
  statusText: string;
  mimeType: string;
  /** Negotiated ALPN protocol, e.g. "h2" or "http/1.1". */
  protocol: string;
  remoteAddress: string;
  servedFrom: NetworkServedFrom;
  responseHeaders: Header[];
  responseHeadersAreWire: boolean;
  /**
   * Names the response body; read it with {@link CloudBrowser.readNetworkBody}.
   * Empty when body capture did not apply to this exchange — see
   * {@link NetworkCaptureOptions.bodies}.
   */
  responseBodyId: string;
  /** Bytes kept for the response body, after content decoding. */
  responseBodySize: number;
  /**
   * The kept body is shorter than the one the page received: it hit the
   * per-body cap or the load ended early.
   */
  responseBodyTruncated: boolean;

  /** Bytes on the wire, not body size; 0 for a response served from cache. */
  encodedDataLength: number;

  /** Net error name (e.g. "net::ERR_ABORTED"), empty on success. */
  error: string;
}

/** One range of a captured body, from {@link CloudBrowser.readNetworkBodyRange}. */
export interface NetworkBodyRange {
  /** The bytes read; empty past the end of the body. */
  data: Uint8Array;
  /** Bytes kept for the body as a whole. */
  totalSize: number;
  /** Matches the exchange's truncated flag for this body. */
  truncated: boolean;
}

/** A whole captured body, from {@link CloudBrowser.readNetworkBody}. */
export interface NetworkBody {
  data: Uint8Array;
  /** The kept body is shorter than the original; see the exchange's flag. */
  truncated: boolean;
}

/**
 * Which response bodies a network capture keeps. Kept bodies are not part of
 * the exchange; read them with {@link CloudBrowser.readNetworkBody}.
 */
export type NetworkBodies = "none" | "text" | "all";

/**
 * Configures {@link CloudBrowser.captureNetwork}.
 *
 * There is deliberately no byte-cap option: kept bodies are stored on a
 * machine shared with other sessions, so the server owns the quota. When a
 * session's bodies exceed it, the oldest are dropped first.
 */
export interface NetworkCaptureOptions {
  /**
   * URL wildcards to capture; omit to capture every request the session makes.
   * Prefix a pattern with "!" to exclude it, which is the short way to say
   * "everything except this".
   */
  patterns?: string[];
  /**
   * Response-body capture. `"text"` keeps bodies whose MIME type is textual,
   * `"all"` keeps every body, binary included. Defaults to `"none"`, headers
   * and status only. Request bodies are kept whenever a request has one.
   */
  bodies?: NetworkBodies;
  /**
   * Narrows body capture to a subset of the captured requests; omit to apply
   * bodies to all of them. Use it to log every request but only keep the
   * payloads you care about.
   */
  bodyPatterns?: string[];
}

/**
 * WaitResult is the outcome of a {@link Page.wait} / {@link Page.waitAny}
 * call: which condition matched (`index`, in argument order), what `kind` it
 * was, and what it matched. Narrow on `kind` to reach the payload:
 *
 *   const r = await page.waitAny([css("#done"), response("*\/api/token*")]);
 *   if (r.kind === "response") console.log(r.response.body);
 *
 * A timeout does not resolve: it throws {@link WaitError}.
 */
export type WaitResult =
  | WaitElementResult
  | WaitCaptchaResult
  | WaitRequestResult
  | WaitResponseResult;

/** The `kind` of a {@link WaitResult}. */
export type WaitKind = WaitResult["kind"];

interface WaitResultBase {
  /** Always true on a resolved wait; carried so every command reads the same way. */
  success: true;
  /** Index of the matched condition, in argument order. */
  index: number;
}

/** A {@link css} or {@link js} condition matched. */
export interface WaitElementResult extends WaitResultBase {
  kind: "element";
  element: WaitElement;
}

/**
 * A {@link captcha} condition matched. It carries no payload — solve it with
 * {@link Page.solveCaptcha}.
 */
export interface WaitCaptchaResult extends WaitResultBase {
  kind: "captcha";
}

/** A {@link request} condition matched. */
export interface WaitRequestResult extends WaitResultBase {
  kind: "request";
  request: InterceptedRequest;
}

/** A {@link response} condition matched. */
export interface WaitResponseResult extends WaitResultBase {
  kind: "response";
  response: InterceptedResponse;
}

/** The element a {@link css} or {@link js} wait condition matched. */
export interface WaitElement {
  /** The frame the element lives in. */
  frameId: string;
  /**
   * Addresses the element in later calls via {@link node}; 0 when a js()
   * expression matched with a truthy non-Element value.
   */
  backendNodeId: number;
  /** Whether the element was visible at the match. */
  isVisible: boolean;
  /** The element's rect in root-viewport CSS pixels. */
  bounds: Rect;
}

/**
 * OccluderInfo describes the element that intercepted a click — the element
 * sitting on top of the target at the intended click point. Coordinates are in
 * root-viewport CSS pixels. Populated on {@link ClickError} for occlusion
 * failures so the caller can locate and clear the blocker (e.g. find its close
 * button).
 */
export interface OccluderInfo {
  backendNodeId: number;
  frameId: string;
  tagName: string;
  id: string;
  className: string;
  text: string;
  bounds: Rect;
  /**
   * Computed pointer-events keyword (e.g. "auto", "none", "all"). Lets you tell
   * an invisible pass-through layer from one that genuinely swallows the click.
   */
  pointerEvents: string;
  /** Computed visibility keyword ("visible", "hidden", "collapse"). */
  visibility: string;
  /**
   * Computed opacity (0..1). 0 means visually invisible but it may still
   * intercept clicks depending on pointerEvents.
   */
  opacity: number;
  /** Computed effective z-index as a string ("0" when auto / not stacked). */
  zIndex: string;
  /**
   * True when the blocker intercepts clicks even while invisible (computed
   * pointer-events in {all, painted, fill, stroke}): a real click is swallowed
   * even at visibility:hidden / opacity:0. When false and the element is
   * invisible, a real click would fall through.
   */
  hittableWhileInvisible: boolean;
  /**
   * Computed position keyword. `"fixed"`/`"sticky"` means the blocker is pinned
   * (by itself or an ancestor) and stays put no matter where the pointer goes —
   * clear it by scrolling the target out from under it; ordinary overlays often
   * collapse once the pointer leaves.
   */
  position: string;
}

/**
 * ElementRef is a lightweight descriptor of an element — enough to identify it
 * (and decide what to do) without another DOM round-trip. It names the element
 * that stole focus in a {@link FillError} focus-loss failure.
 */
export interface ElementRef {
  backendNodeId: number;
  /** Upper-case tag name, e.g. "INPUT", "BUTTON", "DIV". */
  tagName: string;
  /** id attribute, if present. */
  id?: string;
  /** name attribute, if present. */
  name?: string;
  /** class attribute, if present. */
  className?: string;
  /** `<input>` type, if the element is an `<input>`. */
  inputType?: string;
  /** Whitespace-collapsed textContent/value snippet (max 120 chars). */
  text?: string;
  /**
   * Whether this element is itself an editable text sink (input / textarea /
   * contenteditable).
   */
  editable: boolean;
}

/**
 * WaitConditionStatus is the per-condition diagnostic carried by
 * {@link WaitError} when a {@link Page.wait} times out: one entry per
 * condition (in the order they were passed) explaining why it never matched.
 */
export interface WaitConditionStatus {
  /** Index into the condition list this entry describes. */
  index: number;
  /**
   * Last observed state: `"not_found"`, `"found_hidden"`, `"found_occluded"`
   * (only when the condition required visibility), `"pending_steady"`, or
   * `"not_seen"` for a {@link request} / {@link response} condition that never
   * saw a matching request.
   */
  state: string;
  /** backendNodeId last seen for this condition (0 if never found). */
  backendNodeId: number;
  /** frameId where it was last seen (empty if never found). */
  frameId: string;
  /** Whether it was CSS-visible at the last observation. */
  isVisible: boolean;
  /** Last known rect in root-viewport coordinates (undefined if never found). */
  bounds?: Rect;
  /** The intercepting element, present iff state === `"found_occluded"`. */
  occluder?: OccluderInfo;
}

/** NavigateResult reports where a {@link Page.navigate} call ended up after redirects. */
export interface NavigateResult {
  frameId: string;
  url: string;
}

/**
 * EvaluateResult carries the outcome of a JS evaluate call.
 *
 * If the expression returned a DOM element, backendNodeId/isVisible/bounds
 * are populated and value is null. Otherwise value holds the parsed JSON
 * value (string/number/boolean/array/object/null). On parse failure value
 * falls back to the raw server string so the caller is never empty-handed.
 *
 * The optional generic T types the .value field for convenience — this is
 * purely a TS hint, not a runtime guarantee.
 */
export interface EvaluateResult<T = unknown> {
  /**
   * False only when the expression never produced a value, which rejects the
   * call — so a resolved result always has this true. An expression that answers
   * falsy is a successful evaluation, so this does not mean "the answer was
   * false".
   */
  success: boolean;
  value: T;
  backendNodeId: number;
  isVisible: boolean;
  bounds: Rect;
}

/**
 * ElementResult is the outcome of an element interaction such as
 * {@link Page.click}, {@link Page.fill} or
 * {@link Page.scrollTo}: the resolved element plus the
 * root-relative coordinates the action was performed at.
 */
export interface ElementResult {
  success: boolean;
  frameId: string;
  backendNodeId: number;
  isVisible: boolean;
  bounds: Rect;
  rootX: number;
  rootY: number;
  /**
   * The captcha solves that held a {@link Page.click} or {@link Page.fill}
   * while it ran, in order (see {@link CloudBrowser.enableCaptchaAutoSolve}).
   * Absent if none did, and always absent for the other actions.
   */
  captchas?: CaptchaInterruption[];
}

/**
 * DragResult is the outcome of a {@link Page.dragBy} gesture: the
 * resolved source element and the start/end coordinates of the performed drag.
 */
export interface DragResult {
  success: boolean;
  frameId: string;
  backendNodeId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** The captcha solves that held the drag, in order. Absent if none did. */
  captchas?: CaptchaInterruption[];
}

/**
 * A captcha solve that held an action while it ran. Listed under `captchas`
 * in the action's result.
 */
export interface CaptchaInterruption {
  /** The solve's id, as in the `captchaDetected` / `captchaResolved` events. */
  solveId: string;
  /** Whether the challenge was solved. */
  success: boolean;
  /** How long the action was held, in milliseconds. */
  durationMs: number;
  /**
   * What the action did after the solve: `"resumed"` (it carried on in the
   * same document), `"restarted"` (the solve replaced the document, so it
   * started over), `"continued"` (the solve failed and the action carried on
   * anyway, see {@link CaptchaAutoSolveOpts.onFailure}) or `"failed"` (the
   * solve failed and the action ended with code `"captcha_failed"`).
   */
  outcome: "resumed" | "restarted" | "continued" | "failed";
}

/** Settings for {@link CloudBrowser.enableCaptchaAutoSolve}. Omitted fields use the server defaults. */
export interface CaptchaAutoSolveOpts {
  /** Budget for one solve, in milliseconds. Default 60000. */
  solveTimeoutMs?: number;
  /** Per-solve retry cap, as in {@link Page.solveCaptcha}. Default: the solver's own. */
  retryAmount?: number;
  /**
   * What an action held by a solve does when the solve fails: `"fail"`
   * (default) ends it with code `"captcha_failed"`, `"continue"` lets it carry
   * on as if the solve had succeeded.
   */
  onFailure?: "fail" | "continue";
  /**
   * What happens to a captcha on a page that does not have the focus. Input
   * only reaches the focused page, so it cannot be solved there as it is:
   * `"wait"` (default) reports it (state `"waiting_for_focus"`) and solves it
   * once the page has the focus, `"focus"` brings the page to the front and
   * solves it right away.
   */
  unfocused?: "wait" | "focus";
  /**
   * At most this many solves start per page within any 60 seconds. Further
   * captchas are reported as `"skipped"` and resolved with code
   * `"limit_reached"`. Protects against a page that keeps putting one up.
   * Default 5.
   */
  maxSolvesPerMinute?: number;
}

/** SelectOptionResult reports which option a selectByXxx call ended up selecting. */
export interface SelectOptionResult {
  selectedIndex: number;
  selectedValue: string;
  selectedText: string;
}

/**
 * ScreenshotResult is a single captured image of the page, returned by
 * {@link Page.screenshot}. `dataBase64` holds the encoded image bytes
 * (PNG by default); `width` and `height` are in physical pixels.
 */
export interface ScreenshotResult {
  dataBase64: string;
  width: number;
  height: number;
}

/**
 * ReadCanvasResult is the pixel readback of a <canvas>, returned by
 * {@link Page.readCanvas}. `dataBase64` holds the encoded image bytes
 * (PNG by default) or the raw RGBA buffer when `format` is `"rgba"`.
 * `originClean` reports whether the canvas was untainted (informational — the
 * read succeeds either way).
 */
export interface ReadCanvasResult {
  success: boolean;
  frameId: string;
  backendNodeId: number;
  dataBase64: string;
  width: number;
  height: number;
  originClean: boolean;
}

/**
 * DOMResult is the full-tree DOM snapshot returned by
 * {@link Page.getDOM}, plus its sha256[:8] hash for cheap
 * change detection.
 */
export interface DOMResult {
  hash: string;
  dom: string;
}

/**
 * InspectResult describes the topmost element hit at viewport-relative
 * (x, y). backendNodeId === 0 means nothing was found at that position.
 */
export interface InspectResult {
  backendNodeId: number;
  frameId: string;
  tagName: string;
  textContent: string;
  isVisible: boolean;
  bounds: Rect;
}

/** RentResponse is the result of renting a browser via the REST API. */
export interface RentResponse {
  sessionId: string;
  grpcUrl: string;
  countryCode: string;
  timezone: string;
  acceptLanguage: string;
  fingerprint: string;
}

/** BrowserInfo describes one running session, as `listBrowsers` reports it. */
export interface BrowserInfo {
  sessionId: string;
  /**
   * The endpoint this session is driven from — the same one rent returned. It is
   * what makes a listed id usable: pass it to `connectSession`.
   */
  grpcUrl: string;
  /** Unix seconds the session was rented at. */
  startTime: number;
  /** The rental length in seconds; 0 means unlimited. */
  rentDuration: number;
  /**
   * Seconds left on the rental, and undefined for an unlimited one — there is
   * nothing to count down.
   */
  remainingSeconds?: number;
  countryCode: string;
  timezone: string;
  proxyHost: string;
  /** The address the session egresses from. */
  publicIp: string;
  /**
   * The physical card the session renders on, and undefined on a
   * software-rendered host.
   */
  gpuIndex?: number;
}

/**
 * IceServer is one entry for a WebRTC `RTCPeerConnection`'s `iceServers`
 * config: a TURN (or STUN) URL plus the short-lived credentials to
 * authenticate with it. Pass these to your peer before creating the offer.
 */
export interface IceServer {
  /** ICE server URLs (e.g. `turn:relay.example.com:3478?transport=udp`). */
  urls: string[];
  /** Short-lived TURN REST username (empty for plain STUN). */
  username: string;
  /** Short-lived TURN REST credential (empty for plain STUN). */
  credential: string;
}

/**
 * StreamAnswer is what {@link CloudBrowser.startStream} replies with.
 */
export interface StreamAnswer {
  /** SDP answer to apply as your peer's remote description. */
  answerSdp: string;
  /**
   * The page's viewport in CSS pixels — the coordinate space its input
   * expects. The video may be displayed at any size, so map your pointer
   * positions into this space before sending them. It comes back with the
   * answer rather than from a separate {@link CloudBrowser.pages} so it
   * cannot race the stream or describe a different page, and the browser
   * pushes `{"type":"viewport","width":W,"height":H}` on the reliable "input"
   * data channel whenever it changes. Null against an older engine.
   */
  viewport: { width: number; height: number } | null;
}

/**
 * ReactionInfo describes a still-pending reaction, as returned by
 * {@link Page.listReactions} and {@link CloudBrowser.listReactions}.
 * One-shot reactions that have already fired are gone and never appear here.
 */
export interface ReactionInfo {
  /** Stable id assigned by {@link Page.addReaction} (pass to removeReaction). */
  reactionId: string;
  /** Set if the reaction matches by CSS selector. */
  matchSelector: string;
  /** Set if the reaction matches by JS expression. */
  matchJsExpression: string;
  /** Set if the click target differs from the matched element. */
  actionSelector: string;
  /** Set if the click target differs from the matched element. */
  actionJsExpression: string;
  /** Frame scope: `""` for the main frame, a specific frameId, or `AllFrames`. */
  frameId: string;
  /** Whether the match additionally requires the element to be visible. */
  visible: boolean;
  /**
   * Whether the reaction was registered for every page
   * ({@link CloudBrowser.addReaction}) rather than for one.
   */
  allPages: boolean;
}
