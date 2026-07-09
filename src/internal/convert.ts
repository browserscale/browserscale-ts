// Internal proto ↔ TS helpers used by client.ts. Anything in here is
// implementation detail and is NOT exported from the package entrypoints.

import { create } from "@bufbuild/protobuf";
import {
  type Rect as ProtoRect,
  type ElementResult as ProtoElementResult,
  type DragResult as ProtoDragResult,
  type WaitResult as ProtoWaitResult,
  type FrameInfo as ProtoFrameInfo,
  type PageInfo as ProtoPageInfo,
  type Header as ProtoHeader,
  type InterceptedRequest as ProtoInterceptedRequest,
  type InterceptedResponse as ProtoInterceptedResponse,
  type HeaderModification as ProtoHeaderModification,
  type CookieParam as ProtoCookieParam,
  type StorageOriginEntry as ProtoStorageOriginEntry,
  HeaderModificationSchema,
  CookiePartitionKeySchema,
  CookieParamSchema,
  HeaderSchema,
  StorageItemSchema,
  StorageOriginEntrySchema,
} from "../gen/wrc_pb.ts";
import type {
  DragResult,
  ElementResult,
  FrameInfo,
  Header,
  InterceptedRequest,
  InterceptedResponse,
  PageInfo,
  Rect,
  WaitResult,
} from "../types.ts";
import type { CookieParam } from "../cookies.ts";
import type { StorageOriginEntry } from "../storage.ts";
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
// Element / Drag / Wait results
// ──────────────────────────────────────────────────────────────────────

export function elementResultFromProto(r: ProtoElementResult): ElementResult {
  return {
    success: r.success,
    frameId: r.frameId,
    backendNodeId: r.backendNodeId,
    isVisible: r.isVisible,
    bounds: rectFromProto(r.bounds),
    rootX: r.rootX,
    rootY: r.rootY,
  };
}

export function dragResultFromProto(r: ProtoDragResult): DragResult {
  return {
    success: r.success,
    frameId: r.frameId,
    backendNodeId: r.backendNodeId,
    startX: r.startX,
    startY: r.startY,
    endX: r.endX,
    endY: r.endY,
  };
}

export function waitResultFromProto(r: ProtoWaitResult): WaitResult {
  return {
    index: r.index,
    frameId: r.frameId,
    backendNodeId: r.backendNodeId,
    isVisible: r.isVisible,
    bounds: rectFromProto(r.bounds),
  };
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
