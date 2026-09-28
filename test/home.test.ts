import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  countOpen,
  extraDirs,
  initHome,
  loadProjects,
  parsePathsLocal,
  parseProjects,
} from '../src/home.ts'
import { hopperPrompt } from '../src/prompts.ts'

describe('parseProjects', () => {
  it('defaults path and open file from the key', () => {
    const [p] = parseProjects('[[project]]\nkey = "meta/inbox"\n', '/h')
    expect(p).toEqual({
      key: 'meta/inbox',
      path: '/h/projects/meta/inbox',
      // Projects in the home folder run from it, so they share its CLAUDE.md.
      runIn: '/h',
      openFile: '/h/projects/meta/inbox/_open.md',
    })
  })
  it('takes an explicit path and open file', () => {
    const [p] = parseProjects(
      '[[project]]\nkey = "kf/console"\npath = "/w/console"\nopen_file = "/w/kf-meta/planning/kf/console/_open.md"\n',
      '/h',
    )
    expect(p?.path).toBe('/w/console')
    expect(p?.openFile).toBe('/w/kf-meta/planning/kf/console/_open.md')
  })
  it('rejects bad and duplicate keys', () => {
    expect(() => parseProjects('[[project]]\nkey = "Meta Inbox"\n', '/h')).toThrow(
      /key must look like/,
    )
    expect(() =>
      parseProjects('[[project]]\nkey = "a/b"\n[[project]]\nkey = "a/b"\n', '/h'),
    ).toThrow(/twice/)
  })
})

describe('countOpen', () => {
  it('counts unchecked task lines only', () => {
    const md =
      '# x\n\n## Build\n- [ ] **One** — a\n- [x] done\n  - [ ] nested\nprose - [ ] not a task\n* [ ] star\n'
    expect(countOpen(md)).toBe(3)
  })
})

describe('initHome', () => {
  it('creates the skeleton once and never overwrites', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-'))
    const first = await initHome(home)
    expect(first).toContain('projects.toml')
    expect(first).toContain('projects/meta/inbox/_open.md')
    expect((await loadProjects(home)).map((p) => p.key)).toEqual(['meta/inbox'])

    await writeFile(join(home, 'projects', 'meta', 'inbox', '_open.md'), 'mine\n')
    expect(await initHome(home)).toEqual([])
    expect(await readFile(join(home, 'projects', 'meta', 'inbox', '_open.md'), 'utf8')).toBe(
      'mine\n',
    )
  })
})

