/** StorageItem is a single localStorage key/value pair. */
export interface StorageItem {
  key: string;
  value: string;
}

/**
 * StorageOriginEntry groups the localStorage entries of one origin
 * (e.g. "https://example.com"). getStorage() returns these and
 * setStorage() accepts the same shape, so a dump can be fed back verbatim.
 */
export interface StorageOriginEntry {
  origin: string;
  items: StorageItem[];
}
