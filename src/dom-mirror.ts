import type { DomEvent } from "./gen/wrc_pb.ts";

/**
 * A node in the mirrored page, in CDP's `DOM.Node` shape — the same shape
 * {@link CloudBrowser.getDOM} returns, with two additions that the mirror
 * needs and a caller usually wants anyway: {@link DomNode.frameId} and
 * {@link DomNode.contentFrameId}.
 *
 * An `<iframe>` is an ordinary element here. The document it hosts is its one
 * entry in {@link DomNode.children}, present once the element has been
 * expanded, and nothing about walking the tree has to know a process boundary
 * runs through it.
 */
export interface DomNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  /** Flat `[name, value, name, value, ...]`, as CDP sends it. */
  attributes?: string[];
  /**
   * Total children in the page, whether or not they are in `children`. An
   * `<iframe>` reports 1: the document it hosts.
   */
  childNodeCount?: number;
  /** Present once the node has been expanded. */
  children?: DomNode[];
  /** Author shadow roots, when the mirror was started with `pierce`. */
  shadowRoots?: DomNode[];

  /**
   * The frame this node lives in. Always set.
   *
   * Together with `backendNodeId` this is the node's address: node ids are
   * handed out per renderer and restart per frame, so two frames can and do
   * use the same one, and the id on its own is ambiguous across a page.
   */
  frameId: string;

  /**
   * For an element that hosts a frame (`<iframe>`, `<frame>`, `<object>`):
   * the frame it hosts, which is a different frame from `frameId` and is the
   * one its child document's ids belong to.
   */
  contentFrameId?: string;
}

/** @internal The shape the browser sends, before the mirror normalizes it. */
interface RawDomNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  attributes?: string[];
  childNodeCount?: number;
  children?: RawDomNode[];
  shadowRoots?: RawDomNode[];
  /**
   * On a document: its own frame. On a frame owner element: the frame it
   * HOSTS. One name for two relationships, which is why the mirror splits it
   * into `frameId` and `contentFrameId` before handing a node out.
   */
  frameId?: string;
}

/**
 * The opening snapshot: the main frame's document. Child frames are not in it
 * — their documents are fetched by expanding the `<iframe>` elements that host
 * them, which is also what starts mirroring them.
 */
export interface DomSnapshot {
  root: string;
  frameId: string;
  /** The page sequence this snapshot is the baseline for. */
  seq: number;
}

/** Why a mirror had to be rebuilt. */
export type DomResyncReason =
  | "documentReplaced"
  | "overflow"
  | "rendererGone"
  | "slowReader"
  | string;

export interface DomMirrorOptions {
  /**
   * Levels to fetch up front. Default 2, which is `#document` → `<html>` →
   * `<head>`/`<body>` — enough to draw a collapsed tree. Fetching everything
   * (-1) works but gives up what the mirror is for.
   */
  depth?: number;
  /** Descend into author shadow roots. Fixed for the life of the mirror. */
  pierce?: boolean;
}

/**
 * Called after the tree changed. `root` is a fresh object whenever anything
 * below it changed, so it can be compared by identity and rendered with
 * memoized components.
 */
export type DomChangeHandler = (mirror: DomMirror) => void;

/** Called when the mirror had to be rebuilt, after the new tree is in place. */
export type DomResyncHandler = (reason: DomResyncReason) => void;

/** @internal The transport calls the mirror needs. Supplied by CloudBrowser. */
export interface DomMirrorTransport {
  start(opts: DomMirrorOptions): Promise<DomSnapshot>;
  stop(): Promise<void>;
  children(
    backendNodeId: number,
    frameId: string,
    depth?: number,
  ): Promise<{ children: string; seq: number }>;
  release(backendNodeId: number, frameId: string): Promise<void>;
  reveal(
    backendNodeId: number,
    frameId: string,
  ): Promise<{ path: string; seq: number }>;
}

type SlotKind = "children" | "shadowRoots";

interface Slot {
  parent: string;
  kind: SlotKind;
}

