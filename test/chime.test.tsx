import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { newlyWaiting } from '../src/chime.ts'
import type { Item, Snapshot } from '../src/model.ts'
import { useChime } from '../src/tui/hooks.ts'

const item = (sessionId: string, where: Item['where']): Item =>
  ({ sessionId, where, key: 'meta/inbox', kind: 'background', state: '' }) as Item
const snap = (items: Item[]) => ({ items }) as Snapshot
const tick = () => new Promise((r) => setTimeout(r, 30))

describe('newlyWaiting', () => {
  it('finds what was running and now waits', () => {
    const prev = [item('a', 'queue'), item('b', 'queue'), item('c', 'needs')]
    const next = [item('a', 'needs'), item('b', 'queue'), item('c', 'needs')]
    expect(newlyWaiting(prev, next, null).map((i) => i.sessionId)).toEqual(['a'])
  })

  it('says nothing on the first look', () => {
    expect(newlyWaiting(null, [item('a', 'needs')], null)).toEqual([])
  })

  it('leaves out the conversation on screen', () => {
    expect(newlyWaiting([item('a', 'queue')], [item('a', 'needs')], 'a')).toEqual([])
  })

  it('ignores drafts, marks and anything that was not running', () => {
    const prev = [item('a', 'done'), item('b', 'needs'), item('d', 'routine')]
    const next = [item('a', 'needs'), item('b', 'done'), item('d', 'needs'), item('e', 'needs')]
    expect(newlyWaiting(prev, next, null)).toEqual([])
  })
})

describe('useChime', () => {
  const Probe = (p: { snap: Snapshot; sound?: string; onScreen?: string; played: string[] }) => {
    useChime(p.snap, p.sound, p.onScreen ?? null, (s) => p.played.push(s))
    return <Text>.</Text>
  }

  it('plays once a look, with the chosen sound or the default', async () => {
    const played: string[] = []
    const { rerender, unmount } = render(
      <Probe snap={snap([item('a', 'queue'), item('b', 'queue')])} played={played} />,
    )
    await tick()
    rerender(<Probe snap={snap([item('a', 'needs'), item('b', 'needs')])} played={played} />)
    await tick()
    expect(played).toEqual(['Glass'])
    rerender(<Probe snap={snap([item('c', 'queue')])} sound="Pop" played={played} />)
    await tick()
    rerender(<Probe snap={snap([item('c', 'needs')])} sound="Pop" played={played} />)
    await tick()
    expect(played).toEqual(['Glass', 'Pop'])
    unmount()
  })

  it('stays quiet for the one on screen', async () => {
    const played: string[] = []
    const { rerender, unmount } = render(
      <Probe snap={snap([item('a', 'queue')])} onScreen="a" played={played} />,
    )
    await tick()
    rerender(<Probe snap={snap([item('a', 'needs')])} onScreen="a" played={played} />)
    await tick()
    expect(played).toEqual([])
    unmount()
  })
})
