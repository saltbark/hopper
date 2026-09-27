// Compact durations: 45s, 12m, 3h, 5d.
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export const ago = (ms: number, now = Date.now()): string => duration(now - ms)
export const until = (ms: number, now = Date.now()): string => duration(ms - now)

// A cached window whose reset time has passed says nothing about now.
export function isStale(iso: string | null, now = Date.now()): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return !Number.isNaN(t) && t <= now
}

// When a usage window resets: "in 1h 35m" for soon, "Tue 23:00" for later, "reset" once passed.
export function resetShort(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  if (t <= now) return 'reset'
  const mins = Math.round((t - now) / 60_000)
  if (mins < 60) return `in ${mins}m`
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
  const d = new Date(t)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

// A moment people can read at a glance: "Mon 28 Sept, 07:00".
export const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

// Fits text to a column: pads short text, cuts long text with an ellipsis, keeps one space after.
export function cell(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (width <= 0) return ''
  if (text.length > width - 1) return text.slice(0, Math.max(0, width - 2)) + '… '
  return align === 'right' ? text.padStart(width - 1) + ' ' : text.padEnd(width)
}

// Wraps text to a width, keeping blank lines and splitting words longer than the width.
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(4, width)
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (let word of para.split(/ +/)) {
      while (word.length > w) {
        if (line) out.push(line)
        out.push(word.slice(0, w))
        word = word.slice(w)
        line = ''
      }
      if (!line) line = word
      else if (line.length + 1 + word.length <= w) line += ' ' + word
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}
