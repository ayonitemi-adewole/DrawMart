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
