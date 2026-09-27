// Subsequence match, so "con" finds kf/console and "mi" finds meta/inbox.
export function fuzzy(query: string, key: string): boolean {
  let i = 0
  for (const ch of key.toLowerCase()) if (ch === query[i]?.toLowerCase()) i++
  return i === query.length
}

// Matches, best first: a straight substring before a scattered match, then shorter, then A–Z.
export const rank = (query: string, keys: string[]) =>
  keys
    .filter((k) => fuzzy(query, k))
    .sort(
      (a, b) =>
        Number(!a.includes(query)) - Number(!b.includes(query)) ||
        a.length - b.length ||
        a.localeCompare(b),
    )

// Every key and every folder above one: kf/aas/bulletin gives kf, kf/aas and kf/aas/bulletin.
export function withFolders(keys: string[]): string[] {
  const out = new Set<string>()
  for (const k of keys) {
    const parts = k.split('/')
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  return [...out]
}
