// Internal proto ↔ TS helpers used by client.ts. Anything in here is
// implementation detail and is NOT exported from the package entrypoints.

import { create } from "@bufbuild/protobuf";
import {
  type Rect as ProtoRect,
  type ClickResult as ProtoClickResult,
  type FillResult as ProtoFillResult,
  type MoveResult as ProtoMoveResult,
  type ScrollResult as ProtoScrollResult,
  type DragResult as ProtoDragResult,
  type SelectOptionResult as ProtoSelectOptionResult,
  type WaitResult as ProtoWaitResult,
  type ClickError as ProtoClickError,
  type OccluderInfo as ProtoOccluderInfo,
  type ElementRef as ProtoElementRef,
  type WaitConditionStatus as ProtoWaitConditionStatus,
  type FrameInfo as ProtoFrameInfo,
  type PageInfo as ProtoPageInfo,
  type Header as ProtoHeader,
  type InterceptedRequest as ProtoInterceptedRequest,
  type InterceptedResponse as ProtoInterceptedResponse,
  type HeaderModification as ProtoHeaderModification,
  type CookieParam as ProtoCookieParam,
  type StorageOriginEntry as ProtoStorageOriginEntry,
  type AuthSession as ProtoAuthSession,
  HeaderModificationSchema,
  CookiePartitionKeySchema,
  CookieParamSchema,
  HeaderSchema,
  StorageItemSchema,
  StorageOriginEntrySchema,
  AuthSessionSchema,
  DbscSessionSchema,
} from "../gen/wrc_pb.ts";
import type {
  DragResult,
  ElementRef,
  ElementResult,
  FrameInfo,
  Header,
  InterceptedRequest,
  InterceptedResponse,
  OccluderInfo,
  PageInfo,
  Rect,
  SelectOptionResult,
  WaitConditionStatus,
  WaitResult,
} from "../types.ts";
import {
  ClickError,
  DragError,
  FillError,
  MoveError,
  ScrollError,
  SelectOptionError,
  WaitError,
} from "../errors.ts";
import type { CookieParam } from "../cookies.ts";
import type { StorageOriginEntry } from "../storage.ts";
import type { AuthSession } from "../auth-session.ts";
import type { HeaderModification, RequestPattern } from "../network.ts";
import { type Locator, pickFrame } from "../locator.ts";

// ──────────────────────────────────────────────────────────────────────
// Element-target fields shared by every action request
// ──────────────────────────────────────────────────────────────────────

/**
 * Common flat-target fields for Click / Fill / MoveTo / ScrollTo / Drag /
 * SelectOption requests. Empty / zero fields are returned as undefined so
 * proto3 presence-tracking treats them as unset on the wire.
 */
export interface ElementTargetFields {
  selector?: string;
  jsExpression?: string;
  backendNodeId?: number;
  frameId?: string;
  x?: number;
  y?: number;
}

