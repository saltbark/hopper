import { join } from 'node:path'

import { readIfThere, writeJson } from './fsutil.ts'

// The latest report of each routine I've looked at. A routine whose newest report says it needs
// me is marked on its row until I open its reports (o).

const file = (home: string) => join(home, 'state', 'seen.json')

export async function loadSeen(home: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse((await readIfThere(file(home))) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export async function markSeen(home: string, routine: string, report: string): Promise<void> {
  const all = await loadSeen(home)
  if (all[routine] === report) return
  await writeJson(file(home), { ...all, [routine]: report })
}
