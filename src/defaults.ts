// The SDK no longer applies its own defaults: every optional field is left
// unset on the wire and the browserscale API supplies the default, so there is
// one place that defines them. The constants below record the current
// server-side values for reference and are kept only for compatibility.

/**
 * Timeout (ms) the API applies to wait() / waitAny() when no opts.timeoutMs
 * is passed.
 *
 * @deprecated The API owns this value; the SDK no longer sends it.
 */
export const DefaultWaitTimeoutMs = 30_000;

/**
 * Visibility requirement the API applies to a wait condition that does not set
 * one. Use .visible(false) on a Locator to wait for DOM presence alone.
 *
 * @deprecated The API owns this value; the SDK no longer sends it.
 */
export const DefaultVisible = true;

/**
 * Steady-time (ms) the API applies to a wait condition that does not set one.
 * Use .steady(0) on a Locator to match the instant the element is found.
 *
 * @deprecated The API owns this value; the SDK no longer sends it.
 */
export const DefaultSteadyMs = 500;
