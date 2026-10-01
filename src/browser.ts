import { CloudBrowser } from "./client.ts";
import { WebSocketTransport } from "./ws-transport.ts";

// Public API — browser entry point ────────────────────────────────────

export { CloudBrowser } from "./client.ts";
export { WebSocketTransport } from "./ws-transport.ts";
export { BrowserConfig } from "./config.ts";

// Locator + constructors + AllFrames sentinel
export { Locator, css, js, node, at, AllFrames } from "./locator.ts";

// Server-side defaults, re-exported for reference only (all deprecated)
export {
  DefaultWaitTimeoutMs,
  DefaultVisible,
  DefaultSteadyMs,
} from "./defaults.ts";

// Errors — base class plus the typed semantic-failure subclasses
export {
  BrowserScaleError,
  ClickError,
  FillError,
  DragError,
  ScrollError,
  MoveError,
  SelectOptionError,
  WaitError,
} from "./errors.ts";

// Plain user-facing types
export type {
  Rect,
  FrameInfo,
  PageInfo,
  Header,
  InterceptedRequest,
  InterceptedResponse,
  NetworkExchange,
  NetworkResourceType,
  NetworkServedFrom,
  NetworkBodies,
  NetworkCaptureOptions,
  WaitResult,
  WaitConditionStatus,
  OccluderInfo,
  ElementRef,
  NavigateResult,
  EvaluateResult,
  ElementResult,
  DragResult,
  SelectOptionResult,
  ScreenshotResult,
  ReadCanvasResult,
  DOMResult,
  InspectResult,
  RentResponse,
  BrowserInfo,
  SessionUsage,
} from "./types.ts";

// Option bags
export type {
  Button,
  ClickAction,
  ClickOpts,
  FillOpts,
  SelectOpts,
  WaitOpts,
  WaitUntil,
  NavigateOpts,
  LoadHTMLOpts,
  GetDOMOpts,
  GetObservationOpts,
  ScreenshotOpts,
  ReadCanvasOpts,
} from "./options.ts";

// Network types
export {
  type RequestPattern,
  type HeaderModification,
  type HeaderModificationAction,
} from "./network.ts";

// Scripts (automation running inside the browser process)
export {
  ScriptRun,
  ScriptFollow,
  type ScriptEvent,
  type ScriptEventHandler,
  type ScriptFinished,
  type ScriptLogEntry,
  type ScriptResult,
  type ScriptRunInfo,
} from "./scripts.ts";

// Network capture (traffic log)
export { NetworkCapture, type NetworkExchangeHandler } from "./network-capture.ts";
export {
  DomMirror,
  type DomNode,
  type DomSnapshot,
  type DomMirrorOptions,
  type DomChangeHandler,
  type DomResyncHandler,
  type DomResyncReason,
} from "./dom-mirror.ts";

// Cookies
export type { CookieParam } from "./cookies.ts";

// Storage (localStorage)
export type { StorageItem, StorageOriginEntry } from "./storage.ts";

// Auth / DBSC (portable signed-in persona)
export type { AuthSession, DbscSession } from "./auth-session.ts";

// Browser-side factory functions ───────────────────────────────────────

/**
 * Attaches a {@link CloudBrowser} to an existing session over a raw
 * WebSocket transport.
 *
 * Use this from a browser context: the WebSocket transport framing is
 * defined by {@link WebSocketTransport} and is served directly by the
 * browserscale session host. The session must already exist server-side; unlike
 * {@link rentBrowser} this does not call the rent API. Closing the
 * returned handle (via {@link CloudBrowser.stopBrowser}) only closes the
 * transport — the rental stays alive.
 *
 * @param wsUrl - WebSocket URL (ws:// or wss://) of the session host
 * @param sessionId - id of the existing session
 * @param apiKey - API key authorizing access to the session
 * @param fingerprint - browser fingerprint id; empty if unknown
 *
 * @returns CloudBrowser attached to the existing session
 *
 * @example
 * const browser = createWebSocketBrowser(
 *   "wss://session-abc.browserscale.example.com/ws",
 *   sessionId,
 *   apiKey,
 * );
 * await browser.navigate("https://example.com");
 */
export function createWebSocketBrowser(
  wsUrl: string,
  sessionId: string,
  apiKey: string,
  fingerprint: string = "",
): CloudBrowser {
  const transport = new WebSocketTransport(wsUrl);
  return new CloudBrowser(transport, sessionId, apiKey, fingerprint);
}
