/**
 * BrowserScaleError is the single error type thrown by all SDK methods. It wraps
 * either:
 *   - a client-side validation failure (bad locator, missing patterns, …)
 *   - a server-side gRPC error (Connect's ConnectError, available as `cause`)
 *
 * Catch it with `instanceof BrowserScaleError`:
 *
 *   try {
 *     await browser.click(css("#btn"));
 *   } catch (e) {
 *     if (e instanceof BrowserScaleError) { ... }
 *   }
 */
export class BrowserScaleError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BrowserScaleError";
  }
}
