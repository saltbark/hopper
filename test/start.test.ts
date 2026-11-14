import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { addAccount, OVERNIGHT_DEFAULTS, type Config } from '../src/config.ts'
import { listDrafts, saveDraft, type Draft } from '../src/drafts.ts'
import { initHome, loadProjects } from '../src/home.ts'
import { AlreadyStartingError, isStarting, startDraft } from '../src/start.ts'
import { fakeClaude } from './helpers.ts'

describe('startDraft', () => {
  afterEach(() => {
    delete process.env['HOPPER_CLAUDE']
  })

  it('starts a draft once, however often it is asked while the first start is under way', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-start-'))
    await initHome(home)
    const log = join(home, 'calls.log')
    // A claude that takes its moment to background a session, as the real one does.
    process.env['HOPPER_CLAUDE'] = await fakeClaude(
      `echo "$*" >> "${log}"\nsleep 0.3\necho "backgrounded · abc12345 · name"`,
    )
    let config: Config = {
      path: join(home, 'config.toml'),
      accountsPath: join(home, 'accounts.toml'),
      home,
      accounts: [],
      routes: [],
      overnight: OVERNIGHT_DEFAULTS,
    }
    config = addAccount(config, { name: 'bh', label: 'Blue Heron', configDir: null })
    const project = (await loadProjects(home))[0]!
    const now = Date.now()
    const draft: Draft = {
      id: 'd1',
      project: project.key,
      text: 'hello',
      created: now,
      updated: now,
    }
    await saveDraft(home, draft)
    const account = config.accounts[0]!
    const go = () => startDraft({ config, project, account, draft, unattended: false })

    const first = go()
    expect(isStarting('d1')).toBe(true)
    await expect(go()).rejects.toBeInstanceOf(AlreadyStartingError)
    expect((await first).id).toBe('abc12345')
    expect(isStarting('d1')).toBe(false)
    // Once it has started the draft is gone, so a start that looked before then doesn't run it.
    expect(await listDrafts(home)).toEqual([])
    await expect(go()).rejects.toThrow('started already')
    const bg = (await readFile(log, 'utf8')).split('\n').filter((l) => l.startsWith('--bg'))
    expect(bg).toHaveLength(1)
  })
})