/** Node ids are renderer-local, so the frame is part of the address. */
const keyOf = (frameId: string, backendNodeId: number) =>
  `${frameId}#${backendNodeId}`;

/**
 * How hard to try to rebuild the page after the browser voids it. A void
 * usually means the page is navigating, and the window where the old document
 * is gone and the new one cannot be serialized yet is short.
 */
const RESYNC_ATTEMPTS = 4;
const RESYNC_RETRY_MS = 150;

/**
 * A live copy of a page's DOM, across every frame in it.
 *
 * Returned by {@link CloudBrowser.mirrorDom}. The browser sends the top of the
 * tree once and from then on only what changed in the part you expanded, so a
 * page that churns inside a collapsed subtree costs one number per batch
 * instead of a re-serialized document.
 *
 * It is one tree. An `<iframe>` is an element whose one child is the document
 * it hosts; expanding it fetches that document and starts mirroring the frame,
 * collapsing it stops again, and a frame navigating arrives as its owner's
 * child being replaced. Underneath there is still one mirror per document,
 * because a mutation observer is bound to a single Document and an
 * out-of-process iframe is a different Document in a different process — but
 * that is engine bookkeeping, not something a caller models.
 *
 * Node ids restart per frame, so a node's address is the pair
 * ({@link DomNode.frameId}, `backendNodeId`) and never the id alone.
 *
 * The tree is treated as immutable: applying a change replaces the nodes from
 * the root down to the one that moved and leaves every other object identical.
 * A UI can therefore re-render from `root` and let `React.memo` (or any
 * identity check) skip the parts that did not move.
 *
 * ```ts
 * const mirror = await browser.mirrorDom({ pierce: true }, () => render(mirror.root));
 * await mirror.expand(bodyNode);   // start reporting changes inside <body>
 * await mirror.collapse(bodyNode); // stop again
 * await mirror.stop();
 * ```
 */
export class DomMirror {
  private readonly transport: DomMirrorTransport;
  private readonly options: DomMirrorOptions;
  private readonly onChange: DomChangeHandler;
  private readonly onResync?: DomResyncHandler;
  private readonly abort: AbortController;
  private readonly finished: Promise<void>;

  private nodes = new Map<string, DomNode>();
  private slots = new Map<string, Slot>();
  private expandedKeys = new Set<string>();

  /**
   * Per node: the page sequence its current state was defined at, by a read
   * payload or by an edit.
   *
   * Reads and events reach a client over two different channels — a unary call
   * and a stream — so an event can turn up that the read reply already folded
   * in. Applying it twice would duplicate an insertion, which is the one entry
   * type that is not idempotent. Comparing against the node's own watermark
   * rather than a single page-wide one keeps that from silently discarding a
   * change to an unrelated part of the tree.
   */
  private asOf = new Map<string, number>();

  private seqValue = 0;

  private rootNode: DomNode | null = null;
  private mainFrame = "";

  /**
   * Events are held until a snapshot exists to apply them to, and dropped if
   * they predate it. Without this a batch that lands between subscribing and
   * the snapshot arriving would either be applied to nothing or applied twice.
   */
  private ready = false;
  private pendingEvents: DomEvent[] = [];

  private stopped = false;
  private failure: Error | null = null;

  /** @internal Constructed by CloudBrowser; not part of the public API. */
  constructor(init: {
    stream: AsyncIterable<DomEvent>;
    transport: DomMirrorTransport;
    options: DomMirrorOptions;
    onChange: DomChangeHandler;
    onResync?: DomResyncHandler;
    abort: AbortController;
  }) {
    this.transport = init.transport;
    this.options = init.options;
    this.onChange = init.onChange;
    this.onResync = init.onResync;
    this.abort = init.abort;
    this.finished = this.pump(init.stream);
  }

  // ── public surface ────────────────────────────────────────────────────

  /** The main frame's document, or null before the first snapshot arrived. */
  get root(): DomNode | null {
    return this.rootNode;
  }

  /** The page's main frame. */
  get mainFrameId(): string {
    return this.mainFrame;
  }

