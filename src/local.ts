import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Auth } from './claude.ts'
import type { Account, Local } from './config.ts'
import { inTurn, readIfThere, writeJson } from './fsutil.ts'

// A local account is Claude Code with its own config folder, pointed at a model this machine
// serves (Ollama, which speaks Anthropic's API). The pointing is in that folder's settings.json,
// not in the environment Hopper passes, so everything run with the folder uses it: --bg, attach,
// -p, and `claude` typed by hand. Hopper never starts or stops the server; it only asks it.

// What a local account's server says, shown where a login shows its plan.
export type LocalStatus = {
  model: string
  // Why it can't run work, when it can't.
  reason?: string
  // While the model is in memory: the window it was loaded with, how much memory it holds, and
  // when the server lets it go if nothing uses it.
  loaded?: { context: number; bytes: number; expiresAt: string | null }
}

// Every model alias maps to the local model, so Claude Code's own side calls (titles, subagents)
// stay on the machine too.
export function localEnv(local: Local): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: local.baseUrl,
    // The server doesn't check it; with a token set, Claude Code counts itself signed in.
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_MODEL: local.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: local.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: local.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: local.model,
    CLAUDE_CODE_SUBAGENT_MODEL: local.model,
    // Claude Code doesn't know the model, so it would assume a 200k window and not compact in
    // time; past the server's window, the server drops the start of the conversation unsaid.
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(local.context),
    // No telemetry or update checks from a folder that has no login to send them for.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }
}

export const settingsPath = (configDir: string) => join(configDir, 'settings.json')

// Puts localEnv into the folder's settings.json, keeping whatever else is there, and writes
// only when something changed. A settings file that doesn't parse is left alone: it's yours.
export async function writeLocalSettings(configDir: string, local: Local): Promise<void> {
  const path = settingsPath(configDir)
  await mkdir(configDir, { recursive: true })
  await inTurn(path, async () => {
    const text = await readIfThere(path)
    let settings: Record<string, unknown>
    try {
      settings = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      throw new Error(`${path} isn't JSON; fix it and Hopper will add the local model's settings`)
    }
    const env = { ...(settings['env'] as Record<string, string> | undefined), ...localEnv(local) }
    const next = { ...settings, env }
    if (JSON.stringify(next) !== JSON.stringify(settings)) await writeJson(path, next)
  })
}

type Fetch = typeof fetch

// Ollama names a model "name:tag", and "name" alone means "name:latest".
const sameModel = (a: string, b: string) => a === b || a === `${b}:latest` || b === `${a}:latest`

async function getJson(fetcher: Fetch, url: string): Promise<Record<string, unknown>> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

// Whether the server answers and has the model. Never throws: a server that's down is a state
// to show, not an error, and it must stop work being routed here as soon as it's noticed.
export async function localStatus(local: Local, fetcher: Fetch = fetch): Promise<LocalStatus> {
  const status: LocalStatus = { model: local.model }
  let tags: Record<string, unknown>
  try {
    tags = await getJson(fetcher, `${local.baseUrl}/api/tags`)
  } catch {
    return { ...status, reason: `Ollama isn't answering at ${local.baseUrl}` }
  }
  const names = (Array.isArray(tags['models']) ? tags['models'] : []).map((m) =>
    String((m as Record<string, unknown>)['name'] ?? ''),
  )
  if (!names.some((n) => sameModel(n, local.model)))
    return { ...status, reason: `Ollama has no ${local.model} yet` }
  try {
    const ps = await getJson(fetcher, `${local.baseUrl}/api/ps`)
    const m = (Array.isArray(ps['models']) ? ps['models'] : [])
      .map((x) => x as Record<string, unknown>)
      .find((x) => sameModel(String(x['name'] ?? ''), local.model))
    if (m)
      status.loaded = {
        context: typeof m['context_length'] === 'number' ? m['context_length'] : 0,
        bytes: typeof m['size_vram'] === 'number' ? m['size_vram'] : 0,
        expiresAt: typeof m['expires_at'] === 'string' ? m['expires_at'] : null,
      }
  } catch {
    // What's loaded is only shown; the model being there is what matters.
  }
  return status
}

// A local account's stand-in for `claude auth status`: its folder set up, its server asked.
export async function localAuth(
  account: Account & { local: Local },
  fetcher: Fetch = fetch,
): Promise<Auth> {
  if (account.configDir) await writeLocalSettings(account.configDir, account.local)
  const local = await localStatus(account.local, fetcher)
  return { loggedIn: !local.reason, local }
}
