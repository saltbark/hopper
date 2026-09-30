import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { markdownLines, plain, wrap } from '../src/tui/markdown.ts'
import { ReportPane, reportLines } from '../src/tui/panes/ReportPane.tsx'
import { T } from '../src/tui/theme.ts'

const show = (md: string, width = 40) => markdownLines(md, width).map(plain)

describe('markdownLines', () => {
  it('drops the markup and keeps its styling on the spans', () => {
    const [line] = markdownLines('Plain **bold** *it* `code` ~~gone~~', 60)
    expect(plain(line!)).toBe('Plain bold it code gone')
    expect(line!.find((s) => s.text === 'bold')).toMatchObject({ bold: true })
    expect(line!.find((s) => s.text === 'it')).toMatchObject({ italic: true })
    expect(line!.find((s) => s.text === 'code')).toMatchObject({ color: T.code })
    expect(line!.find((s) => s.text === 'gone')).toMatchObject({ strike: true })
  })

  it('shows a link as its text, carrying the URL', () => {
    const [line] = markdownLines('See [the post](https://example.com/a?b=1&c=2).', 60)
    expect(plain(line!)).toBe('See the post.')
    expect(line!.find((s) => s.text === 'the post')).toMatchObject({
      link: 'https://example.com/a?b=1&c=2',
      color: T.link,
    })
  })

  it('puts a blank line between blocks, and styles headings by depth', () => {
    const lines = markdownLines('# One\n## Two\nText.\n### Three', 40)
    expect(lines.map(plain)).toEqual(['One', '', 'Two', '', 'Text.', '', 'Three'])
    expect(lines[0]![0]).toMatchObject({ bold: true, color: T.hi })
    expect(lines[2]![0]).toMatchObject({ bold: true, color: T.focus })
  })

  it('hangs wrapped list items under their text, nested lists a step in', () => {
    expect(show('- one two three four five six\n  - nested seven eight nine\n- b', 16)).toEqual([
      '• one two three',
      '  four five six',
      '  • nested seven',
      '    eight nine',
      '• b',
    ])
  })

  it('numbers ordered lists from their start, lining the numbers up', () => {
    const md = Array.from({ length: 10 }, (_, i) => `${i + 3}. x`).join('\n')
    const lines = show(md)
    expect(lines[0]).toBe(' 3. x')
    expect(lines[9]).toBe('12. x')
  })

  it('draws task items as boxes, the done ones dimmed', () => {
    const lines = markdownLines('- [ ] todo\n- [x] done', 40)
    expect(lines.map(plain)).toEqual(['☐ todo', '☑ done'])
    expect(lines[1]!.at(-1)).toMatchObject({ color: T.dim })
  })

  it('keeps code blocks as written, cut rather than wrapped', () => {
    expect(show('```\nconst a = 1\n' + 'x'.repeat(30) + '\n```', 20)).toEqual([
      '  const a = 1',
      '  ' + 'x'.repeat(17) + '…',
    ])
  })

  it('draws blockquotes with a bar and rules across the width', () => {
    expect(show('> quoted words here\n\n---', 12)).toEqual([
      '│ quoted',
      '│ words here',
      '',
      '─'.repeat(12),
    ])
  })

  it('lays a table out in columns when it fits, and as labelled rows when it does not', () => {
    const md = '| Name | Count |\n|---|--:|\n| a | 1 |\n| long | 22 |'
    expect(show(md, 40)).toEqual(['Name │ Count', '─────┼──────', 'a    │     1', 'long │    22'])
    expect(show(md, 10)).toEqual(['Name: a', 'Count: 1', '', 'Name: long', 'Count: 22'])
  })

  it('never draws a line wider than the panel', () => {
    const md = [
      '# A heading that goes on for quite a while',
      '- [ ] a task with `a-very-long-identifier-that-cannot-break` in it',
      '  1. nested **bold words** and [a link](https://example.com) too',
      '> a quote with ' + 'z'.repeat(50),
      '| a | b |\n|---|---|\n| ' + 'y'.repeat(40) + ' | c |',
    ].join('\n\n')
    for (const w of [12, 20, 33, 60])
      for (const l of markdownLines(md, w)) expect(plain(l).length).toBeLessThanOrEqual(w)
  })
})

describe('wrap', () => {
  it('breaks only at spaces, even where a word runs across spans', () => {
    const lines = wrap(
      [{ text: 'see ' }, { text: 'file.md', color: T.code }, { text: '; then more' }],
      12,
    )
    expect(lines.map(plain)).toEqual(['see file.md;', 'then more'])
  })
  it('cuts a word longer than the width across lines', () => {
    expect(wrap([{ text: 'ab ' + 'c'.repeat(10) }], 4).map(plain)).toEqual([
      'ab',
      'cccc',
      'cccc',
      'cc',
    ])
  })
  it('keeps hard line breaks', () => {
    expect(show('one  \ntwo')).toEqual(['one', 'two'])
  })
})

describe('ReportPane', () => {
  const report = { name: 'x.md', path: '/x.md', at: 0, unread: false } as never
  it('leaves off frontmatter and an older report’s needs: line', () => {
    const lines = reportLines('---\na: b\n---\nneeds: you\n## Hi\nBody', 40).map(plain)
    expect(lines).toEqual(['Hi', '', 'Body'])
  })
  it('draws the laid-out markdown, a link as its text with a terminal hyperlink round it', () => {
    const text = '## Decide\n- **Pick** one: [the memo](https://example.com/memo)'
    const { lastFrame } = render(
      <ReportPane
        routine="brief"
        report={report}
        text={text}
        scroll={0}
        index={0}
        count={1}
        width={50}
        height={12}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Decide')
    expect(f).toContain('• Pick one: ')
    expect(f).not.toContain('**')
    expect(f).toContain('\u001b]8;;https://example.com/memo\u0007the memo\u001b]8;;\u0007')
  })
})
