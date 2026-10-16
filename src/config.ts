/**
 * The protocol the browser speaks to its proxy. `"http"` (CONNECT) is the
 * default. A SOCKS5 proxy always resolves host names itself, so `"socks5"`
 * covers what is elsewhere called `socks5h`.
 */
export type ProxyScheme = "http" | "socks5";

/** Optional parts of a proxy beyond host, port and credentials. */
export interface ProxyOptions {
  /** The proxy's protocol; `"http"` when omitted. */
  scheme?: ProxyScheme;
  /**
   * A MASQUE proxy (`"host:port"`) that carries HTTP/3 with the proxy's
   * credentials. See {@link BrowserConfig.withMasque}.
   */
  masque?: string;
}

/**
 * Configuration for renting a browser session.
 * Create with the required parameters, then chain optional setters.
 *
 * @example
 * const config = new BrowserConfig("api-key", 300, "proxy.example.com", 8080, "user", "pass")
 *   .withCountryCode("DE")
 *   .withTimezone("Europe/Berlin");
 */
export class BrowserConfig {
  readonly apiKey: string;
  readonly rentDuration: number;
  readonly proxyHost: string;
  readonly proxyPort: number;
  readonly proxyUsername: string;
  readonly proxyPassword: string;

  private _countryCode?: string;
  private _timezone?: string;
  private _fingerprint?: string;
  private _proxyScheme?: ProxyScheme;
  private _masqueProxy?: string;

  constructor(
    apiKey: string,
    rentDuration: number,
    proxyHost: string,
    proxyPort: number,
    proxyUsername: string,
    proxyPassword: string,
  ) {
    this.apiKey = apiKey;
    this.rentDuration = rentDuration;
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.proxyUsername = proxyUsername;
    this.proxyPassword = proxyPassword;
  }

  /**
   * Sets the protocol of the proxy passed to the constructor. Without it
   * the proxy is an HTTP proxy.
   *
   * @param scheme - `"http"` or `"socks5"`
   *
   * @returns this BrowserConfig for chaining
   *
   * @example
   * new BrowserConfig(apiKey, 600, "proxy.example.com", 1080, "user", "pass").withProxyScheme("socks5");
   */
  withProxyScheme(scheme: ProxyScheme): BrowserConfig {
    this._proxyScheme = scheme;
    return this;
  }

  /**
   * Routes the session's HTTP/3 traffic through a MASQUE proxy
   * (CONNECT-UDP, RFC 9298), authenticated with the username and password
   * of the proxy passed to the constructor.
   *
   * The MASQUE proxy has to leave from the same exit IP as the proxy, so
   * the browser shows one address: the rental is refused when they differ.
   * Use credentials that keep their IP (a sticky session) where the
   * provider rotates. Without a MASQUE proxy, HTTP/3 falls back to the
   * proxy over TCP.
   *
   * @param hostPort - the MASQUE proxy as `"host:port"`
   *
   * @returns this BrowserConfig for chaining
   *
   * @example
   * new BrowserConfig(apiKey, 600, "proxy.example.com", 8080, "user", "pass").withMasque("masque.example.com:443");
   */
  withMasque(hostPort: string): BrowserConfig {
    this._masqueProxy = hostPort;
    return this;
  }

  /**
   * Sets the geo-IP country code for the rented session.
   *
   * Drives both the assigned exit-IP region and the locale defaults
   * (Accept-Language, timezone fallback) when those are not overridden
   * separately.
   *
   * @param countryCode - ISO-3166 country code (e.g. "DE", "US")
   *
   * @returns this BrowserConfig for chaining
   *
   * @example
   * new BrowserConfig(apiKey, 600, "", 0, "", "").withCountryCode("DE");
   */
  withCountryCode(countryCode: string): BrowserConfig {
    this._countryCode = countryCode;
    return this;
  }

  /**
   * Sets the IANA timezone for the rented session.
   *
   * @param timezone - IANA timezone (e.g. "Europe/Berlin")
   *
   * @returns this BrowserConfig for chaining
   *
   * @example
   * new BrowserConfig(apiKey, 600, "", 0, "", "").withTimezone("Europe/Berlin");
   */
  withTimezone(timezone: string): BrowserConfig {
    this._timezone = timezone;
    return this;
  }

  /**
   * Pins a specific browser fingerprint id for the session.
   *
   * When omitted the server picks a fingerprint based on the country
   * code. Pass a known id (e.g. one returned by a previous rental) to
   * keep fingerprints stable across sessions.
   *
   * @param fingerprint - server-side fingerprint id
   *
   * @returns this BrowserConfig for chaining
   *
   * @example
   * new BrowserConfig(apiKey, 600, "", 0, "", "").withFingerprint("fp_abc123");
   */
  withFingerprint(fingerprint: string): BrowserConfig {
    this._fingerprint = fingerprint;
    return this;
  }

  get countryCode(): string | undefined {
    return this._countryCode;
  }

  get timezone(): string | undefined {
    return this._timezone;
  }

  get fingerprint(): string | undefined {
    return this._fingerprint;
  }

  get proxyScheme(): ProxyScheme | undefined {
    return this._proxyScheme;
  }

  get masqueProxy(): string | undefined {
    return this._masqueProxy;
  }
}
