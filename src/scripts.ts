import type { ScriptEvent as ScriptEventMessage, ScriptLogEntry as ScriptLogEntryMessage } from "./gen/wrc_pb.ts";
import { BrowserScaleError } from "./errors.ts";

/** One `console.*` call from a script. */
export interface ScriptLogEntry {
  /** `"info"`, `"warning"` or `"error"`, from console.log / .warn / .error. */
  level: string;
  /** The logged arguments, already stringified the way console does it. */
  message: string;
  /** When the script printed the line, stamped in the browser. */
  timestamp: Date;
}

/** The outcome of a blocking {@link CloudBrowser.runScript}. */
export interface ScriptResult {
  /**
   * False when the script failed to compile or threw; `result` then holds the
   * message.
   */
  success: boolean;
  /**
   * The return value as JSON, or `"undefined"` when the script returned
   * nothing. On failure it is the error message.
   */
  result: string;
  /**
   * Names the run. It arrives with the reply, so it is only useful after the
   * fact — to match up log lines a separate follower already saw.
   */
  runId: string;
  /** Everything the script printed, in order. */
  log: ScriptLogEntry[];
  /**
   * True when the script printed more than the reply holds, in which case `log`
   * is the tail of the output rather than all of it.
   */
  truncated: boolean;
}

/** How a run ended. */
export interface ScriptFinished {
  /**
   * False when the script failed to compile or threw; `result` then holds the
   * message.
   */
  success: boolean;
  /** The return value as JSON, or the error message. */
  result: string;
  /**
   * True when the run was cancelled, or the session went away under it, rather
   * than the script returning on its own.
   */
  stopped: boolean;
}

/** One run still in flight, as {@link CloudBrowser.listScriptRuns} reports it. */
export interface ScriptRunInfo {
  runId: string;
  /** How long the run has been going, in milliseconds. */
  runningMs: number;
}

/**
 * One item on a session's script event stream. Exactly one of `log` and
 * `finished` is set.
 */
export interface ScriptEvent {
  /** The run that produced this event. */
  runId: string;
  /** A console line the script printed. */
  log?: ScriptLogEntry;
  /** The end of the run. No further event for that run follows. */
  finished?: ScriptFinished;
}

/**
 * ScriptEventHandler is called once per script event.
 *
 * Calls are sequential and in the order the browser produced them, so a run's
 * last log line always arrives before its `finished`.
 *
 * Blocking here stalls delivery: the server buffers a bounded number of events
 * per reader and then drops its oldest, which {@link ScriptRun.dropped}
 * reports. Hand slow work to a queue of your own instead of awaiting it here.
 */
export type ScriptEventHandler = (event: ScriptEvent) => void;

/** @internal Converts one log entry off the wire. */
export function scriptLogEntryFromProto(e: ScriptLogEntryMessage): ScriptLogEntry {
  return {
    level: e.level,
    message: e.message,
    timestamp: new Date(Number(e.timestamp)),
  };
}

/**
 * @internal Converts one stream item, or returns null for an event carrying
 * neither variant — which a newer server could send and an older client should
 * ignore rather than report as an empty log line.
 */
export function scriptEventFromProto(event: ScriptEventMessage): ScriptEvent | null {
  const payload = event.event;
  if (payload.case === "log") {
    if (!payload.value.line) return null;
    return {
      runId: payload.value.runId,
      log: scriptLogEntryFromProto(payload.value.line),
    };
  }
  if (payload.case === "finished") {
    return {
      runId: payload.value.runId,
      finished: {
        success: payload.value.success,
        result: payload.value.result,
        stopped: payload.value.stopped,
      },
    };
  }
  return null;
}

/**
 * ScriptRun is a script running in the background, returned by
 * {@link CloudBrowser.startScript}. Its output is delivered to the handler
 * passed there; this handle exists to await the outcome and to cancel the run.
 */
export class ScriptRun {
  private readonly abort: AbortController;
  private readonly cancel: (runId: string) => Promise<unknown>;
  private readonly finished: Promise<void>;
  private readonly id: string;

  private ended!: () => void;
  private readonly endedPromise: Promise<void>;

  private detached = false;
  private failure: Error | null = null;
  private droppedCount = 0;
  private result: ScriptFinished | null = null;

  /** @internal Constructed by CloudBrowser; not part of the public API. */
  constructor(init: {
    runId: string;
    stream: AsyncIterable<ScriptEventMessage>;
    onEvent: ScriptEventHandler;
    cancel: (runId: string) => Promise<unknown>;
    abort: AbortController;
  }) {
    this.id = init.runId;
    this.abort = init.abort;
    this.cancel = init.cancel;
    this.endedPromise = new Promise<void>((resolve) => {
      this.ended = resolve;
    });
    this.finished = this.pump(init.stream, init.onEvent);
  }

