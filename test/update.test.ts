import { mkdir, mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHECK_EVERY, installedVersion, latest, newer } from '../src/update.ts'

describe('newer', () => {
  it('compares x.y.z part by part', () => {
    expect(newer('0.4.11', '0.4.10')).toBe(true)
    expect(newer('0.5.0', '0.4.10')).toBe(true)
    expect(newer('1.0.0', '0.99.99')).toBe(true)
    expect(newer('0.4.10', '0.4.10')).toBe(false)
    expect(newer('0.4.9', '0.4.10')).toBe(false)
    expect(newer('v0.4.11', '0.4.10')).toBe(true)
  })
  it('never calls something that is not a version newer', () => {
    expect(newer('', '0.4.10')).toBe(false)
    expect(newer('soon', '0.4.10')).toBe(false)
    expect(newer('0.4.11', 'dev')).toBe(false)
  })
})

describe('latest', () => {
  afterEach(() => void vi.unstubAllGlobals())
  const site = (answers: unknown[]) => {
    const asked = { n: 0 }
    vi.stubGlobal('fetch', async () => {
      const a = answers[Math.min(asked.n++, answers.length - 1)]
      return a === null
        ? new Response('', { status: 500 })
        : new Response(JSON.stringify(a), { status: 200 })
    })
    return asked
  }

  it('asks the site at most every few hours, keeping the answer in between', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-update-'))
    const asked = site([
      { version: '0.4.11', notes: ['Better.'] },
      { version: '0.4.12', notes: [] },
    ])
    const t = 1_000_000
    expect(await latest(home, false, t)).toEqual({ version: '0.4.11', notes: ['Better.'] })
    expect(await latest(home, false, t + 60_000)).toEqual({ version: '0.4.11', notes: ['Better.'] })
    expect(asked.n).toBe(1)
    expect((await latest(home, false, t + CHECK_EVERY))?.version).toBe('0.4.12')
    expect(asked.n).toBe(2)
  })

  it('asks again when forced, and keeps the last answer when the site fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-update-'))
    const asked = site([{ version: '0.4.11', notes: [] }, null])
    expect((await latest(home, false, 0))?.version).toBe('0.4.11')
    expect((await latest(home, true, 1))?.version).toBe('0.4.11')
    expect(asked.n).toBe(2)
  })

  it('ignores an answer without a version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-update-'))
    site([{ notes: ['?'] }])
    expect(await latest(home, false, 0)).toBeNull()
  })
})

describe('installedVersion', () => {
  it('is the version current points at', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hopper-app-'))
    expect(await installedVersion(dir)).toBeNull()
    await mkdir(join(dir, '0.4.11'))
    await symlink('0.4.11', join(dir, 'current'))
    expect(await installedVersion(dir)).toBe('0.4.11')
  })
})
