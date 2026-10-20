import type { CookieParam } from "./cookies.ts";
import type { StorageOriginEntry } from "./storage.ts";

/**
 * UaBrand is one brand/version pair of the User-Agent client hints. For
 * `brands` the version is the significant (major) version; for
 * `fullVersionList` the full version.
 */
export interface UaBrand {
  brand: string;
  version: string;
}

/**
 * ProxyConfig is the session's proxy as the browser uses it. An empty `host`
 * means a direct connection. `masque` is the HTTP/3 MASQUE proxy, if any.
 */
export interface ProxyConfig {
  scheme: string;
  host: string;
  port: number;
  username: string;
  password: string;
  masque: string;
}

/**
 * ClientIdentity is everything the browser reports about itself on the wire, so
 * an out-of-browser HTTP client can reproduce matching request headers: the
 * User-Agent, the full UA client-hint set, the Accept-Language, and the
 * session's proxy. `cookies` and `storage` are populated only when requested
 * via `withCookies` / `withStorage`.
 */
export interface ClientIdentity {
  userAgent: string;
  acceptLanguage: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  mobile: boolean;
  wow64: boolean;
  brands: UaBrand[];
  fullVersionList: UaBrand[];
  proxy: ProxyConfig;

  /** Set when getClientIdentity was called with `withCookies: true`. */
  cookies?: CookieParam[];
  /** Set when getClientIdentity was called with `withStorage: true`. */
  storage?: StorageOriginEntry[];
}

/** Options for {@link CloudBrowser.getClientIdentity}. */
export interface ClientIdentityOptions {
  /** Also return the session's cookies in `ClientIdentity.cookies`. */
  withCookies?: boolean;
  /** Also return the session's localStorage in `ClientIdentity.storage`. */
  withStorage?: boolean;
  /**
   * With `withStorage`, restrict to this origin (e.g. "https://example.com").
   * Omit to get all origins.
   */
  storageOrigin?: string;
}
