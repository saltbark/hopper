import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConversations, recordConversation } from '../src/conversations.ts'
import { loadDone, setDone } from '../src/done.ts'
import { writeAtomic } from '../src/fsutil.ts'

const newHome = async () => {
  const home = await mkdtemp(join(tmpdir(), 'hopper-fs-'))
  await mkdir(join(home, 'state'))
  return home
}

describe('state files', () => {
  it('two writes to one file at once both land whole, and leave no temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hopper-fs-'))
    const path = join(dir, 'f.txt')
    await Promise.all([writeAtomic(path, 'a'.repeat(100_000)), writeAtomic(path, 'b')])
    expect(['a'.repeat(100_000), 'b']).toContain(await readFile(path, 'utf8'))
    expect(await readdir(dir)).toEqual(['f.txt'])
  })

  it('changes made at the same moment all survive', async () => {
    const home = await newHome()
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((id, i) =>
        recordConversation(home, id, { project: 'p', startedAt: i }),
      ),
    )
    expect(Object.keys(await loadConversations(home)).sort()).toEqual(['a', 'b', 'c', 'd'])
    await Promise.all(['x', 'y', 'z'].map((s) => setDone(home, s, true)))
    await setDone(home, 'y', false)
    expect([...(await loadDone(home))]).toEqual(['x', 'z'])
  })

  it('a file that no longer parses is set aside, not written over', async () => {
    const home = await newHome()
    const broken = '{"sessions": ["kept-by-hand"'
    await writeFile(join(home, 'state', 'done.json'), broken)
    expect(await loadDone(home)).toEqual(new Set())
    await setDone(home, 's1', true)
    expect([...(await loadDone(home))]).toEqual(['s1'])
    const aside = (await readdir(join(home, 'state'))).find((f) =>
      f.startsWith('done.json.unreadable-'),
    )
    expect(aside).toBeDefined()
    expect(await readFile(join(home, 'state', aside!), 'utf8')).toBe(broken)
  })
})
