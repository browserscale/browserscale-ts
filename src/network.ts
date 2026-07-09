// Network helpers — request-pattern matching, header modifications.

/**
 * RequestPattern matches a URL pattern in waitForAnyRequest/Response.
 * Set abort to true to drop the request with an empty 200 response
 * instead of letting it through to the network.
 */
export interface RequestPattern {
  url: string;
  /** Default false. */
  abort?: boolean;
}

/** Action verb for a {@link HeaderModification}. */
export type HeaderModificationAction = "add" | "edit" | "remove";

/**
 * HeaderModification is one entry passed to {@link CloudBrowser.modifyRequest}.
 * Write it as a plain object literal.
 */
export interface HeaderModification {
  /**
   * `"add"` inserts a new header, `"edit"` replaces an existing header's
   * value, `"remove"` drops the header.
   */
  action: HeaderModificationAction;

  /** Header name the action applies to. */
  name: string;

  /** Header value for add/edit; ignored for remove. */
  value?: string;

  /**
   * Positions an `"add"` immediately before the named existing header;
   * otherwise the header is appended at the end. Ignored for edit/remove.
   */
  before?: string;

  /**
   * Positions an `"add"` immediately after the named existing header.
   * Mirror of `before`; ignored for edit/remove.
   */
  after?: string;
}
