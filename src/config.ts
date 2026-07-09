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
}
