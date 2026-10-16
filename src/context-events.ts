import type { ContextEvent as ContextEventProto } from "./gen/wrc_pb.ts";
import { pageInfoFromProto } from "./internal/convert.ts";
import type { Page } from "./page.ts";
import type { CaptchaInterruption, PageInfo } from "./types.ts";

/**
 * One change to the browser's pages, or a captcha solve or a reaction's click
 * on one of them.
 * Applying the page events in order to the last snapshot gives the pages as
 * they are, without polling {@link CloudBrowser.pages}. An event can restate
 * what the snapshot before it already shows; each one sets state rather than
 * changing it, so applying it again is harmless.
 *
 * - `snapshot`: every page of the browser. It replaces whatever you hold. The
 *   first event is always one; another comes only if this listener fell so far
 *   behind that events had to be dropped.
 * - `pageOpened`: a tab or popup one of the pages opened, or one a call
 *   created. A page that takes the focus as it opens is followed by a
 *   `pageFocused`.
 * - `pageClosed`: `focusedPage` has the focus now. A `pageFocused` follows if
 *   the focus moved.
 * - `pageFocused`: `page` has the focus now.
 * - `pageUpdated`: `page` committed a navigation or set a title.
 * - `captchaDetected`: a captcha was found on `page`, by auto-solve
 *   ({@link CloudBrowser.enableCaptchaAutoSolve}) or by
 *   {@link Page.solveCaptcha}. Exactly one `captchaResolved` with the same
 *   `solveId` follows.
 * - `captchaResolved`: that solve ended.
 * - `reactionFired`: a reaction ({@link Page.addReaction},
 *   {@link CloudBrowser.addReaction}) matched on `page` and clicked, or tried
 *   to. A reaction registered for every page reports once per page it fires
 *   on.
 *
 * The captcha and reaction events are reports, not state: a listener that
 * fell so far behind that it got a new snapshot may have missed some.
 */
export type ContextEvent =
  | { kind: "snapshot"; pages: PageInfo[] }
  | { kind: "pageOpened"; page: Page; info: PageInfo }
  | { kind: "pageClosed"; page: Page; focusedPage: Page }
  | { kind: "pageFocused"; page: Page }
  | { kind: "pageUpdated"; page: Page; url: string; title: string }
  | CaptchaDetectedEvent
  | CaptchaResolvedEvent
  | ReactionFiredEvent;

/** A captcha was found on `page`. See {@link ContextEvent}. */
export interface CaptchaDetectedEvent {
  kind: "captchaDetected";
  page: Page;
  /** Identifies the solve in `captchaResolved` and in the `captchas` of the actions it held. */
  solveId: string;
  /** The frame the challenge was found in. */
  frameId: string;
  /** What found it: `"auto"` (auto-solve) or `"command"` ({@link Page.solveCaptcha}). */
  trigger: "auto" | "command";
  /**
   * `"solving"`: the solve starts now. `"waiting_for_focus"`: the page does
   * not have the focus and auto-solve waits for it (see
   * {@link CaptchaAutoSolveOpts.unfocused}). `"skipped"`: the page reached
   * {@link CaptchaAutoSolveOpts.maxSolvesPerMinute}; `captchaResolved`
   * follows at once with code `"limit_reached"`.
   */
  state: "solving" | "waiting_for_focus" | "skipped";
  /**
   * The action running on the page when the captcha appeared (`"click"`,
   * `"fill"`, `"type"`, `"drag"`), held until the solve ends.
   */
  interruptedCommand?: string;
}

/** The solve announced by `captchaDetected` ended. See {@link ContextEvent}. */
export interface CaptchaResolvedEvent {
  kind: "captchaResolved";
  page: Page;
  solveId: string;
  /** Whether the challenge was solved. */
  success: boolean;
  /** From detection to the end, in milliseconds, including any wait for the focus. */
  durationMs: number;
  /** Interaction rounds the solve needed; 0 if it never got to interact. */
  attempts: number;
  /** As in `captchaDetected`. */
  interruptedCommand?: string;
  /** What `interruptedCommand` does now; see {@link CaptchaInterruption.outcome}. */
  interruptedOutcome?: CaptchaInterruption["outcome"];
  /**
   * Present iff `success` is false. Codes: `"solve_failed"`, `"timeout"`,
   * `"limit_reached"`, `"page_closed"`, `"disabled"` (auto-solve was disabled
   * before the solve started) and `"cancelled"` (a navigation of the page
   * started during the solve).
   */
  error?: { code: string; message: string };
}

/** A reaction clicked on `page`, or tried to. See {@link ContextEvent}. */
export interface ReactionFiredEvent {
  kind: "reactionFired";
  page: Page;
  /** The id {@link Page.addReaction} or {@link CloudBrowser.addReaction} returned. */
  reactionId: string;
  /** The frame the match was found in. */
  frameId: string;
  /** Whether the click was carried out. */
  success: boolean;
  /**
   * The action running on the page when the reaction acted (`"fill"`,
   * `"type"`, `"drag"`, ...), which waited until the click was done.
   */
  interruptedCommand?: string;
  /**
   * Present iff `success` is false, with the click's code: `"not_found"` (the
   * click target was gone), `"occluded_no_reachable_point"`,
   * `"occluded_after_evade"` (something covered it) or `"failed"`. A failed
   * reaction is used up like one that clicked.
   */
  error?: { code: string; message: string };
}