  /**
   * The id the browser gave this run. Pass it to
   * {@link CloudBrowser.stopScripts} to cancel the run from elsewhere, or to
   * {@link CloudBrowser.followScript} to watch it from another tab.
   */
  get runId(): string {
    return this.id;
  }

  /**
   * Reads the stream and calls the handler for each event belonging to this
   * run. Filtering happens here rather than server-side because the
   * subscription had to exist before the run id did.
   *
   * It never rejects: a failure is recorded for {@link ScriptRun.error}
   * instead, so nothing surfaces as an unhandled rejection.
   */
  private async pump(
    stream: AsyncIterable<ScriptEventMessage>,
    onEvent: ScriptEventHandler,
  ): Promise<void> {
    try {
      for await (const message of stream) {
        if (message.dropped > 0n) {
          this.droppedCount = Number(message.dropped);
        }
        const event = scriptEventFromProto(message);
        if (!event || event.runId !== this.id) continue;
        onEvent(event);
        if (event.finished) {
          this.result = event.finished;
          this.ended();
          return;
        }
      }
    } catch (err) {
      // Cancelling is how stop() and detach() end the stream, so the resulting
      // error is expected rather than a failure worth reporting.
      if (!this.detached) {
        this.failure = err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      this.ended();
    }
  }

  /**
   * Why the stream ended: null while it is still open, and after a clean stop
   * or the session ending normally.
   */
  get error(): Error | null {
    return this.failure;
  }

  /**
   * How many events the server discarded because this reader fell behind.
   * Anything above zero means the log has holes: make the handler cheaper, or
   * have the script print less.
   */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Resolves once the run ends, with how it ended.
   *
   * A script that threw is an outcome, not an error: it resolves with
   * `success: false`. It rejects when the run's fate is unknown — the stream
   * broke or the session died before the script finished.
   *
   * @returns how the script ended
   *
   * Rejects only on a transport failure - the connection dying, or the run being
   * abandoned. A script that threw is a normal outcome and arrives in the result.
   */
  async wait(): Promise<ScriptFinished> {
    await this.endedPromise;
    if (this.result) return this.result;
    if (this.failure) throw this.failure;
    throw new BrowserScaleError(
      "browserscale.ScriptRun.wait: stream ended before the run did",
    );
  }

  /**
   * Cancels the run and detaches this reader. Idempotent, and safe to call from
   * a `finally`.
   *
   * A script that is executing is interrupted; one parked on an await unwinds
   * at its next operation in the page. Either way the handler sees a `finished`
   * with `stopped` set, unless the local reader is torn down first.
   *
   * Rejects only on a transport failure, and the local reader is detached
   * regardless. Cancelling a run that has already finished is a no-op.
   */
  async stop(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    try {
      await this.cancel(this.id);
    } finally {
      this.abort.abort();
      await this.finished;
    }
  }

  /**
   * Stops reading this run's output without cancelling the run. The script
   * keeps going with nobody watching, which is what makes a detached run
   * outlive the page that started it.
   */
  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    this.abort.abort();
    await this.finished;
  }
}

/**
 * ScriptFollow is a read-only view of script output, returned by
 * {@link CloudBrowser.followScript}.
 */
export class ScriptFollow {
  private readonly abort: AbortController;
  private readonly finished: Promise<void>;
  private stopped = false;
  private failure: Error | null = null;
  private droppedCount = 0;

  /** @internal Constructed by CloudBrowser; not part of the public API. */
  constructor(init: {
    stream: AsyncIterable<ScriptEventMessage>;
    onEvent: ScriptEventHandler;
    abort: AbortController;
  }) {
    this.abort = init.abort;
    this.finished = this.pump(init.stream, init.onEvent);
  }

  private async pump(
    stream: AsyncIterable<ScriptEventMessage>,
    onEvent: ScriptEventHandler,
  ): Promise<void> {
    try {
      for await (const message of stream) {
        if (message.dropped > 0n) {
          this.droppedCount = Number(message.dropped);
        }
        const event = scriptEventFromProto(message);
        if (event) onEvent(event);
      }
    } catch (err) {
      if (!this.stopped) {
        this.failure = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  /**
   * Why the subscription ended: null while it is still open and after a clean
   * stop.
   */
  get error(): Error | null {
    return this.failure;
  }

  /** How many events the server discarded because this reader fell behind. */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Resolves once the subscription ends — {@link ScriptFollow.stop}, a dead
   * session or a transport failure.
   *
   * @throws the transport failure that ended the subscription, if any
   */
  async wait(): Promise<void> {
    await this.finished;
    if (this.failure) throw this.failure;
  }

  /**
   * Ends the subscription. Idempotent, and safe to call from a `finally`. It
   * never cancels a run: other readers, and the script itself, are unaffected.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    await this.finished;
  }
}
