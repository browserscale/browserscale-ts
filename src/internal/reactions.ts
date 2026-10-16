import type { Client } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  Browser,
  AddReactionRequestSchema,
  RemoveReactionRequestSchema,
  ListReactionsRequestSchema,
} from "../gen/wrc_pb.ts";
import { BrowserScaleError, throwCommandError } from "../errors.ts";
import type { Locator } from "../locator.ts";
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
  if (match.frameId) req.frameId = match.frameId;
  if (match.visibleFlag !== undefined) req.visible = match.visibleFlag;
  if (opts?.on) {
    assertReactionLocator("addReaction", opts.on, "on");
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
    frameId: r.frameId,
    visible: r.visible,
    allPages: r.allPages,
  }));
}

/** A reaction matches like a wait condition: css()/js() only. */
function assertReactionLocator(cmd: string, l: Locator, role: string): void {
  if (l.backendNodeId !== 0 || l.x !== undefined || l.y !== undefined) {
    throw new BrowserScaleError(
      `browserscale.${cmd}: ${role} must be a css()/js() locator (node()/at() are not valid)`,
    );
  }
  if (!l.selector && !l.jsExpression) {
    throw new BrowserScaleError(
      `browserscale.${cmd}: ${role} must have a CSS selector or JS expression`,
    );
  }
}
