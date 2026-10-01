import { access, open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Which model a conversation's replies actually came from, and when the newest came. Hopper asks for an alias (opus,
// opus[1m]) and Claude Code resolves it; each reply in the session's transcript carries the full
// id it ran on (claude-opus-5-5). The transcript doesn't say whether [1m] was on: that is a
// setting of the request, not part of the model's name.

// <config dir>/projects/<cwd, every other character a dash>/<session id>.jsonl. The default
// login's config dir is ~/.claude.
export const transcriptPath = (configDir: string | null, cwd: string, sessionId: string) =>
  join(
    configDir ?? join(homedir(), '.claude'),
    'projects',
    cwd.replace(/[^A-Za-z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  )

// A session that enters a worktree carries on in the worktree's folder, so its transcript can
// sit under any folder of the login's projects/. Where one was found is kept, and a search that
// found nothing isn't repeated for a minute.
const found = new Map<string, string>()
const missed = new Map<string, number>()
const RETRY = 60_000

export async function findTranscript(
  configDir: string | null,
  cwd: string,
  sessionId: string,
  now = Date.now(),
): Promise<string | null> {
  const there = (p: string) =>
    access(p).then(
      () => true,
      () => false,
    )
  const known = found.get(sessionId)
  if (known && (await there(known))) return known
  const direct = transcriptPath(configDir, cwd, sessionId)
  if (await there(direct)) return direct
  if ((missed.get(sessionId) ?? 0) > now - RETRY) return null
  const projects = join(configDir ?? join(homedir(), '.claude'), 'projects')
  for (const dir of await readdir(projects).catch(() => [])) {
    const p = join(projects, dir, `${sessionId}.jsonl`)
    if (await there(p)) {
      found.set(sessionId, p)
      missed.delete(sessionId)
      return p
    }
  }
  missed.set(sessionId, now)
  return null
}

// Replies are near the end; a long tool output can push the last one further back.
const TAIL = 256 * 1024
// A reply's model, written as JSON. Quotes inside a tool's output are escaped, so they don't match.
const MODEL = /"model":"([^"]+)"/g
// When Claude Code wrote the entry, on the same line.
const STAMP = /"timestamp":"([^"]+)"/
// What Claude Code writes for a message it made up itself (an error, an interruption).
const SYNTHETIC = '<synthetic>'

export type Reply = { model: string; at: number | null }

function lastIn(text: string): Reply | null {
  let last: Reply | null = null
  for (const line of text.split('\n')) {
    let model: string | null = null
    for (const m of line.matchAll(MODEL)) if (m[1] && m[1] !== SYNTHETIC) model = m[1]
    if (!model) continue
    const at = Date.parse(STAMP.exec(line)?.[1] ?? '')
    last = { model, at: Number.isNaN(at) ? null : at }
  }
  return last
}

// Read again only when the file has changed, since every poll asks.
const cache = new Map<string, { size: number; mtimeMs: number; reply: Reply | null }>()

// The newest reply's model and when it came, or null when there is no transcript or no reply yet.
export async function lastReply(path: string): Promise<Reply | null> {
  const s = await stat(path).catch(() => null)
  if (!s) return null
  const hit = cache.get(path)
  if (hit && hit.size === s.size && hit.mtimeMs === s.mtimeMs) return hit.reply
  const f = await open(path, 'r')
  try {
    const read = async (from: number) => {
      const buf = Buffer.alloc(s.size - from)
      await f.read(buf, 0, buf.length, from)
      return buf.toString('utf8')
    }
    let reply = lastIn(await read(Math.max(0, s.size - TAIL)))
    if (!reply && s.size > TAIL) reply = lastIn(await read(0))
    cache.set(path, { size: s.size, mtimeMs: s.mtimeMs, reply })
    return reply
  } finally {
    await f.close()
  }
}
