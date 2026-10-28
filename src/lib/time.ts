/** "2d 4h", "9h 12m", "14m", "Closing now" */
export function timeLeft(closesAt: string, now = Date.now()): string {
  const ms = new Date(closesAt).getTime() - now
  if (ms <= 60_000) return 'Closing now'
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`
  if (hours) return m ? `${hours}h ${m}m` : `${hours}h`
  return `${m}m`
}

export function shortDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

export function dateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const ticketNo = (n: number) => '#' + String(n).padStart(4, '0')

/** Milliseconds left until `closesAt`, never negative. */
export function msLeft(closesAt: string, now = Date.now()): number {
  return Math.max(0, new Date(closesAt).getTime() - now)
}

/** "04:12:09" for the last day of a countdown. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** "Today", "Yesterday" or "12 Oct", for grouping activity. */
export function dayLabel(isoDate: string, now = new Date()): string {
  const d = new Date(isoDate)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return shortDate(isoDate)
}

export function timeOfDay(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
}
