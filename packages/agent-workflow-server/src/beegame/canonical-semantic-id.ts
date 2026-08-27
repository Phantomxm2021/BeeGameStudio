const CANONICAL_SEMANTIC_SEGMENT = '[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*'
const CANONICAL_SEMANTIC_ID_SOURCE = `${CANONICAL_SEMANTIC_SEGMENT}(?:\\.${CANONICAL_SEMANTIC_SEGMENT})+`

/** One canonical lower-case dotted semantic ID; no aliases or partial matches. */
export const CANONICAL_SEMANTIC_ID = new RegExp(`^${CANONICAL_SEMANTIC_ID_SOURCE}$`)

const CANONICAL_SEMANTIC_ID_SCANNER = new RegExp(
  `(?<![A-Za-z0-9._/-])${CANONICAL_SEMANTIC_ID_SOURCE}(?![A-Za-z0-9_/-]|\\.{2}|\\.[A-Za-z0-9_-])`,
  'g',
)

export function scanCanonicalSemanticIds(
  value: string,
): Array<{ value: string; index: number }> {
  return [...value.matchAll(CANONICAL_SEMANTIC_ID_SCANNER)].map(match => ({
    value: match[0]!,
    index: match.index ?? 0,
  }))
}
