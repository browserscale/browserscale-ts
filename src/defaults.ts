// Defaults the SDK applies automatically before sending a request. Any
// field not listed here is left unset on the wire and follows the browserscale API's
// server-side default.

/**
 * Default timeout (ms) used by wait() / waitAny() when no opts.timeoutMs
 * is passed.
 */
export const DefaultWaitTimeoutMs = 30_000;

/**
 * Default visibility flag baked into css(...) and js(...). For JS
 * expressions returning a non-Element value (boolean, string, number,
 * plain object) this flag is a no-op. Use .visible(false) on the returned
 * Locator to opt out.
 */
export const DefaultVisible = true;

/**
 * Default steady-time (ms) baked into css(...) and js(...). For JS
 * expressions returning a non-Element value this is a no-op. Use
 * .steady(ms) (or .steady(0) to disable) on the returned Locator to
 * override.
 */
export const DefaultSteadyMs = 500;
