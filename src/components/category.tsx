import type { Category } from '@/domain/types'
import { CarIcon, GridIcon, PhoneIcon, ShirtIcon, SofaIcon, BowlIcon, TvIcon, type IconComponent } from './icons'

interface CategoryStyle {
  icon: IconComponent
  /** Gradient for placeholder product art. */
  art: string
  /** Colour of the glyph on that art. */
  glyph: string
}

export const CATEGORY_STYLE: Record<Category, CategoryStyle> = {
  Phones: { icon: PhoneIcon, art: 'from-violet-soft via-surface to-sky-soft', glyph: 'text-violet' },
  Electronics: { icon: TvIcon, art: 'from-sky-soft via-surface to-brand-soft', glyph: 'text-sky' },
  Home: { icon: SofaIcon, art: 'from-ticket-soft via-surface to-hot-soft', glyph: 'text-ticket-ink' },
  Food: { icon: BowlIcon, art: 'from-hot-soft via-surface to-ticket-soft', glyph: 'text-hot' },
  Cars: { icon: CarIcon, art: 'from-brand-soft via-surface to-sky-soft', glyph: 'text-brand' },
  Fashion: { icon: ShirtIcon, art: 'from-hot-soft via-surface to-violet-soft', glyph: 'text-violet' },
}

export const AllCategoriesIcon = GridIcon
