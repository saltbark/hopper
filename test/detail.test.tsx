import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { CHOICE_DEFAULTS } from '../src/config.ts'
import type { Draft } from '../src/drafts.ts'
import type { Item } from '../src/model.ts'
import { DraftDetail } from '../src/tui/panels/detail/ItemDetail.tsx'

const draft: Draft = { id: 'a-1', project: 'bh/atlas', text: 'Tidy up', created: 1, updated: 1 }
const item = { name: 'Tidy up', key: 'bh/atlas', state: 'draft', startedAt: 1 } as Item

const shown = (account: string, d: Draft) =>
  render(
    <DraftDetail item={{ ...item, account }} draft={d} defaults={CHOICE_DEFAULTS} width={100} />,
  ).lastFrame()!

describe("a draft's account", () => {
  it('is named when picked by hand, and says the route picked it otherwise', () => {
    const picked = shown('pm', { ...draft, account: 'pm' })
    expect(picked).toContain('account: pm')
    expect(picked).not.toContain('(by route)')
    const routed = shown('bh', draft)
    expect(routed).toContain('bh (by route)')
  })
})
