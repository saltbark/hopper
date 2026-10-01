import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findTranscript, lastReply, transcriptPath } from '../src/transcript.ts'

const reply = (model: string, text = 'ok') =>
  JSON.stringify({
    type: 'assistant',
    message: { model, role: 'assistant', content: [{ text }] },
  }) + '\n'

describe('transcripts', () => {
  it('sits under the login, its folder named for the cwd with every other character a dash', () => {
    expect(transcriptPath('/c/.claude-sb', '/Users/me/proj_x/.claude', 'abc')).toBe(
      '/c/.claude-sb/projects/-Users-me-proj-x--claude/abc.jsonl',
    )
    expect(transcriptPath(null, '/w', 'abc')).toBe(join(homedir(), '.claude/projects/-w/abc.jsonl'))
  })
  it('reads the newest reply’s model, skipping made-up messages and quoted text', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'hopper-transcript-')), 's.jsonl')
    expect(await lastReply(path)).toBeNull()
    await writeFile(path, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
    expect(await lastReply(path)).toBeNull()
    await appendFile(path, reply('claude-sonnet-5-5'))
    await appendFile(path, reply('claude-opus-5-5', 'it said "model":"claude-haiku" once'))
    await appendFile(path, reply('<synthetic>'))
    expect((await lastReply(path))?.model).toBe('claude-opus-5-5')
    // A change to the file is read again.
    await appendFile(path, reply('claude-fable-5-1'))
    expect((await lastReply(path))?.model).toBe('claude-fable-5-1')
  })
  it('says when the newest reply came, from its own line', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'hopper-transcript-')), 's.jsonl')
    const at = (model: string, timestamp: string) =>
      JSON.stringify({ type: 'assistant', message: { model }, timestamp }) + '\n'
    await writeFile(path, at('claude-opus-5-5', '2026-09-30T10:00:00.000Z'))
    await appendFile(
      path,
      JSON.stringify({ type: 'user', timestamp: '2026-09-30T11:00:00Z' }) + '\n',
    )
    expect(await lastReply(path)).toEqual({
      model: 'claude-opus-5-5',
      at: Date.parse('2026-09-30T10:00:00.000Z'),
    })
    await appendFile(path, reply('claude-opus-5-5'))
    expect((await lastReply(path))?.at).toBeNull()
  })
  it('finds one that moved to a worktree’s folder', async () => {
    const login = await mkdtemp(join(tmpdir(), 'hopper-login-'))
    const moved = join(login, 'projects', '-w--claude-worktrees-x')
    await mkdir(moved, { recursive: true })
    await writeFile(join(moved, 'sid.jsonl'), reply('claude-opus-5-5'))
    expect(await findTranscript(login, '/w', 'sid')).toBe(join(moved, 'sid.jsonl'))
    expect(await findTranscript(login, '/w', 'nope')).toBeNull()
  })
})
