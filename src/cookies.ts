/** Partition metadata for partitioned cookies (CHIPS). */
export interface CookiePartitionKey {
  topLevelSite: string;
  hasCrossSiteAncestor: boolean;
}

/** CookieParam is one entry returned by getCookies() or passed to setCookies(). */
export interface CookieParam {
  name: string;
  value: string;
  url?: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  expires?: number;
  priority?: string;
  sourceScheme?: string;
  sourcePort?: number;
  partitionKey?: CookiePartitionKey;
}