export function elementFields(
  target: Locator,
  optsInFrame?: string,
): ElementTargetFields {
  const out: ElementTargetFields = {};
  if (target.selector) out.selector = target.selector;
  if (target.jsExpression) out.jsExpression = target.jsExpression;
  if (target.backendNodeId) out.backendNodeId = target.backendNodeId;
  const fid = pickFrame(optsInFrame, target);
  if (fid) out.frameId = fid;
  if (target.x !== undefined) out.x = target.x;
  if (target.y !== undefined) out.y = target.y;
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Rect
// ──────────────────────────────────────────────────────────────────────

export function rectFromProto(r: ProtoRect | undefined): Rect {
  if (!r) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

// ──────────────────────────────────────────────────────────────────────
// Element / Drag / Wait results + typed error surfacing
//
// Each RPC returns its own *Result message (ClickResult, FillResult, …) that
// carries an optional `error` populated when the action did not succeed. A
// semantic failure (occluded click, wait timeout, missing option) is a normal
// response, not a gRPC error — so the unwrap* helpers below map the payload to
// the public result and, when `error` is set, throw the matching typed error
// (mirroring browserscale-go's ClickError/WaitError/… with the partial result
// attached).
// ──────────────────────────────────────────────────────────────────────

interface ElementLike {
  success: boolean;
  frameId: string;
  backendNodeId: number;
}

function elementResult(
  r: ElementLike,
  isVisible: boolean,
  bounds: Rect,
  rootX: number,
  rootY: number,
): ElementResult {
  return {
    success: r.success,
    frameId: r.frameId,
    backendNodeId: r.backendNodeId,
    isVisible,
    bounds,
    rootX,
    rootY,
  };
}

function occluderFromProto(o?: ProtoOccluderInfo): OccluderInfo | undefined {
  if (!o) return undefined;
  return {
    backendNodeId: o.backendNodeId,
    frameId: o.frameId,
    tagName: o.tagName,
    id: o.id ?? "",
    className: o.className ?? "",
    text: o.text ?? "",
    bounds: rectFromProto(o.bounds),
    pointerEvents: o.pointerEvents ?? "",
    visibility: o.visibility ?? "",
    opacity: o.opacity ?? 0,
    zIndex: o.zIndex ?? "",
    hittableWhileInvisible: o.hittableWhileInvisible ?? false,
    position: o.position ?? "",
  };
}

// Nested click-core detail (no standalone result) surfaced inside a FillError
// or DragError as the underlying click failure that blocked the action.
function clickDetailFromProto(e?: ProtoClickError): ClickError | undefined {
  if (!e) return undefined;
  return new ClickError({
    code: e.code,
    message: e.message,
    occluder: occluderFromProto(e.occluder),
    evadeAttempted: e.evadeAttempted ?? false,
  });
}

// Lightweight element descriptor, surfaced inside a FillError to name the
// element that stole focus in a focus-loss failure.
function elementRefFromProto(e?: ProtoElementRef): ElementRef | undefined {
  if (!e) return undefined;
  return {
    backendNodeId: e.backendNodeId,
    tagName: e.tagName,
    id: e.id,
    name: e.name,
    className: e.className,
    inputType: e.inputType,
    text: e.text,
    editable: e.editable,
  };
}

/** Maps a ClickResult to ElementResult; throws {@link ClickError} when the click did not land. */
export function unwrapClick(r: ProtoClickResult): ElementResult {
  const res = elementResult(r, r.isVisible, rectFromProto(r.bounds), r.rootX, r.rootY);
  if (!r.success && r.error) {
    throw new ClickError({
      code: r.error.code,
      message: r.error.message,
      occluder: occluderFromProto(r.error.occluder),
      evadeAttempted: r.error.evadeAttempted ?? false,
      result: res,
    });
  }
  return res;
}

/** Maps a FillResult to ElementResult; throws {@link FillError} when the fill failed. */
export function unwrapFill(r: ProtoFillResult): ElementResult {
  // Fill omits is_visible/bounds from its contract; they stay zero.
  const res = elementResult(r, false, rectFromProto(undefined), r.rootX, r.rootY);
  if (!r.success && r.error) {
    throw new FillError({
      code: r.error.code,
      message: r.error.message,
      clickError: clickDetailFromProto(r.error.clickError),
      focusedBackendNodeId: r.error.focusedBackendNodeId,
      focusedElement: elementRefFromProto(r.error.focusedElement),
      targetEditable: r.error.targetEditable,
      targetValueLength: r.error.targetValueLength,
      result: res,
    });
  }
  return res;
}

/** Maps a MoveResult to ElementResult; throws {@link MoveError} when the target was not found. */
export function unwrapMove(r: ProtoMoveResult): ElementResult {
  const res = elementResult(r, r.isVisible, rectFromProto(r.bounds), r.rootX, r.rootY);
  if (!r.success && r.error) {
    throw new MoveError({ code: r.error.code, message: r.error.message, result: res });
  }
  return res;
}

/** Maps a ScrollResult to ElementResult; throws {@link ScrollError} when the target could not be scrolled. */
export function unwrapScroll(r: ProtoScrollResult): ElementResult {
  // scrollTo returns no root_x/root_y; they stay zero.
  const res = elementResult(r, r.isVisible, rectFromProto(r.bounds), 0, 0);
  if (!r.success && r.error) {
    throw new ScrollError({ code: r.error.code, message: r.error.message, result: res });
  }
  return res;
}

/** Maps a DragResult; throws {@link DragError} when the source pickup failed. */
export function unwrapDrag(r: ProtoDragResult): DragResult {
  const res: DragResult = {
    success: r.success,
    frameId: r.frameId,
    backendNodeId: r.backendNodeId,
    startX: r.startX,
    startY: r.startY,
    endX: r.endX,
    endY: r.endY,
  };
  if (!r.success && r.error) {
    throw new DragError({
      code: r.error.code,
      message: r.error.message,
      clickError: clickDetailFromProto(r.error.clickError),
      result: res,
    });
  }
  return res;
}

/** Maps a SelectOptionResult; throws {@link SelectOptionError} when no option was selected. */
export function unwrapSelect(r: ProtoSelectOptionResult): SelectOptionResult {
  const res: SelectOptionResult = {
    selectedIndex: r.selectedIndex,
    selectedValue: r.selectedValue,
    selectedText: r.selectedText,
  };
  if (!r.success && r.error) {
    throw new SelectOptionError({ code: r.error.code, message: r.error.message, result: res });
  }
  return res;
}

function waitConditionStatusFromProto(c: ProtoWaitConditionStatus): WaitConditionStatus {
  return {
    index: c.index,
    state: c.state,
    backendNodeId: c.backendNodeId,
    frameId: c.frameId,
    isVisible: c.isVisible,
    bounds: c.bounds ? rectFromProto(c.bounds) : undefined,
    occluder: occluderFromProto(c.occluder),
  };
}

/** Maps a WaitResult; throws {@link WaitError} when no condition matched before the deadline. */
export function unwrapWait(r: ProtoWaitResult): WaitResult {
  const res: WaitResult = {
    index: r.index,
    frameId: r.frameId,
    backendNodeId: r.backendNodeId,
    isVisible: r.isVisible,
    bounds: rectFromProto(r.bounds),
  };
  if (r.error) {
    throw new WaitError({
      code: r.error.code,
      message: r.error.message,
      conditions: r.error.conditions.map(waitConditionStatusFromProto),
      result: res,
    });
  }
  return res;
}

// ──────────────────────────────────────────────────────────────────────
// FrameInfo / PageInfo
// ──────────────────────────────────────────────────────────────────────

export function frameInfoFromProto(f: ProtoFrameInfo): FrameInfo {
  return {
    frameId: f.frameId,
    url: f.url,
    isOOPIF: f.isOopif,
    hasJSContext: f.hasJsContext,
    isLoading: f.isLoading,
    isVisible: f.isVisible,
    absoluteRect: rectFromProto(f.absoluteRect),
    relativeRect: rectFromProto(f.relativeRect),
    children: f.children.map(frameInfoFromProto),
  };
}

export function pageInfoFromProto(p: ProtoPageInfo): PageInfo {
  return {
    pageId: p.pageId,
    browserContextId: p.browserContextId,
    url: p.url,
    title: p.title,
    viewport: rectFromProto(p.viewport),
    frameTree: p.frameTree
      ? frameInfoFromProto(p.frameTree)
      : ({} as FrameInfo),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Headers
// ──────────────────────────────────────────────────────────────────────

export function headerFromProto(h: ProtoHeader): Header {
  return { name: h.name, value: h.value };
}

export function headersToProto(headers: Header[] | undefined): ProtoHeader[] {
  if (!headers) return [];
  return headers.map(h => {
    const msg = create(HeaderSchema);
    msg.name = h.name;
    msg.value = h.value;
    return msg;
  });
}

// ──────────────────────────────────────────────────────────────────────
// Intercepted request / response
// ──────────────────────────────────────────────────────────────────────

export function interceptedRequestFromProto(
  r: ProtoInterceptedRequest | undefined,
): InterceptedRequest | null {
  if (!r) return null;
  return {
    method: r.method,
    url: r.url,
    headers: r.headers.map(headerFromProto),
    body: r.body,
    resourceType: r.resourceType,
  };
}

export function interceptedResponseFromProto(
  r: ProtoInterceptedResponse | undefined,
): InterceptedResponse | null {
  if (!r) return null;
  return {
    url: r.url,
    statusCode: r.statusCode,
    headers: r.headers.map(headerFromProto),
    body: r.body,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Cookies
// ──────────────────────────────────────────────────────────────────────

export function cookieParamFromProto(c: ProtoCookieParam): CookieParam {
  return {
    name: c.name,
    value: c.value,
    url: c.url,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expires: c.expires,
    priority: c.priority,
    sourceScheme: c.sourceScheme,
    sourcePort: c.sourcePort,
    partitionKey: c.partitionKey
      ? {
          topLevelSite: c.partitionKey.topLevelSite,
          hasCrossSiteAncestor: c.partitionKey.hasCrossSiteAncestor,
        }
      : undefined,
  };
}

export function cookieParamsToProto(cookies: CookieParam[]): ProtoCookieParam[] {
  return cookies.map(c => {
    const msg = create(CookieParamSchema);
    msg.name = c.name;
    msg.value = c.value;
    if (c.url !== undefined) msg.url = c.url;
    msg.domain = c.domain;
    msg.path = c.path;
    if (c.secure !== undefined) msg.secure = c.secure;
    if (c.httpOnly !== undefined) msg.httpOnly = c.httpOnly;
    if (c.sameSite !== undefined) msg.sameSite = c.sameSite;
    if (c.expires !== undefined) msg.expires = c.expires;
    if (c.priority !== undefined) msg.priority = c.priority;
    if (c.sourceScheme !== undefined) msg.sourceScheme = c.sourceScheme;
    if (c.sourcePort !== undefined) msg.sourcePort = c.sourcePort;
    if (c.partitionKey !== undefined) {
      msg.partitionKey = create(CookiePartitionKeySchema);
      msg.partitionKey.topLevelSite = c.partitionKey.topLevelSite;
      msg.partitionKey.hasCrossSiteAncestor = c.partitionKey.hasCrossSiteAncestor;
    }
    return msg;
  });
}

// ──────────────────────────────────────────────────────────────────────
// Storage (localStorage)
// ──────────────────────────────────────────────────────────────────────

export function storageEntryFromProto(
  e: ProtoStorageOriginEntry,
): StorageOriginEntry {
  return {
    origin: e.origin,
    items: e.items.map(it => ({ key: it.key, value: it.value })),
  };
}

export function storageEntriesToProto(
  storage: StorageOriginEntry[],
): ProtoStorageOriginEntry[] {
  return storage.map(e => {
    const msg = create(StorageOriginEntrySchema);
    msg.origin = e.origin;
    msg.items = e.items.map(it => {
      const item = create(StorageItemSchema);
      item.key = it.key;
      item.value = it.value;
      return item;
    });
    return msg;
  });
}

// ──────────────────────────────────────────────────────────────────────
// Auth / DBSC
// ──────────────────────────────────────────────────────────────────────

export function authSessionFromProto(s: ProtoAuthSession): AuthSession {
  const out: AuthSession = {};
  if (s.gaiaId !== undefined) out.gaiaId = s.gaiaId;
  if (s.email !== undefined) out.email = s.email;
  if (s.refreshToken !== undefined) out.refreshToken = s.refreshToken;
  if (s.wrappedBindingKey !== undefined) out.wrappedBindingKey = s.wrappedBindingKey;
  if (s.signinScopedDeviceId !== undefined) out.signinScopedDeviceId = s.signinScopedDeviceId;
  if (s.syncConsent !== undefined) out.syncConsent = s.syncConsent;
  if (s.dbscSessions.length > 0) {
    out.dbscSessions = s.dbscSessions.map(d => ({ site: d.site, session: d.session }));
  }
  return out;
}

export function authSessionToProto(s: AuthSession): ProtoAuthSession {
  const msg = create(AuthSessionSchema);
  if (s.gaiaId !== undefined) msg.gaiaId = s.gaiaId;
  if (s.email !== undefined) msg.email = s.email;
  if (s.refreshToken !== undefined) msg.refreshToken = s.refreshToken;
  if (s.wrappedBindingKey !== undefined) msg.wrappedBindingKey = s.wrappedBindingKey;
  if (s.signinScopedDeviceId !== undefined) msg.signinScopedDeviceId = s.signinScopedDeviceId;
  if (s.syncConsent !== undefined) msg.syncConsent = s.syncConsent;
  msg.dbscSessions = (s.dbscSessions ?? []).map(d => {
    const item = create(DbscSessionSchema);
    item.site = d.site;
    item.session = d.session;
    return item;
  });
  return msg;
}

// ──────────────────────────────────────────────────────────────────────
// Network — patterns + header modifications
// ──────────────────────────────────────────────────────────────────────

/**
 * splitRequestPatterns turns a RequestPattern[] into the proto's parallel
 * URL + abort-flag slices. When no pattern has abort set, the aborts
 * slice is returned as an empty array so it stays off the wire.
 */
export function splitRequestPatterns(
  patterns: RequestPattern[],
): { urls: string[]; aborts: number[] } {
  const urls: string[] = new Array(patterns.length);
  let any = false;
  for (let i = 0; i < patterns.length; i++) {
    urls[i] = patterns[i].url;
    if (patterns[i].abort) any = true;
  }
  if (!any) return { urls, aborts: [] };
  const aborts: number[] = new Array(patterns.length);
  for (let i = 0; i < patterns.length; i++) {
    aborts[i] = patterns[i].abort ? 1 : 0;
  }
  return { urls, aborts };
}

export function headerModsToProto(
  mods: HeaderModification[] | undefined,
): ProtoHeaderModification[] {
  if (!mods) return [];
  return mods.map(m => {
    const msg = create(HeaderModificationSchema);
    msg.name = m.name;
    if (m.value !== undefined) msg.value = m.value;
    msg.action = m.action;
    if (m.before) msg.before = m.before;
    if (m.after) msg.after = m.after;
    return msg;
  });
}