/**
 * Called once per context event.
 *
 * Calls are sequential and in the order the browser reported the changes. A
 * handler that keeps the reader busy for long makes the server drop this
 * listener's backlog and start over with a snapshot.
 */
export type ContextEventHandler = (event: ContextEvent) => void;

/**
 * A running listener, returned by {@link CloudBrowser.contextEvents}. Events
 * go to the handler passed there; this handle only exists to stop listening
 * and to report how it ended.
 */
export class ContextEvents {
  private readonly abort: AbortController;
  private readonly finished: Promise<void>;
  private stopped = false;
  private failure: Error | null = null;

  /** @internal Constructed by CloudBrowser; not part of the public API. */
  constructor(init: {
    stream: AsyncIterable<ContextEventProto>;
    onEvent: ContextEventHandler;
    page: (id: string) => Page;
    abort: AbortController;
    onFirst: () => void;
  }) {
    this.abort = init.abort;
    this.finished = this.pump(init);
  }

  /**
   * Reads the stream and calls the handler for each event. It never rejects:
   * a failure is recorded for {@link ContextEvents.error} instead.
   */
  private async pump(init: {
    stream: AsyncIterable<ContextEventProto>;
    onEvent: ContextEventHandler;
    page: (id: string) => Page;
    onFirst: () => void;
  }): Promise<void> {
    try {
      for await (const proto of init.stream) {
        const event = contextEventFromProto(proto, init.page);
        if (!event) continue;
        init.onEvent(event);
        init.onFirst();
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
   * Why the listener ended: null while it is still running, and after a clean
   * stop or the session ending normally.
   */
  get error(): Error | null {
    return this.failure;
  }

  /**
   * Resolves once the listener ends — {@link ContextEvents.stop}, a dead
   * session or a transport failure.
   *
   * @throws the transport failure that ended the listener, if any
   */
  async wait(): Promise<void> {
    await this.finished;
    if (this.failure) throw this.failure;
  }

  /**
   * Ends the listener. Idempotent, and safe to call from a `finally`. Once it
   * resolves the handler is no longer running.
   *
   * Do not await it from inside the handler: it waits for the reader, which
   * cannot finish while the handler it called is still running. Calling it
   * there without awaiting is fine.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    await this.finished;
  }
}

function contextEventFromProto(
  proto: ContextEventProto,
  page: (id: string) => Page,
): ContextEvent | null {
  const e = proto.event;
  switch (e.case) {
    case "snapshot":
      return { kind: "snapshot", pages: e.value.pages.map((p) => pageInfoFromProto(p, page)) };
    case "pageOpened": {
      const info = pageInfoFromProto(e.value, page);
      return { kind: "pageOpened", page: info.page, info };
    }
    case "pageClosed":
      return {
        kind: "pageClosed",
        page: page(e.value.pageId),
        focusedPage: page(e.value.focusedPageId),
      };
    case "pageFocused":
      return { kind: "pageFocused", page: page(e.value.pageId) };
    case "pageUpdated":
      return {
        kind: "pageUpdated",
        page: page(e.value.pageId),
        url: e.value.url,
        title: e.value.title,
      };
    case "captchaDetected": {
      const d = e.value;
      const event: CaptchaDetectedEvent = {
        kind: "captchaDetected",
        page: page(d.pageId),
        solveId: d.solveId,
        frameId: d.frameId,
        trigger: d.trigger as CaptchaDetectedEvent["trigger"],
        state: d.state as CaptchaDetectedEvent["state"],
      };
      if (d.interruptedCommand) event.interruptedCommand = d.interruptedCommand;
      return event;
    }
    case "captchaResolved": {
      const r = e.value;
      const event: CaptchaResolvedEvent = {
        kind: "captchaResolved",
        page: page(r.pageId),
        solveId: r.solveId,
        success: r.success,
        durationMs: r.durationMs,
        attempts: r.attempts,
      };
      if (r.interruptedCommand) event.interruptedCommand = r.interruptedCommand;
      if (r.interruptedOutcome) {
        event.interruptedOutcome = r.interruptedOutcome as CaptchaInterruption["outcome"];
      }
      if (r.error) event.error = { code: r.error.code, message: r.error.message };
      return event;
    }
    case "reactionFired": {
      const r = e.value;
      const event: ReactionFiredEvent = {
        kind: "reactionFired",
        page: page(r.pageId),
        reactionId: r.reactionId,
        frameId: r.frameId,
        success: r.success,
      };
      if (r.interruptedCommand) event.interruptedCommand = r.interruptedCommand;
      if (r.error) event.error = { code: r.error.code, message: r.error.message };
      return event;
    }
  }
  return null;
}
