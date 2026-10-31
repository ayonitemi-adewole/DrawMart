/**
 * The plain numbers buyers see on a draw. A draw only runs once every ticket has
 * sold (otherwise everyone is refunded), so a ticket's chance is always one in
 * the total, however many have sold so far.
 */

const count = (n: number) => n.toLocaleString('en-NG')

/** "1 in 520", or "5 in 520" for five tickets. */
export function chanceText(tickets: number, ticketCount: number): string {
  return `${count(Math.min(tickets, ticketCount))} in ${count(ticketCount)}`
}

/** "0.96%": the same chance as a percentage. */
export function chancePercentText(tickets: number, ticketCount: number): string {
  const pct = ticketCount > 0 ? (Math.min(tickets, ticketCount) / ticketCount) * 100 : 0
  if (pct > 0 && pct < 0.01) return '<0.01%'
  return `${pct.toFixed(pct < 1 ? 2 : 1)}%`
}

/** Rounded down, so a draw with tickets left never reads as 100% sold. */
export function percentSold(ticketsSold: number, ticketCount: number): number {
  return ticketCount > 0 ? Math.floor((ticketsSold / ticketCount) * 100) : 0
}
