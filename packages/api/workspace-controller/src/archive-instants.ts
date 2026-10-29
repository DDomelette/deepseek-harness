/** Shared comparison for the archive-instant map the registry stamps per archived Session. */

/**
 * Compare two archive-instant maps by key and value.
 *
 * The registry keeps `archivedSessionAts` key-equal to `archivedSessionIds`, so
 * a changed instant is a real archive change even when the id list is
 * unchanged — unarchive and re-archive restamp the same id.
 * @param left - first instant map.
 * @param right - second instant map.
 * @returns whether both maps carry the same keys and values.
 */
export function sameArchiveInstants(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => left[key] === right[key])
}
