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
