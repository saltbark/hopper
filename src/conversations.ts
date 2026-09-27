import { join } from 'node:path'

import { readIfThere, writeJson } from './fsutil.ts'

// What Hopper knows about the conversations it started that Claude Code doesn't report: the model
// and effort they started with, and the routine a run belongs to. Keyed by the short session id.
export type ConversationMeta = {
  model?: string
  effort?: string
  project: string
  routine?: string
  startedAt: number
}

const file = (home: string) => join(home, 'state', 'conversations.json')

export async function loadConversations(home: string): Promise<Record<string, ConversationMeta>> {
  try {
    const raw = JSON.parse((await readIfThere(file(home))) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, ConversationMeta>) : {}
  } catch {
    return {}
  }
}

export async function recordConversation(
  home: string,
  id: string,
  meta: ConversationMeta,
): Promise<void> {
  const all = await loadConversations(home)
  all[id] = meta
  await writeJson(file(home), all)
}

// The models and efforts a draft cycles through; undefined means Claude's own default.
export const MODELS = [undefined, 'haiku', 'sonnet', 'opus', 'fable'] as const
export const EFFORTS = [undefined, 'low', 'medium', 'high'] as const

export function nextOf<T>(list: readonly (T | undefined)[], current: T | undefined): T | undefined {
  const i = list.indexOf(current)
  return list[(i + 1) % list.length]
}
