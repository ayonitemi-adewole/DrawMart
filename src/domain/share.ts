import { formatNaira } from './money'
import { salePriceKobo } from './orders'
import type { Listing } from './types'

/** The message that goes with a shared link. Plain facts: the price, and no promise of winning. */
export function listingShareText(l: Pick<Listing, 'title' | 'kind' | 'status' | 'priceKobo' | 'fallbackPriceKobo' | 'buyerTicketPriceKobo'>): string {
  const sale = salePriceKobo(l)
  if (sale !== null) return `${l.title}: ${formatNaira(sale)} on DrawMart`
  if (l.status === 'live') return `${l.title}: ${formatNaira(l.buyerTicketPriceKobo)} a ticket on DrawMart`
  return `${l.title} on DrawMart`
}

/** Opens WhatsApp with the message ready, for the buyer to choose who it goes to. */
export function whatsAppShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
}
