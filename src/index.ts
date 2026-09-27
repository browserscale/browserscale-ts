import { createGrpcTransport } from "@connectrpc/connect-node";
import { CloudBrowser } from "./client.ts";
import { BrowserConfig } from "./config.ts";
import type { BrowserInfo, RentResponse } from "./types.ts";

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
  BrowserInfo,
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

/**
 * Reports the sessions an API key currently holds.
 *
 * Use it to recover session ids the process lost — after a restart, or from a
 * different machine entirely. Without it a rental is only reachable through the
 * handle that created it, so a crash between rent and stop leaves a paid session
 * running with nothing able to name it.
 *
 * Each entry carries the `grpcUrl` it is driven from, so a listed session can be
 * handed straight to {@link connectSession}. Only live sessions are listed; a
 * stopped one is gone, not reported as ended.
 *
 * @param apiKey - API key whose sessions to list
 *
 * @returns the running sessions, oldest first; empty when the key holds none
 *
 * @throws UNKNOWN_ERROR - the list API rejected the request
 *
 * @example
 * const browsers = await listBrowsers(apiKey);
 * for (const b of browsers) console.log(b.sessionId, b.countryCode);
 *
 * // and to drive one of them
 * const browser = connectSession(browsers[0].grpcUrl, apiKey, browsers[0].sessionId);
 */
export async function listBrowsers(apiKey: string): Promise<BrowserInfo[]> {
  const resp = await fetch(`${apiEndpoint}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });

  // Named explicitly, because this is the one endpoint a caller can reach on a
  // deployment that does not have it: listing came after rent and stop. Letting
  // it fall through would report a JSON parse failure against an error page,
  // which says nothing about the actual problem.
  if (resp.status === 404) {
    throw new Error(`the API at ${apiEndpoint} does not support listing sessions`);
  }

  const data = await resp.json() as Record<string, unknown>;
  if (!resp.ok || !data.success) {
    throw new Error(`list failed: ${data.error ?? resp.statusText}`);
  }

  const sessions = (data.sessions ?? []) as Record<string, unknown>[];
  return sessions.map((s) => ({
    sessionId: s.sessionId as string,
    grpcUrl: (s.grpcUrl as string) ?? "",
    startTime: (s.startTime as number) ?? 0,
    rentDuration: (s.rentDuration as number) ?? 0,
    remainingSeconds: s.remainingSeconds as number | undefined,
    countryCode: (s.countryCode as string) ?? "",
    timezone: (s.timezone as string) ?? "",
    proxyHost: (s.proxyHost as string) ?? "",
    publicIp: (s.publicIp as string) ?? "",
    gpuIndex: s.gpuIndex as number | undefined,
  }));
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