  /**
   * Every frame with a document in the tree, main frame first. A frame whose
   * `<iframe>` has not been expanded is not mirrored and not listed.
   */
  get frameIds(): string[] {
    const seen = new Set<string>();
    if (this.mainFrame) seen.add(this.mainFrame);
    for (const node of this.nodes.values()) {
      if (node.nodeType === 9) seen.add(node.frameId);
    }
    return [...seen];
  }

  /**
   * The page sequence of the last change applied. One clock for the whole
   * page: a change in an out-of-process iframe and one in the main document
   * are ordered against each other.
   */
  get seq(): number {
    return this.seqValue;
  }

  /** Looks up a node by its address. */
  getNode(frameId: string, backendNodeId: number): DomNode | undefined {
    return this.nodes.get(keyOf(frameId, backendNodeId));
  }

  /**
   * Whether this node's children are known. Changes inside a node that is not
   * expanded arrive only as an updated `childNodeCount`.
   */
  isExpanded(node: DomNode): boolean {
    return this.expandedKeys.has(keyOf(node.frameId, node.backendNodeId));
  }

  /** Why the mirror ended: null while running and after a clean stop. */
  get error(): Error | null {
    return this.failure;
  }

  /**
   * Fetches a node's children and starts reporting changes inside them. This
   * is what a tree view calls when the user opens a node.
   *
   * On an `<iframe>` the one child is the document it hosts, and this call is
   * what starts mirroring that frame. Nothing about the result says a process
   * boundary was crossed; it is a child list like any other.
   *
   * @param depth levels below the node, default 1
   *
   * @throws not_mirrored - the page has no mirror, or the node's frame is not
   *   part of the one it has; after a resync, fetch the current tree before
   *   addressing nodes again
   * @throws mirror_failed - the subtree could not be serialized, usually a
   *   document that went away mid-read
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async expand(node: DomNode, depth?: number): Promise<void> {
    if (this.stopped) return;
    const frame = node.frameId;
    const key = keyOf(frame, node.backendNodeId);
    const reply = await this.transport.children(node.backendNodeId, frame, depth);

    // The node can be gone by the time the reply lands — a resync or a removal
    // in between rebuilt the part of the tree this describes.
    if (!this.nodes.has(key)) return;

    const kids = JSON.parse(reply.children || "[]") as RawDomNode[];
    const fresh = this.touch(key);
    this.dropChildren(fresh);
    fresh.children = kids.map((k) =>
      this.adopt(k, { parent: key, kind: "children" }, frame, reply.seq),
    );
    fresh.childNodeCount = fresh.children.length;
    this.expandedKeys.add(key);
    this.mark(key, reply.seq);
    this.onChange(this);
  }

  /**
   * Stops reporting changes inside a node, called when the user closes it. The
   * node itself stays in the tree and keeps reporting its child count. A child
   * frame below it stops being mirrored too.
   *
   * Skipping this is not an error, it is a slow leak: the browser's revealed
   * set only grows, and eventually it is no longer filtering anything.
   *
   * @throws not_mirrored - the page has no mirror, or the node's frame is not
   *   part of the one it has; this is what collapsing a node from a tree that has
   *   since been resynced looks like, so fetch the current tree and address the
   *   node again
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async collapse(node: DomNode): Promise<void> {
    if (this.stopped) return;
    const key = keyOf(node.frameId, node.backendNodeId);
    await this.transport.release(node.backendNodeId, node.frameId);
    if (!this.nodes.has(key)) return;
    const fresh = this.touch(key);
    this.dropChildren(fresh);
    delete fresh.children;
    this.expandedKeys.delete(key);
    this.onChange(this);
  }

  /**
   * Brings a node into the tree together with its ancestors and their
   * siblings, and starts reporting changes along that path.
   *
   * Use it to focus a node you do not hold — an `inspectAtPosition` hit, say.
   * You cannot walk up to it yourself: it is not in your tree, so there is
   * nothing to walk from.
   *
   * The node may be in a frame nobody opened, and that works: the chain comes
   * back crossing the frame boundaries it has to, and those frames start being
   * mirrored, exactly as if you had expanded your way there by hand.
   *
   * @returns the ancestor chain, the main document first, or an empty array if
   *   the node is not on the page
   *
   * @throws not_mirrored - the page has no mirror, or the given frame is not part
   *   of the one it has
   * @throws mirror_failed - the path could not be serialized, usually a document
   *   that went away mid-read
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async reveal(backendNodeId: number, frameId?: string): Promise<DomNode[]> {
    if (this.stopped) return [];
    const frame = frameId || this.mainFrame;
    const reply = await this.transport.reveal(backendNodeId, frame);
    const path = JSON.parse(reply.path || "[]") as RawDomNode[];
    if (path.length === 0) return [];

    // The chain starts at the main document, which the mirror already holds,
    // so it is merged level by level rather than re-rooted. Re-rooting would
    // throw away the rest of the page, including every other frame opened
    // into it.
    const keys: string[] = [];
    let space = this.mainFrame;
    let above: string | null = null;

    for (const step of path) {
      // A document names its own frame, and everything after it counts in
      // that frame's ids. This is the boundary, and it is the only place the
      // address space changes.
      if (step.nodeType === 9 && step.frameId) space = step.frameId;
      const key = keyOf(space, step.backendNodeId);

      if (!this.nodes.has(key)) {
        // The only step that can be missing is a hosted document: every other
        // one arrived in the child list of the step above it. Hanging it off
        // its owner is what crossing into the frame means here.
        if (above === null || !this.nodes.has(above)) break;
        const owner = this.touch(above);
        this.dropChildren(owner);
        owner.children = [
          this.adopt(step, { parent: above, kind: "children" }, space, reply.seq),
        ];
        owner.childNodeCount = 1;
        this.expandedKeys.add(above);
        this.mark(above, reply.seq);
      }

      this.mergeChildren(key, step, space, reply.seq);
      keys.push(key);
      above = key;
    }

    this.onChange(this);
    return keys
      .map((k) => this.nodes.get(k))
      .filter((n): n is DomNode => n !== undefined);
  }

  /**
   * Throws away the local copy of the whole page and fetches a fresh one.
   * Happens automatically whenever the browser says the copy is void, so you
   * rarely need to call it.
   *
   * @throws mirror_failed - the page could not be serialized, usually a document
   *   that went away while the tree was being rebuilt. The mirror then ends
   *
   * @see {@link CommandError} for reading the code off the rejection
   */
  async resync(reason: DomResyncReason = "manual"): Promise<void> {
    if (this.stopped) return;
    this.ready = false;

    // A resync that fails leaves nothing usable behind: the local copy is
    // already declared void and no more events will make sense against it. The
    // common cause is transient — the page was voided because it is navigating,
    // and the new document is not there yet to be serialized — so this retries
    // before treating it as fatal.
    let snapshot: DomSnapshot | null = null;
    let last: unknown;
    for (let attempt = 0; attempt < RESYNC_ATTEMPTS; attempt++) {
      if (this.stopped) return;
      if (attempt > 0) await new Promise((r) => setTimeout(r, RESYNC_RETRY_MS));
      try {
        snapshot = await this.transport.start(this.options);
        break;
      } catch (err) {
        last = err;
      }
    }

    if (!snapshot) {
      // Out of options. Ending the mirror is the point: a caller watching
      // wait() can say the tree is frozen, where staying quietly broken looks
      // exactly like a page on which nothing is happening.
      this.failure = last instanceof Error ? last : new Error(String(last));
      void this.stop();
      return;
    }

    this.install(snapshot);
    this.onResync?.(reason);
    this.onChange(this);
  }

