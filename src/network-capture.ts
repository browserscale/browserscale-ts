import type { NetworkExchangeEvent } from "./gen/wrc_pb.ts";
import { networkExchangeFromProto } from "./internal/convert.ts";
import type { NetworkExchange } from "./types.ts";

/**
 * NetworkExchangeHandler is called once per completed exchange.
 *
 * Calls are sequential and in the order the browser finished the requests, so
 * the hops of a redirect chain arrive in order.
 *
 * Blocking here stalls the capture: awaiting something slow means the server
 * keeps buffering, and once its per-reader bound is reached it drops the oldest
 * entries, which {@link NetworkCapture.dropped} reports. Hand slow work
 * (uploads, IndexedDB) to a queue of your own instead of awaiting it here.
 */
export type NetworkExchangeHandler = (exchange: NetworkExchange) => void;

/**
 * NetworkCapture is a running capture, returned by
 * {@link CloudBrowser.captureNetwork}. Exchanges are delivered to the handler
 * passed there; this handle only exists to stop the capture and to report how
 * it went.
 */
export class NetworkCapture {
  private readonly abort: AbortController;
  private readonly disarm: () => Promise<unknown>;
  private readonly finished: Promise<void>;
  private armed = false;
  private stopped = false;
  private failure: Error | null = null;
  private droppedCount = 0;

  /** @internal Constructed by CloudBrowser; not part of the public API. */
  constructor(init: {
    stream: AsyncIterable<NetworkExchangeEvent>;
    onExchange: NetworkExchangeHandler;
    disarm: () => Promise<unknown>;
    abort: AbortController;
  }) {
    this.abort = init.abort;
    this.disarm = init.disarm;
    this.finished = this.pump(init.stream, init.onExchange);
  }

  /**
   * @internal Marks the capture as armed by this handle, so stop() disarms it
   * server-side. Views that only attached to someone else's capture stay
   * unarmed and merely detach.
   */
  arm() {
    this.armed = true;
  }

  /**
   * Reads the stream and calls the handler for each exchange. It never rejects:
   * a failure is recorded for {@link NetworkCapture.error} instead, so nothing
   * surfaces as an unhandled rejection.
   */
  private async pump(
    stream: AsyncIterable<NetworkExchangeEvent>,
    onExchange: NetworkExchangeHandler,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        if (event.dropped > 0n) {
          this.droppedCount = Number(event.dropped);
        }
        if (!event.exchange) continue;
        onExchange(networkExchangeFromProto(event.exchange));
      }
    } catch (err) {
      // Cancelling is how stop() ends the stream, so the resulting error is
      // expected rather than a failure worth reporting.
      if (!this.stopped) {
        this.failure = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  /**
   * Why the capture ended: null while it is still running, and after a clean
   * stop or the session ending normally.
   */
  get error(): Error | null {
    return this.failure;
  }

  /**
   * How many exchanges the server discarded because this reader fell behind.
   * Anything above zero means the log has holes: make the handler cheaper,
   * narrow `patterns`, or stop capturing bodies.
   */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Resolves once the capture ends — {@link NetworkCapture.stop}, a dead
   * session or a transport failure.
   *
   * Use it to capture for as long as the session lives. It is not needed when
   * you drive the browser yourself and call stop when done.
   *
   * @throws the transport failure that ended the capture, if any
   */
  async wait(): Promise<void> {
    await this.finished;
    if (this.failure) throw this.failure;
  }

  /**
   * Ends the capture. Idempotent, and safe to call from a `finally`.
   *
   * Once it resolves the handler is no longer running, so data it collected is
   * complete. Views from {@link CloudBrowser.streamNetworkExchanges} only
   * detach — they never disarm a capture other readers may share.
   *
   * To stop from inside the handler, call
   * {@link CloudBrowser.stopNetworkCapture} instead: stop awaits the reader,
   * which cannot finish while the handler it called is still running.
   *
   * Rejects only on a transport failure, and the local reader is shut down
   * regardless. Disarming a capture that is not running is a no-op rather than a
   * failure, so there are no error codes to branch on.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.armed) await this.disarm();
    } finally {
      this.abort.abort();
      await this.finished;
    }
  }
}