describe('sources', () => {
  // A meta repo with two checked-out projects (one reached through a symlink) and one that
  // isn't on this machine, and a Hopper home that imports it under "sb".
  const setup = async (source: string) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'hopper-src-')))
    const meta = join(root, 'sb-meta')
    await mkdir(join(meta, 'planning', 'saltbark', 'hopper'), { recursive: true })
    await mkdir(join(root, 'proj_hopper'))
    await mkdir(join(root, 'gt', 'crum'), { recursive: true })
    await symlink(join(root, 'gt'), join(root, 'gt-link'))
    await writeFile(
      join(meta, 'paths.local'),
      [
        '# paths.local',
        '',
        `saltbark/hopper=${root}/proj_hopper`,
        `generaltext/apps/crum=${root}/gt-link/crum`,
        `saltbark/gone=${root}/not-here`,
        'Bad Key=/x',
      ].join('\n'),
    )
    const home = join(root, 'home')
    await initHome(home)
    const toml = await readFile(join(home, 'projects.toml'), 'utf8')
    await writeFile(join(home, 'projects.toml'), toml + source.replaceAll('META', meta))
    return { root, meta, home }
  }

  it('reads paths.local, skipping comments and keys Hopper cannot use', () => {
    expect(parsePathsLocal('# c\n\na/b=~/x\nBad=/y\nnoequals\n')).toEqual([
      { key: 'a/b', path: join(process.env['HOME'] ?? '', 'x') },
    ])
  })

  it('lists what the registry has checked out here, under the prefix, with the meta repo', async () => {
    const { root, meta, home } = await setup('\n[[source]]\nprefix = "sb"\nrepo = "META"\n')
    const projects = await loadProjects(home)
    expect(projects.map((p) => p.key)).toEqual([
      'meta/inbox',
      'sb/meta',
      'sb/saltbark/hopper',
      'sb/generaltext/apps/crum',
    ])
    const hopper = projects.find((p) => p.key === 'sb/saltbark/hopper')
    expect(hopper).toEqual({
      key: 'sb/saltbark/hopper',
      path: join(root, 'proj_hopper'),
      runIn: meta,
      openFile: join(meta, 'planning', 'saltbark', 'hopper', '_open.md'),
      meta: { repo: meta, key: 'saltbark/hopper' },
    })
    // Symlinks resolve, since Claude reports the physical cwd.
    expect(projects.find((p) => p.key === 'sb/generaltext/apps/crum')?.path).toBe(
      join(root, 'gt', 'crum'),
    )
  })

  it('strips the leading segment, and lets a [[project]] add to an imported one', async () => {
    const { home } = await setup(
      '\n[[source]]\nprefix = "sb"\nrepo = "META"\nstrip = "saltbark"\n\n[[project]]\nkey = "sb/hopper"\nmodel = "opus"\n',
    )
    const projects = await loadProjects(home)
    expect(projects.map((p) => p.key)).toContain('sb/generaltext/apps/crum')
    const hopper = projects.find((p) => p.key === 'sb/hopper')
    expect(hopper?.model).toBe('opus')
    expect(hopper?.meta?.key).toBe('saltbark/hopper')
    expect(projects.filter((p) => p.key === 'sb/hopper')).toHaveLength(1)
  })

  it('skips a source not on this machine, and refuses a key from two places', async () => {
    const missing = await setup('\n[[source]]\nprefix = "kf"\nrepo = "/no/such/meta"\n')
    expect((await loadProjects(missing.home)).map((p) => p.key)).toEqual(['meta/inbox'])
    const twice = await setup(
      '\n[[source]]\nprefix = "sb"\nrepo = "META"\n[[source]]\nprefix = "sb"\nrepo = "META"\n',
    )
    await expect(loadProjects(twice.home)).rejects.toThrow(/two places/)
  })

  it('runs a registry project from the meta repo, through its symlink when there is one', async () => {
    const { root, meta, home } = await setup('\n[[source]]\nprefix = "sb"\nrepo = "META"\n')
    await mkdir(join(meta, 'projects', 'saltbark'), { recursive: true })
    await symlink(join(root, 'proj_hopper'), join(meta, 'projects', 'saltbark', 'hopper'))
    const hopper = (await loadProjects(home)).find((p) => p.key === 'sb/saltbark/hopper')!
    expect(hopper.meta?.link).toBe(join(meta, 'projects', 'saltbark', 'hopper'))
    expect(hopperPrompt(hopper)).toContain(
      `code is in ${hopper.meta?.link} (a link to ${hopper.path})`,
    )
  })

  it('runs in each project with run_in = "project", adding the planning folder instead', async () => {
    const { meta, home } = await setup(
      '\n[[source]]\nprefix = "sb"\nrepo = "META"\nrun_in = "project"\n',
    )
    const hopper = (await loadProjects(home)).find((p) => p.key === 'sb/saltbark/hopper')!
    expect(hopper.runIn).toBe(hopper.path)
    expect(extraDirs(hopper)).toEqual([join(meta, 'planning', 'saltbark', 'hopper')])
  })

  it('gives a conversation what it needs outside the meta repo, and points it at the rules', async () => {
    const { meta, home } = await setup('\n[[source]]\nprefix = "sb"\nrepo = "META"\n')
    const projects = await loadProjects(home)
    const hopper = projects.find((p) => p.key === 'sb/saltbark/hopper')!
    // It runs from the meta repo; only its own folder, outside it, needs adding.
    expect(extraDirs(hopper)).toEqual([hopper.path])
    expect(hopperPrompt(hopper)).toContain(`${meta}/CLAUDE.md`)
    expect(hopperPrompt(hopper)).toContain(`code is in ${hopper.path}`)
    expect(hopperPrompt(hopper)).not.toContain('"## Open"')
    const inbox = projects.find((p) => p.key === 'meta/inbox')!
    expect(extraDirs(inbox)).toEqual([])
    expect(extraDirs(projects.find((p) => p.key === 'sb/meta')!)).toEqual([])
  })
})