  /** Resolves once the mirror ends — stop(), a dead session, a transport failure. */
  async wait(): Promise<void> {
    await this.finished;
    if (this.failure) throw this.failure;
  }

  /** Stops mirroring and detaches the reader. Idempotent, safe in a `finally`. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.transport.stop();
    } catch {
      // The local reader goes down either way, and a page that is already gone
      // is exactly when this throws.
    } finally {
      this.abort.abort();
      await this.finished;
    }
  }

  // ── snapshot installation ─────────────────────────────────────────────

  /** @internal Called by CloudBrowser with the opening snapshot. */
  install(snapshot: DomSnapshot): void {
    this.reset();
    this.mainFrame = snapshot.frameId || this.mainFrame;
    this.seqValue = snapshot.seq;

    const parsed = snapshot.root
      ? (JSON.parse(snapshot.root) as RawDomNode)
      : null;
    this.rootNode = parsed
      ? this.adopt(parsed, null, this.mainFrame, snapshot.seq)
      : null;

    this.ready = true;

    // Anything buffered while the snapshot was in flight is either already in
    // it (seq <= snapshot) or genuinely newer. Either way the watermark check
    // in handle() decides, so replaying the buffer here is safe.
    const buffered = this.pendingEvents;
    this.pendingEvents = [];
    for (const event of buffered) this.handle(event);
  }

