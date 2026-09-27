// Schedules in words, and when they next fire.

// One time a routine runs. weekday is 0 (Sunday) to 6; day is the day of the month.
export type Slot = { hour: number; minute: number; weekday?: number; day?: number }

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Understands: "daily 7:00", "weekdays 7:00, 13:00", "weekends 10:00", "weekly mon 9:00",
// "mon,wed,fri 9:00", "monthly 1st 9:00", "hourly". Empty means no schedule (run now only).
export function parseSchedule(text: string): Slot[] | string {
  const t = text.trim().toLowerCase()
  if (!t) return []
  if (t === 'hourly') return [{ hour: -1, minute: 0 }]
  const times = [...t.matchAll(/(\d{1,2}):(\d{2})\s*(am|pm)?/g)].map((m) => {
    let hour = Number(m[1])
    if (m[3] === 'pm' && hour < 12) hour += 12
    if (m[3] === 'am' && hour === 12) hour = 0
    return { hour, minute: Number(m[2]) }
  })
  if (!times.length || times.some((x) => x.hour > 23 || x.minute > 59)) {
    return `"${text}": give a time like 7:00 or 13:30`
  }
  const words = t
    .replace(/(\d{1,2}):(\d{2})\s*(am|pm)?/g, ' ')
    .replace(/[,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const first = words[0] ?? 'daily'
  const every = (weekdays: number[]) =>
    weekdays.flatMap((weekday) => times.map((x) => ({ ...x, weekday })))
  if (first === 'daily' || first === 'every' || first === 'day') return times
  if (first === 'weekdays') return every([1, 2, 3, 4, 5])
  if (first === 'weekends') return every([0, 6])
  if (first === 'monthly') {
    const day = Number((words[1] ?? '1').replace(/(st|nd|rd|th)$/, ''))
    if (!(day >= 1 && day <= 28)) return `"${text}": monthly needs a day from 1st to 28th`
    return times.map((x) => ({ ...x, day }))
  }
  const dayWords = first === 'weekly' ? words.slice(1) : words
  const weekdays = dayWords.map((w) => DAYS.indexOf(w.slice(0, 3)))
  if (!weekdays.length || weekdays.some((d) => d < 0)) {
    return `"${text}": try daily 7:00, weekdays 7:00, weekly mon 9:00, or monthly 1st 9:00`
  }
  return every(weekdays)
}

export function checkSchedule(text: string): string | null {
  const s = parseSchedule(text)
  return typeof s === 'string' ? s : null
}

// The next time after `from` any slot fires, or null for a routine with no schedule.
export function nextRun(schedule: string, from: Date): Date | null {
  const slots = parseSchedule(schedule)
  if (typeof slots === 'string' || !slots.length) return null
  let best: Date | null = null
  for (let d = 0; d <= 62; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d)
    for (const s of slots) {
      if (s.weekday !== undefined && day.getDay() !== s.weekday) continue
      if (s.day !== undefined && day.getDate() !== s.day) continue
      const hours = s.hour === -1 ? [...Array(24).keys()] : [s.hour]
      for (const h of hours) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, s.minute)
        if (at > from && (!best || at < best)) best = at
      }
    }
    if (best) return best
  }
  return best
}
