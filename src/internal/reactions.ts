import type { Client } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  Browser,
  AddReactionRequestSchema,
  RemoveReactionRequestSchema,
  ListReactionsRequestSchema,
} from "../gen/wrc_pb.ts";
import { BrowserScaleError, throwCommandError } from "../errors.ts";
import { Locator } from "../locator.ts";
import type { ReactionOpts } from "../options.ts";
import type { ReactionInfo } from "../types.ts";

type BrowserRpcClient = Client<typeof Browser>;

/** Who a reaction call is for; `pageId` `""` means every page of the browser. */
export interface ReactionScope {
  client: BrowserRpcClient;
  sessionId: string;
  apiKey: string;
  pageId: string;
}

export async function addReaction(
  s: ReactionScope,
  match: Locator,
  opts?: ReactionOpts,
): Promise<string> {
  assertReactionLocator("addReaction", match, "match");
  const req = create(AddReactionRequestSchema, {
    sessionId: s.sessionId,
    pageId: s.pageId,
    apiKey: s.apiKey,
  });
  if (match.selector) req.matchSelector = match.selector;
  if (match.jsExpression) req.matchJsExpression = match.jsExpression;
  req.in = match.chain();
  if (match.visibleFlag !== undefined) req.visible = match.visibleFlag;
  if (opts?.on) {
    assertReactionLocator("addReaction", opts.on, "on");
    if (opts.on.container) {
      throw new BrowserScaleError(
        "browserscale.addReaction: on is looked for in the matched element's frame and takes no container of its own",
      );
    }
    if (opts.on.selector) req.actionSelector = opts.on.selector;
    if (opts.on.jsExpression) req.actionJsExpression = opts.on.jsExpression;
  }
  if (opts?.button) req.button = opts.button;
  if (opts?.clickCount) req.clickCount = opts.clickCount;
  if (opts?.intervalMs) req.interval = opts.intervalMs;
  const resp = await s.client.addReaction(req);
  throwCommandError("addReaction", resp.error);
  return resp.reactionId;
}

export async function removeReaction(s: ReactionScope, reactionId: string): Promise<boolean> {
  const resp = await s.client.removeReaction(
    create(RemoveReactionRequestSchema, {
      sessionId: s.sessionId,
      apiKey: s.apiKey,
      reactionId,
    }),
  );
  throwCommandError("removeReaction", resp.error);
  return resp.removed;
}

export async function listReactions(s: ReactionScope): Promise<ReactionInfo[]> {
  const resp = await s.client.listReactions(
    create(ListReactionsRequestSchema, {
      sessionId: s.sessionId,
      pageId: s.pageId,
      apiKey: s.apiKey,
    }),
  );
  throwCommandError("listReactions", resp.error);
  return resp.reactions.map((r) => ({
    reactionId: r.reactionId,
    matchSelector: r.matchSelector ?? "",
    matchJsExpression: r.matchJsExpression ?? "",
    actionSelector: r.actionSelector ?? "",
    actionJsExpression: r.actionJsExpression ?? "",
    match: Locator._reactionMatch({
      selector: r.matchSelector ?? "",
      jsExpression: r.matchJsExpression ?? "",
      chain: r.in,
      visible: r.visible,
    }),
    visible: r.visible,
    allPages: r.allPages,
  }));
}

/**
 * A reaction matches like a wait condition: css()/js() only. A reference, a
 * frame or at() is rejected: a reaction watches for an element to appear.
 */
function assertReactionLocator(cmd: string, l: Locator, role: string): void {
  if (l.refValue || l.x !== undefined || l.y !== undefined) {
    throw new BrowserScaleError(
      `browserscale.${cmd}: ${role} must be a css()/js() locator (a reference or at() is not valid here)`,
    );
  }
  if (!l.selector && !l.jsExpression) {
    throw new BrowserScaleError(
      `browserscale.${cmd}: ${role} must have a CSS selector or JS expression; to watch a frame, put the locator in it with in()`,
    );
  }
  l.validateChain(cmd);
}