  private reset(): void {
    this.nodes = new Map();
    this.slots = new Map();
    this.expandedKeys = new Set();
    this.asOf = new Map();
    this.rootNode = null;
  }

  // ── event stream ──────────────────────────────────────────────────────

  private async pump(stream: AsyncIterable<DomEvent>): Promise<void> {
    try {
      for await (const event of stream) {
        if (event.event.case === "resync") {
          // Awaited, so the events behind it are processed against the tree it
          // produces rather than against the one it just invalidated.
          await this.resync(event.event.value.reason);
          continue;
        }
        this.handle(event);
      }
    } catch (err) {
      // Cancelling is how stop() ends the stream, so that error is expected.
      if (!this.stopped) {
        this.failure = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  private handle(event: DomEvent): void {
    if (!this.ready) {
      if (event.event.case !== undefined) this.pendingEvents.push(event);
      return;
    }
    if (event.event.case !== "update") return;

    const batch = event.event.value;
    const frame = batch.frameId || this.mainFrame;
    const seq = Number(batch.seq);

    let entries: EditEntry[];
    try {
      entries = JSON.parse(batch.edits || "[]") as EditEntry[];
    } catch {
      void this.resync("overflow");
      return;
    }

    // Which entries to keep is decided against the watermarks as they stand
    // BEFORE the batch, and the watermarks are moved only afterwards.
    // Entries within a batch share its sequence, and a frame swap is exactly
    // a removal and an insertion on the same owner in one batch — judging the
    // second against a watermark the first just raised would drop it.
    const keep: EditEntry[] = [];
    const touched: string[] = [];
    for (const entry of entries) {
      const key = keyOf(frame, targetOf(entry));
      if ((this.asOf.get(key) ?? -1) >= seq) continue;
      keep.push(entry);
      touched.push(key);
    }
    for (const entry of keep) this.apply(entry, frame, seq);
    for (const key of touched) this.mark(key, seq);
    if (seq > this.seqValue) this.seqValue = seq;
    this.onChange(this);
  }

  // ── applying one entry ────────────────────────────────────────────────

  private apply(entry: EditEntry, frame: string, seq: number): void {
    switch (entry.type) {
      case "childNodeInserted": {
        const parentKey = keyOf(frame, entry.parentId);
        if (!this.nodes.has(parentKey)) return;
        const fresh = this.touch(parentKey);
        // The browser only reports insertions for nodes it expanded. If we do
        // not have a child list for one, it had none when we last saw it, so
        // an empty list is the right thing to grow from.
        const kids = fresh.children ?? [];
        const node = this.adopt(
          entry.node,
          { parent: parentKey, kind: "children" },
          frame,
          seq,
        );
        const at =
          entry.previousNodeId === 0
            ? 0
            : kids.findIndex((c) => c.backendNodeId === entry.previousNodeId) + 1;
        kids.splice(at <= 0 ? 0 : at, 0, node);
        fresh.children = kids;
        fresh.childNodeCount = kids.length;
        this.expandedKeys.add(parentKey);
        return;
      }
      case "childNodeRemoved": {
        const parentKey = keyOf(frame, entry.parentId);
        const parent = this.nodes.get(parentKey);
        if (!parent?.children) return;
        const fresh = this.touch(parentKey);
        const kids = fresh.children ?? [];
        // Matched on the id alone, not the pair. When the child is a hosted
        // document the id is in ITS frame, not the parent's — but a frame
        // owner has exactly one child, so there is nothing to confuse it with.
        const at = kids.findIndex((c) => c.backendNodeId === entry.nodeId);
        if (at < 0) return;
        this.forget(kids[at]);
        kids.splice(at, 1);
        fresh.children = kids;
        fresh.childNodeCount = kids.length;
        return;
      }
      case "childNodeCountUpdated": {
        const key = keyOf(frame, entry.nodeId);
        if (!this.nodes.has(key)) return;
        this.touch(key).childNodeCount = entry.count;
        return;
      }
      case "childListReordered": {
        const key = keyOf(frame, entry.nodeId);
        const parent = this.nodes.get(key);
        if (!parent?.children) return;
        const fresh = this.touch(key);
        const have = new Map(
          (fresh.children ?? []).map((c) => [c.backendNodeId, c]),
        );
        const next: DomNode[] = [];
        for (const id of entry.order) {
          const child = have.get(id);
          if (child) next.push(child);
        }
        // The browser sends the complete order, so a mismatch means our copy
        // drifted. Keeping the strays would hide that; dropping the batch and
        // rebuilding is the only honest option.
        if (next.length !== have.size) {
          void this.resync("overflow");
          return;
        }
        fresh.children = next;
        return;
      }
      case "attributesUpdated": {
        const key = keyOf(frame, entry.nodeId);
        if (!this.nodes.has(key)) return;
        this.touch(key).attributes = entry.attributes.slice();
        return;
      }
      case "characterDataModified": {
        const key = keyOf(frame, entry.nodeId);
        if (!this.nodes.has(key)) return;
        this.touch(key).nodeValue = entry.value;
        return;
      }
    }
  }

  // ── tree bookkeeping ──────────────────────────────────────────────────

  /** Records that a node's state is current as of `seq`. Never moves back. */
  private mark(key: string, seq: number): void {
    if (seq > (this.asOf.get(key) ?? -1)) this.asOf.set(key, seq);
    if (seq > this.seqValue) this.seqValue = seq;
  }

  /**
   * Replaces `key` and every ancestor with copies, so the path from the root
   * to the changed node has new identities and nothing else does. Returns the
   * fresh copy of `key`, which the caller then edits in place.
   *
   * The walk crosses frame boundaries without noticing them: a document is a
   * child of the `<iframe>` hosting it like any other, so a change deep inside
   * an out-of-process frame still produces a new `root`.
   */
  private touch(key: string): DomNode {
    const original = this.nodes.get(key);
    if (!original) throw new Error(`dom mirror: node ${key} is not in the tree`);

    const clone: DomNode = { ...original };
    if (original.children) clone.children = original.children.slice();
    if (original.shadowRoots) clone.shadowRoots = original.shadowRoots.slice();
    this.nodes.set(key, clone);

    let childKey = key;
    let childNode = clone;
    for (;;) {
      const slot = this.slots.get(childKey);
      if (!slot) {
        this.rootNode = childNode;
        return clone;
      }
      const parent = this.nodes.get(slot.parent);
      if (!parent) return clone;

      const parentClone: DomNode = { ...parent };
      const list = (parent[slot.kind] ?? []).slice();
      const at = list.findIndex(
        (n) =>
          n.backendNodeId === childNode.backendNodeId &&
          n.frameId === childNode.frameId,
      );
      if (at >= 0) list[at] = childNode;
      parentClone[slot.kind] = list;
      this.nodes.set(slot.parent, parentClone);
      childKey = slot.parent;
      childNode = parentClone;
    }
  }

  /**
   * Registers a payload subtree and returns the copy that lives in the tree.
   *
   * `frame` is the id space the payload's ids belong to, and it changes here
   * and nowhere else: a document node names its own frame, and everything
   * below it counts in that frame. That is the whole of what crossing into an
   * iframe means to a client.
   */
  private adopt(
    node: RawDomNode,
    slot: Slot | null,
    frame: string,
    seq: number,
  ): DomNode {
    // The browser puts the frame's own id on a document and the HOSTED
    // frame's id on a frame owner element. Same field, two relationships —
    // which is which is decided by the node type, and only one of them can be
    // called frameId without making "which frame is this node in" ambiguous.
    const isDocument = node.nodeType === 9;
    const own = isDocument && node.frameId ? node.frameId : frame;

    const key = keyOf(own, node.backendNodeId);
    const copy = { ...node, frameId: own } as DomNode;
    if (!isDocument && node.frameId && node.frameId !== own) {
      copy.contentFrameId = node.frameId;
    } else {
      delete copy.contentFrameId;
    }

    this.nodes.set(key, copy);
    this.mark(key, seq);
    if (slot) this.slots.set(key, slot);
    else this.slots.delete(key);

    if (node.children) {
      copy.children = node.children.map((c) =>
        this.adopt(c, { parent: key, kind: "children" }, own, seq),
      );
      this.expandedKeys.add(key);
    } else {
      delete copy.children;
      this.expandedKeys.delete(key);
    }

    if (node.shadowRoots) {
      copy.shadowRoots = node.shadowRoots.map((r) =>
        this.adopt(r, { parent: key, kind: "shadowRoots" }, own, seq),
      );
    } else {
      delete copy.shadowRoots;
    }

    return copy;
  }

  /** Replaces a node's child list from a fresh payload for the same node. */
  private mergeChildren(
    key: string,
    payload: RawDomNode,
    frame: string,
    seq: number,
  ): void {
    if (!payload.children) return;
    const fresh = this.touch(key);
    this.dropChildren(fresh);
    fresh.children = payload.children.map((c) =>
      this.adopt(c, { parent: key, kind: "children" }, frame, seq),
    );
    fresh.childNodeCount = fresh.children.length;
    this.expandedKeys.add(key);
    this.mark(key, seq);
  }

  private dropChildren(node: DomNode): void {
    for (const child of node.children ?? []) this.forget(child);
  }

  /**
   * Removes a subtree from the index. It descends through hosted documents
   * like through anything else — they are children, and a frame stops being
   * mirrored exactly when the element hosting it stops being expanded.
   */
  private forget(node: DomNode): void {
    const key = keyOf(node.frameId, node.backendNodeId);
    this.nodes.delete(key);
    this.slots.delete(key);
    this.expandedKeys.delete(key);
    this.asOf.delete(key);
    for (const child of node.children ?? []) this.forget(child);
    for (const root of node.shadowRoots ?? []) this.forget(root);
  }
}

// The entry shapes of a domUpdate batch. Documented on the event in WRC.pdl;
// mirrored here because this is the only place that decodes them.
type EditEntry =
  | { type: "childNodeInserted"; parentId: number; previousNodeId: number; node: RawDomNode }
  | { type: "childNodeRemoved"; parentId: number; nodeId: number }
  | { type: "childNodeCountUpdated"; nodeId: number; count: number }
  | { type: "childListReordered"; nodeId: number; order: number[] }
  | { type: "attributesUpdated"; nodeId: number; attributes: string[] }
  | { type: "characterDataModified"; nodeId: number; value: string };

// The node an entry is about, which for the two child-list entries is the
// PARENT: that is the node whose state they change, and whose watermark
// therefore decides whether they have already been folded in.
function targetOf(entry: EditEntry): number {
  switch (entry.type) {
    case "childNodeInserted":
    case "childNodeRemoved":
      return entry.parentId;
    default:
      return entry.nodeId;
  }
}
