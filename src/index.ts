import { createGrpcTransport } from "@connectrpc/connect-node";
import { CloudBrowser } from "./client.ts";
import { BrowserConfig } from "./config.ts";
import type { RentResponse } from "./types.ts";

// Public API ──────────────────────────────────────────────────────────

export { CloudBrowser } from "./client.ts";
export { BrowserConfig } from "./config.ts";

// Locator + constructors + AllFrames sentinel
export { Locator, css, js, node, at, AllFrames } from "./locator.ts";

// Defaults the SDK applies before sending a request
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
  IceServer,
  StreamAnswer,
  ReactionInfo,
} from "./types.ts";

// Option bags
export type {
  Button,
  ClickAction,
  ClickOpts,
  FillOpts,
  ReactionOpts,
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

// Rent / stop ──────────────────────────────────────────────────────────

let apiEndpoint = "https://api.browserscale.cloud";

/**
 * Overrides the HTTP rent/stop endpoint.
 *
 * Defaults to `https://api.browserscale.cloud`. Call this before any
 * {@link rentBrowser} / {@link stopBrowser} call if you need to point at a
 * private browserscale deployment.
 *
 * @param endpoint - base URL of the rent/stop service, with no trailing slash
 *
 * @example
 * setApiEndpoint("https://browserscale.internal.example.com");
 */
export function setApiEndpoint(endpoint: string): void {
  apiEndpoint = endpoint;
}

/**
 * Rents a new browser session and returns a connected handle.
 *
 * Calls the browserscale rent endpoint with the supplied {@link BrowserConfig},
 * opens a gRPC connection to the assigned session host, and returns a
 * ready-to-use {@link CloudBrowser}. Closing the returned handle (via
 * {@link CloudBrowser.stopBrowser}) also releases the rental.
 *
 * @param config - rental parameters
 *
 * @returns CloudBrowser ready to drive the rented session
 *
 * @throws UNKNOWN_ERROR - the rent API rejected the request or the gRPC
 *   connection could not be established
 *
 * @example
 * const cfg = new BrowserConfig("sk_…", 600, "", 0, "", "");
 * const browser = await rentBrowser(cfg);
 * try {
 *   await browser.navigate("https://example.com");
 * } finally {
 *   await browser.stopBrowser();
 * }
 */
export async function rentBrowser(config: BrowserConfig): Promise<CloudBrowser> {
  const rentResp = await callRentApi(config);

  const transport = createGrpcTransport({
    baseUrl: grpcBaseUrl(rentResp.grpcUrl),
  });

  return new CloudBrowser(transport, rentResp.sessionId, config.apiKey, rentResp.fingerprint, async () => {
    await callStopApi(config.apiKey, rentResp.sessionId);
  });
}

/**
 * Attaches to an already-rented session over a fresh gRPC connection.
 *
 * Useful when a session id (and its gRPC URL) was persisted across processes
 * and you want to drive it again without renting a new one. Mirrors
 * browserscale-go's `ConnectSession`. Closing the returned handle via
 * {@link CloudBrowser.stopBrowser} releases the rental (calls the stop
 * endpoint) and closes the transport.
 *
 * @param grpcUrl - session host gRPC URL from the original rent (grpc:// or grpcs://)
 * @param apiKey - API key the session was rented with
 * @param sessionId - id of the existing session
 *
 * @returns CloudBrowser attached to the existing session
 *
 * @example
 * const browser = connectSession(grpcUrl, apiKey, sessionId);
 * try {
 *   await browser.navigate("https://example.com");
 * } finally {
 *   await browser.stopBrowser();
 * }
 */
export function connectSession(
  grpcUrl: string,
  apiKey: string,
  sessionId: string,
): CloudBrowser {
  const transport = createGrpcTransport({ baseUrl: grpcBaseUrl(grpcUrl) });
  return new CloudBrowser(transport, sessionId, apiKey, "", async () => {
    await callStopApi(apiKey, sessionId);
  });
}

/**
 * Releases a session without needing a {@link CloudBrowser} handle.
 *
 * Useful when a session id was persisted across processes and the rental
 * outlived the original handle. Only calls the rent stop endpoint; there
 * is no gRPC connection to close in this form.
 *
 * @param apiKey - API key the session was rented with
 * @param sessionId - id of the session to release
 *
 * @throws UNKNOWN_ERROR - the stop API rejected the request
 *
 * @example
 * await stopBrowser(apiKey, sessionId);
 */
export async function stopBrowser(apiKey: string, sessionId: string): Promise<void> {
  await callStopApi(apiKey, sessionId);
}

// Maps the rent response's gRPC URL to a transport base URL. The scheme
// signals transport security: grpcs:// dials TLS, grpc:// (or no scheme,
// for older servers) dials plaintext.
function grpcBaseUrl(grpcUrl: string): string {
  if (grpcUrl.startsWith("grpcs://")) return `https://${grpcUrl.slice("grpcs://".length)}`;
  if (grpcUrl.startsWith("grpc://")) return `http://${grpcUrl.slice("grpc://".length)}`;
  return `http://${grpcUrl}`;
}

// --- Internal HTTP helpers (rent/stop are always REST) ---

async function callRentApi(config: BrowserConfig): Promise<RentResponse> {
  const body: Record<string, unknown> = {
    apiKey: config.apiKey,
    rentDuration: config.rentDuration,
    proxyHost: config.proxyHost,
    proxyPort: config.proxyPort,
    proxyUsername: config.proxyUsername,
    proxyPassword: config.proxyPassword,
  };
  if (config.countryCode) body.countryCode = config.countryCode;
  if (config.timezone) body.timezone = config.timezone;
  if (config.fingerprint) body.fingerprint = config.fingerprint;

  const resp = await fetch(`${apiEndpoint}/rent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json() as Record<string, unknown>;
  if (!resp.ok || !data.success) {
    throw new Error(`rent failed: ${data.error ?? resp.statusText}`);
  }

  return {
    sessionId: data.sessionId as string,
    grpcUrl: data.grpcUrl as string,
    countryCode: (data.countryCode as string) ?? "",
    timezone: (data.timezone as string) ?? "",
    acceptLanguage: (data.acceptLanguage as string) ?? "",
    fingerprint: (data.fingerprint as string) ?? "",
  };
}

async function callStopApi(apiKey: string, sessionId: string): Promise<void> {
  const resp = await fetch(`${apiEndpoint}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, apiKey }),
  });

  const data = await resp.json() as Record<string, unknown>;
  if (!resp.ok || !data.success) {
    throw new Error(`stop failed: ${data.error ?? resp.statusText}`);
  }
}
