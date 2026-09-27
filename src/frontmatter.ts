// The small front matter Hopper's own files use: `key: value` lines between `---` fences, then
// the body. Not YAML: values are single-line strings, which is all drafts and routines need.

export type Fields = Record<string, string>

export function parseFrontmatter(text: string): { fields: Fields; body: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  const fields: Fields = {}
  for (const line of (m[1] ?? '').split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { fields, body: m[2] ?? '' }
}

// Fields left undefined are left out.
export function serializeFrontmatter(
  fields: Record<string, string | undefined>,
  body: string,
): string {
  const lines = Object.entries(fields)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// A timestamp field read back, or 0 when it's missing or unreadable.
export const timeField = (s: string | undefined) =>
  s && !Number.isNaN(Date.parse(s)) ? Date.parse(s) : 0
