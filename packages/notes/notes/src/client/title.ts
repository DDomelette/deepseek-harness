/**
 * The title a material shows in the list and the detail: the reader's own
 * rename while one is stored, otherwise the body's first line.
 * @module @deepseek-ai/dsh-notes/client/title
 */

/** Longest a body-derived title runs, in grapheme clusters, before an ellipsis. */
export const DERIVED_TITLE_MAX = 40

/**
 * The title one material shows.
 * @param material - the title the reader set, the body, and the collection
 *   source's label (the fallback for a material without text, e.g. a
 *   screenshot).
 * @returns the stored title, or the body's first non-blank line trimmed and
 *   capped at {@link DERIVED_TITLE_MAX} code points, or the source label.
 */
export function materialTitle(material: {
  readonly title: string | null
  readonly text: string | null
  readonly source: { readonly label: string }
}): string {
  if (material.title !== null) return material.title
  const line = material.text?.split('\n').map(candidate => candidate.trim()).find(candidate => candidate !== '')
  if (line === undefined) return material.source.label
  // Grapheme clusters, not code units: a cap must not split an emoji.
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)]
  return graphemes.length <= DERIVED_TITLE_MAX
    ? line
    : `${graphemes.slice(0, DERIVED_TITLE_MAX).map(grapheme => grapheme.segment).join('')}…`
}
