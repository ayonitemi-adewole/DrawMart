import type { ListingStatus } from './types'

/** What buyers can see, so what they can save. Mirrored in public.save_listing. */
const SAVEABLE: readonly ListingStatus[] = ['live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold']

export const canSaveListing = (status: ListingStatus) => SAVEABLE.includes(status)
