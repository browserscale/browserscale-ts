/** DbscSession is one Device Bound Session Credentials entry. */
export interface DbscSession {
  /** Serialized schemeful site key, e.g. "https://google.com". */
  site: string;
  /**
   * Base64 of the serialized DBSC Session proto. It includes the wrapped
   * binding key, which is portable under WRC's software key provider.
   */
  session: string;
}

/**
 * AuthSession is a portable snapshot of a context's signed-in Google account
 * and/or DBSC sessions. Every field is optional, so a context that only has
 * DBSC sessions (no primary account) or only a sign-in (no DBSC) round-trips.
 *
 * Pair it with getCookies()/setCookies() and getStorage()/setStorage() to move
 * a whole persona between fresh contexts.
 */
export interface AuthSession {
  /** Gaia obfuscated account id. */
  gaiaId?: string;
  /** Account email. */
  email?: string;
  /** OAuth refresh token (persistent). */
  refreshToken?: string;
  /**
   * Base64 of the wrapped device-binding key for the refresh token. Absent
   * means the token is unbound.
   */
  wrappedBindingKey?: string;
  /** Signin-scoped device id; must travel with the token. */
  signinScopedDeviceId?: string;
  /** True if the account should be restored at Sync consent. */
  syncConsent?: boolean;
  /** Device Bound Session Credentials for this context (all bound sites). */
  dbscSessions?: DbscSession[];
}
