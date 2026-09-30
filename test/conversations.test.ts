import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  EFFORTS,
  loadConversations,
  MODELS,
  nextOf,
  recordConversation,
} from '../src/conversations.ts'
import { parseProjects } from '../src/home.ts'

describe('conversation records', () => {
  it('keep the model a conversation started with', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-conv-'))
    expect(await loadConversations(home)).toEqual({})
    await recordConversation(home, 'abc123', {
      project: 'meta/inbox',
      model: 'haiku',
      startedAt: 1,
    })
    await recordConversation(home, 'def456', { project: 'bh/atlas', startedAt: 2 })
    expect(await loadConversations(home)).toEqual({
      abc123: { project: 'meta/inbox', model: 'haiku', startedAt: 1 },
      def456: { project: 'bh/atlas', startedAt: 2 },
    })
  })
  it('cycle models and efforts through Claude’s default', () => {
    expect(nextOf(MODELS, undefined)).toBe('haiku')
    expect(nextOf(MODELS, 'fable')).toBeUndefined()
    expect(nextOf(EFFORTS, 'high')).toBeUndefined()
  })
  it('projects can set the model new conversations start with', () => {
    const [p] = parseProjects(
      '[[project]]\nkey = "meta/inbox"\nmodel = "haiku"\neffort = "low"\n',
      '/h',
    )
    expect(p).toMatchObject({ model: 'haiku', effort: 'low' })
  })
})
