// The project tree: keys are folder-like, so every prefix is a node and every node collapses.

export type Counts = { open: number; run: number; you: number }

export type TreeRow = {
  key: string
  name: string
  depth: number
  // A key can be a project and a folder at once (sb/generaltext and sb/generaltext/apps/crum).
  isProject: boolean
  hasChildren: boolean
  folded: boolean
  counts: Counts
}

type Node = {
  key: string
  name: string
  isProject: boolean
  own: Counts
  children: Map<string, Node>
}

// Names starting with ~ (Hopper's own groups, like sessions outside every project) sort last.
const byName = (a: { name: string }, b: { name: string }) =>
  Number(a.name.startsWith('~')) - Number(b.name.startsWith('~')) || a.name.localeCompare(b.name)
const zero = (): Counts => ({ open: 0, run: 0, you: 0 })
const add = (a: Counts, b: Counts): Counts => ({
  open: a.open + b.open,
  run: a.run + b.run,
  you: a.you + b.you,
})

export function buildTree(
  entries: { key: string; isProject: boolean; counts: Counts }[],
  folded: Set<string>,
): TreeRow[] {
  const root: Node = { key: '', name: '', isProject: false, own: zero(), children: new Map() }
  for (const e of entries) {
    let node = root
    const parts = e.key.split('/')
    parts.forEach((part, i) => {
      const key = parts.slice(0, i + 1).join('/')
      let next = node.children.get(part)
      if (!next) {
        next = { key, name: part, isProject: false, own: zero(), children: new Map() }
        node.children.set(part, next)
      }
      node = next
    })
    node.isProject = node.isProject || e.isProject
    node.own = add(node.own, e.counts)
  }

  const total = (n: Node): Counts =>
    [...n.children.values()].reduce((c, ch) => add(c, total(ch)), n.own)
  const rows: TreeRow[] = []
  const walk = (n: Node, depth: number) => {
    for (const child of [...n.children.values()].sort(byName)) {
      const isFolded = folded.has(child.key)
      rows.push({
        key: child.key,
        name: child.name,
        depth,
        isProject: child.isProject,
        hasChildren: child.children.size > 0,
        folded: isFolded,
        counts: total(child),
      })
      if (!isFolded) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}
