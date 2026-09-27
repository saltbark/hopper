import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { countOpen, initHome, loadProjects, parseProjects } from '../src/home.ts'

describe('parseProjects', () => {
  it('defaults path and open file from the key', () => {
    const [p] = parseProjects('[[project]]\nkey = "meta/inbox"\n', '/h')
    expect(p).toEqual({
      key: 'meta/inbox',
      path: '/h/projects/meta/inbox',
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
    expect((await loadProjects(home)).map((p) => p.key)).toEqual(['meta/inbox', 'meta/ideas'])

    await writeFile(join(home, 'projects', 'meta', 'inbox', '_open.md'), 'mine\n')
    expect(await initHome(home)).toEqual([])
    expect(await readFile(join(home, 'projects', 'meta', 'inbox', '_open.md'), 'utf8')).toBe(
      'mine\n',
    )
  })
})
