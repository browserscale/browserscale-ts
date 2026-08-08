// Plain user-facing types. These mirror browserscale-go/types.go field-for-field;
// only naming convention differs (camelCase here, PascalCase in Go).

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

/** PageInfo describes an open page (tab or popup) inside a browser context. */
export interface PageInfo {
  pageId: string;
  browserContextId: string;
  url: string;
  title: string;
  viewport: Rect;
  frameTree: FrameInfo;
}

/** Header is a single HTTP header (name/value pair) on an intercepted request or response. */
export interface Header {
  name: string;
  value: string;
}

/**
 * InterceptedRequest describes an outgoing request captured by
 * {@link CloudBrowser.waitForAnyRequest}.
 */
export interface InterceptedRequest {
  method: string;
  url: string;
  headers: Header[];
  body: string;
  resourceType: string;
}

/**
 * InterceptedResponse describes a network response captured by
 * {@link CloudBrowser.waitForAnyResponse}.
 */
export interface InterceptedResponse {
  url: string;
  statusCode: number;
  headers: Header[];
  body: string;
}

/**
 * WaitResult is the outcome of a {@link CloudBrowser.wait} /
 * {@link CloudBrowser.waitForAny} call: which condition matched (index, in
 * argument order) and where the matched element lives.
 */
export interface WaitResult {
  index: number;
  frameId: string;
  backendNodeId: number;
  isVisible: boolean;
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
 * {@link WaitError} when a {@link CloudBrowser.wait} times out: one entry per
 * condition (in the order they were passed) explaining why it never matched.
 */
export interface WaitConditionStatus {
  /** Index into the condition list this entry describes. */
  index: number;
  /**
   * Last observed state: `"not_found"`, `"found_hidden"`, `"found_occluded"`
   * (only when the condition required visibility), or `"pending_steady"`.
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

/** NavigateResult reports where a {@link CloudBrowser.navigate} call ended up after redirects. */
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
  value: T;
  backendNodeId: number;
  isVisible: boolean;
  bounds: Rect;
}

/**
 * ElementResult is the outcome of an element interaction such as
 * {@link CloudBrowser.click}, {@link CloudBrowser.fill} or
 * {@link CloudBrowser.scrollTo}: the resolved element plus the
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
}

/**
 * DragResult is the outcome of a {@link CloudBrowser.drag} gesture: the
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
}

/** SelectOptionResult reports which option a selectByXxx call ended up selecting. */
export interface SelectOptionResult {
  selectedIndex: number;
  selectedValue: string;
  selectedText: string;
}

/**
 * ObservationResult is the compact page snapshot returned by
 * {@link CloudBrowser.getObservation} — the visible, interactive elements
 * rendered as prompt-friendly text and as JSON.
 */
export interface ObservationResult {
  text: string;
  json: string;
}

/**
 * ScreenshotResult is a single captured image of the page, returned by
 * {@link CloudBrowser.screenshot}. `dataBase64` holds the encoded image bytes
 * (PNG by default); `width` and `height` are in physical pixels.
 */
export interface ScreenshotResult {
  dataBase64: string;
  width: number;
  height: number;
}

/**
 * ReadCanvasResult is the pixel readback of a <canvas>, returned by
 * {@link CloudBrowser.readCanvas}. `dataBase64` holds the encoded image bytes
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
 * {@link CloudBrowser.getDOM}, plus its sha256[:8] hash for cheap
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
 * ReactionInfo describes a still-pending reaction, as returned by
 * {@link CloudBrowser.listReactions}. One-shot reactions that have already
 * fired are gone and never appear here.
 */
export interface ReactionInfo {
  /** Stable id assigned by {@link CloudBrowser.addReaction} (pass to removeReaction). */
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
}
