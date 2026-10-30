/**
 * In-browser mock backend. Everything lives in localStorage, money is fake,
 * and a little latency is added so loading states get exercised.
 *
 * It enforces the same rules a real backend must (src/domain/rules.ts), and
 * keeps draw seeds out of every response until a draw has run, so the UI is
 * built against realistic behaviour.
 */
import { commitmentFor, createSeed, randomHex, winningTicketNumber, announcementDate } from '@/domain/draw'
import { LISTING_ERROR_TEXT, computeListingEconomics, platformFeeBps, validateListingEconomics } from '@/domain/fees'
import {
  HANDOVER_ERROR_TEXT,
  LISTING_TERMS_ERROR_TEXT,
  addDays,
  PICKUP_ERROR_TEXT,
  cautionFeeFor,
  pickupCautionFee,
  savedPickupExpiry,
  settlePickupFee,
  validatePickup,
  handoverMethodFor,
  isNigerianMobile,
  localDate,
  settleCautionFee,
  validateHandover,
  validateListingTerms,
} from '@/domain/listing'
import { nairaToKobo } from '@/domain/money'
import { DEMO_ACCOUNTS } from './demoAccounts'
import {
  PURCHASE_ERROR_TEXT,
  RULES,
  balanceFromLedger,
  checkPurchase,
  consolationCredit,
  spentInLastWeek,
  splitPayment,
  topUpError,
} from '@/domain/rules'
import { DELIVERY_ERROR_TEXT, ORDER_ERROR_TEXT, PRODUCT_ERROR_TEXT, checkOrder, saleEconomics, salePriceKobo, validateDelivery, validateProduct } from '@/domain/orders'
import { MAX_MESSAGES_PER_MINUTE, messageError } from '@/domain/messages'
import { fillDays, lagosDay } from '@/domain/metrics'
import { BOOST_DEFAULTS, BOOST_ERROR_TEXT, DEFAULT_BOOST_PACKAGES, boostEndsAt, boostWindow, boostsUnlocked, canBoost } from '@/domain/boosts'
import { SELLER_APPLICATION_ERROR_TEXT, normalizeNin, validateSellerApplication } from '@/domain/sellers'
import type { Category, DrawResult, NotificationKind, LedgerEntry, Listing, ListingStatus, Merchant, Order, Ticket, UnsoldPolicy, User } from '@/domain/types'
import {
  ApiError,
  type DrawMartApi,
  type DrawResultView,
  type ListingFilter,
  type ListingView,
  type NewListingInput,
  type WalletView,
  type NewPickupInput,
  type NotificationView,
  type PickupItemInput,
  type SavedPickupView,
  type NewProductInput,
  type SellerApplicationView,
  type ChatMessage,
  type ChatSide,
  type ConversationView,
  type ListingMetrics,
  type BoostSettings,
  type BoostView,
  type BoostInsightsView,
  type MerchantMetricsView,
  type OrderView,
  type AuthAdapter,
  type AuthSession,
} from './types'

const STORAGE_KEY = 'drawmart:mock-db:v14' // bump when seed data or the Db shape changes
const SESSION_KEY = 'drawmart:mock-session:v2'
/** buyer@drawmart.test, and whoever uses the API with nobody signed in (the tests). */
const ME = 'u-me'
const MY_MERCHANT = 'm-ikeja'
const CROWD = 'u-crowd'
/** seller@drawmart.test, an ID-verified individual seller, and their shop. */
const TOLU = 'u-tolu'
const TOLU_SHOP = 'm-tolu'
const DAY = 24 * 60 * 60 * 1000

interface Db {
  users: User[]
  merchants: Merchant[]
  listings: Listing[]
  /** Server-side secrets. Never returned before the draw. */
  seeds: Record<string, string>
  /** Reference of the purchase that sold the last ticket, kept for the draw. */
  closingRefs: Record<string, string>
  notifications: { id: string; userId: string; kind: NotificationKind; listingId: string; createdAt: string; read: boolean }[]
  tickets: Ticket[]
  ledger: LedgerEntry[]
  results: DrawResult[]
  pendingLimits: Record<string, { amountKobo: number; effectiveAt: string }>
  orders: Order[]
  /** Buyers' applications to sell, by user id. */
  sellerApplications: Record<string, SellerApplicationView>
  /** Individual sellers' own shops: user id → merchant id. */
  sellerShops: Record<string, string>
  /** Not stored: the buyer the current call acts for, set by tx(). */
  viewer?: string
  conversations: MockConversation[]
  messages: ChatMessage[]
  /** Opt-in call numbers by merchant id. */
  callPhones: Record<string, string>
  /** Items each store has saved to send later, by merchant id. */
  savedPickups: Record<string, SavedPickupView>
  /** One per visitor per listing per Lagos day. */
  views: { listingId: string; visitor: string; day: string }[]
  boosts: (Omit<BoostView, 'listingTitle' | 'merchantName'> & { merchantId: string })[]
  boostSettings: BoostSettings
}

interface MockConversation {
  id: string
  listingId: string
  buyerId: string
  merchantId: string
  lastMessageAt: string
  buyerReadAt: string
  sellerReadAt: string
}

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

const uid = (prefix: string) => `${prefix}-${randomHex(6)}`
const iso = (ms: number) => new Date(ms).toISOString()

// ---------------------------------------------------------------- seed data

const MERCHANTS: Merchant[] = [
  { id: MY_MERCHANT, kind: 'store', name: 'Ikeja Partner Store', area: 'Ikeja', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-lekki', kind: 'store', name: 'Lekki Partner Store', area: 'Lekki', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-surulere', kind: 'store', name: 'Surulere Partner Store', area: 'Surulere', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-yaba', kind: 'store', name: 'Yaba Partner Store', area: 'Yaba', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-vi', kind: 'store', name: 'Victoria Island Partner Dealer', area: 'Victoria Island', cacNumber: 'RC [NUMBER]', verified: true },
]

interface SeedListing {
  merchantId: string
  title: string
  description: string
  category: Category
  images?: string[]
  price: number
  ticket: number
  sold: number
  closesInHours: number
  status?: Extract<ListingStatus, 'live' | 'pending_review' | 'for_sale'>
  unsold?: UnsoldPolicy
  /** Naira; regular price for convert_to_sale listings. */
  fallback?: number
}

const img = (...files: string[]) => files.map((f) => `/assets/${f}`)

const SEED_LISTINGS: SeedListing[] = [
  {
    merchantId: MY_MERCHANT, title: 'iPhone 18 Pro Max, 256GB', category: 'Phones', images: img('iphone18pmBurgundy.jpg', 'iphone18pmBlack.jpg', 'iphone18pmGlacier.jpg'),
    description: 'Brand new and sealed, with a one-year store warranty. The winner picks Burgundy, Black or Glacier.',
    price: 2_600_000, ticket: 5_000, sold: 448, closesInHours: 28,
  },
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26 Ultra, 512GB', category: 'Phones', images: img('samsungS26Ultra.jpg'),
    description: 'Brand new and sealed, with S Pen and local warranty.',
    price: 2_100_000, ticket: 5_000, sold: 230, closesInHours: 60,
  },
  {
    merchantId: 'm-lekki', title: 'LG 55-inch 4K UHD TV + soundbar', category: 'Electronics', images: img('LG55inchSmartTv.jpg'),
    description: 'Smart TV with matching soundbar. Delivery and wall mounting anywhere in Lagos included.',
    price: 650_000, ticket: 2_500, sold: 241, closesInHours: 9, unsold: 'extend_once',
  },
  {
    merchantId: 'm-surulere', title: 'Samsung 65-inch 4K smart TV', category: 'Electronics', images: img('samsung65inch4KTV.jpg'),
    description: 'Crystal UHD smart TV with remote and wall bracket.',
    price: 950_000, ticket: 2_500, sold: 190, closesInHours: 48, unsold: 'convert_to_sale', fallback: 990_000,
  },
  {
    merchantId: MY_MERCHANT, title: 'MacBook Pro 14-inch, M5', category: 'Electronics', images: img('macbookProM5.jpg', 'macbookProM5-2.jpg'),
    description: '16GB unified memory, 512GB SSD. Brand new with manufacturer warranty.',
    price: 3_200_000, ticket: 5_000, sold: 85, closesInHours: 144,
  },
  {
    merchantId: 'm-yaba', title: 'LG 75-inch smart TV', category: 'Electronics', images: img('LG75inchSmartTv.jpg'),
    description: 'Big-screen 4K smart TV. Delivery and installation included.',
    price: 1_450_000, ticket: 5_000, sold: 122, closesInHours: 96,
  },
  {
    merchantId: 'm-vi', title: 'Toyota Camry 2025', category: 'Cars', images: img('toyotaCamry2025.jpg'),
    description: 'Brand new with dealer warranty. Registration and plates in the winner’s name.',
    price: 48_000_000, ticket: 20_000, sold: 760, closesInHours: 288,
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-AMG GLE 63 S Coupé 2025', category: 'Cars', images: img('mercedes-amg-gle-63-s-coupe.jpg'),
    description: 'Foreign-used, inspected, papers complete. Registration in the winner’s name.',
    price: 210_000_000, ticket: 50_000, sold: 1_130, closesInHours: 480,
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-AMG G 63 2025', category: 'Cars', images: img('MercedesG-wagon.jpg'),
    description: 'Brand new with full dealer history. Registration in the winner’s name.',
    price: 330_000_000, ticket: 50_000, sold: 540, closesInHours: 600,
  },
  {
    merchantId: 'm-yaba', title: '5kVA inverter + battery', category: 'Home', images: img('inverter-and-batteries.jpg'),
    description: 'Inverter with two batteries, installed by the store.',
    price: 1_800_000, ticket: 6_000, sold: 122, closesInHours: 96,
  },
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26, 256GB', category: 'Phones', images: img('samsung-galaxy-s-series.jpg'),
    description: 'Brand new and sealed, with local warranty.',
    price: 1_350_000, ticket: 2_500, sold: 120, closesInHours: 72,
  },
  {
    merchantId: 'm-yaba', title: 'Google Pixel 10 Pro, 256GB', category: 'Phones', images: img('google-pixel-pro.jpg'),
    description: 'Brand new, unlocked, with a one-year warranty.',
    price: 1_500_000, ticket: 5_000, sold: 60, closesInHours: 120, unsold: 'extend_once',
  },
  {
    merchantId: 'm-surulere', title: 'Tecno Phantom V Fold 2', category: 'Phones', images: img('foldable-phones.jpg'),
    description: 'Brand new foldable with charger and case.',
    price: 950_000, ticket: 2_000, sold: 300, closesInHours: 30,
  },
  {
    merchantId: 'm-yaba', title: 'PlayStation 5 Pro bundle', category: 'Electronics', images: img('playstation-5-home.jpg'),
    description: 'Console, two controllers and three games.',
    price: 1_200_000, ticket: 2_000, sold: 410, closesInHours: 20,
  },
  {
    merchantId: 'm-surulere', title: 'Sony 65-inch Bravia 7', category: 'Electronics', images: img('sony-bravia.jpg'),
    description: '4K mini-LED TV. Delivery and wall mounting included.',
    price: 1_650_000, ticket: 5_000, sold: 90, closesInHours: 150, unsold: 'convert_to_sale', fallback: 1_700_000,
  },
  {
    merchantId: MY_MERCHANT, title: 'Apple Watch Ultra 3', category: 'Electronics', images: img('apple-watch-ultra.jpg'),
    description: 'Titanium, GPS + cellular, brand new.',
    price: 1_050_000, ticket: 2_500, sold: 200, closesInHours: 60,
  },
  {
    merchantId: 'm-yaba', title: '10kVA solar system, installed', category: 'Home', images: img('rooftop-solar.jpg'),
    description: 'Inverter, lithium batteries and 12 panels, installed by the store.',
    price: 6_500_000, ticket: 10_000, sold: 230, closesInHours: 400, unsold: 'extend_once',
  },
  {
    merchantId: 'm-lekki', title: 'Samsung 2-door fridge, 450L', category: 'Home', images: img('side-by-side-fridge.jpg'),
    description: 'Frost-free, inverter compressor, brand new.',
    price: 1_100_000, ticket: 2_500, sold: 150, closesInHours: 90,
  },
  {
    merchantId: 'm-surulere', title: 'LG front-load washer, 9kg', category: 'Home', images: img('lg-front-load-washer.jpg'),
    description: 'Inverter direct drive, brand new with warranty.',
    price: 780_000, ticket: 2_000, sold: 80, closesInHours: 110, unsold: 'convert_to_sale', fallback: 800_000,
  },
  {
    merchantId: 'm-vi', title: 'Lexus RX 350 2023', category: 'Cars', images: img('lexus-rx-2023.jpg'),
    description: 'Foreign-used, inspected, papers complete. Registration in the winner’s name.',
    price: 95_000_000, ticket: 20_000, sold: 1_500, closesInHours: 500, unsold: 'extend_once',
  },
  {
    merchantId: 'm-vi', title: 'Honda Accord 2022', category: 'Cars', images: img('honda-accord.jpg'),
    description: 'Foreign-used, low mileage, inspected.',
    price: 38_000_000, ticket: 10_000, sold: 900, closesInHours: 350,
  },
  {
    merchantId: 'm-lekki', title: 'Rolex Datejust 41', category: 'Fashion', images: img('rolex-datejust-41.jpg'),
    description: 'Brand new with box and papers.',
    price: 18_000_000, ticket: 10_000, sold: 420, closesInHours: 300,
  },
  {
    merchantId: MY_MERCHANT, title: 'Louis Vuitton Keepall 50', category: 'Fashion', images: img('louis-vuitton-monogram-bags.jpg'),
    description: 'Authentic, with receipt and dust bag.',
    price: 4_200_000, ticket: 5_000, sold: 260, closesInHours: 180, unsold: 'convert_to_sale', fallback: 4_000_000,
  },
  {
    merchantId: 'm-yaba', title: 'Air Jordan 1 bundle, 3 pairs', category: 'Fashion', images: img('air-jordan-1.jpg'),
    description: 'Three colourways, any size from 40 to 46.',
    price: 650_000, ticket: 1_000, sold: 380, closesInHours: 40,
  },
  // A draw that ended unsold and stayed on as a regular product.
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26 Ultra, 256GB', category: 'Phones', images: img('samsungS26UltraBlack.jpg'),
    description: 'Brand new and sealed, Titanium Black, with local warranty.',
    price: 1_700_000, ticket: 5_000, sold: 0, closesInHours: -48, status: 'for_sale', unsold: 'convert_to_sale', fallback: 1_650_000,
  },
  // Waiting in the admin queue.
  {
    merchantId: MY_MERCHANT, title: 'MacBook Pro 14-inch, M1 Pro', category: 'Electronics', images: img('macbookProM1Pro.jpg'),
    description: 'UK-used, excellent condition, battery health 92%. Charger included.',
    price: 1_100_000, ticket: 2_500, sold: 0, closesInHours: 168, status: 'pending_review',
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-Benz S-Class 2025', category: 'Cars', images: img('mercedesBenzSClass2025.jpg'),
    description: 'Brand new S 580. Registration in the winner’s name.',
    price: 280_000_000, ticket: 50_000, sold: 0, closesInHours: 720, status: 'pending_review',
  },
]

/** Regular products: no draw. Naira prices. */
const SEED_PRODUCTS: { merchantId: string; title: string; description: string; category: Category; images: string[]; price: number; status: 'for_sale' | 'pending_review' }[] = [
  {
    merchantId: MY_MERCHANT, title: 'iPhone 18 Pro Max, 512GB, Glacier', category: 'Phones', images: img('iphone18pmGlacier.jpg'),
    description: 'Brand new and sealed, with a one-year store warranty. Ships in 2 days.', price: 2_950_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'Samsung 50-inch smart TV', category: 'Electronics', images: img('samsung50inchTV.jpg'),
    description: 'Crystal UHD smart TV with wall bracket. Delivery anywhere in Lagos.', price: 480_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'MacBook Pro 14-inch, M5, 1TB', category: 'Electronics', images: img('macbookProM5-2.jpg'),
    description: '24GB unified memory, 1TB SSD. Brand new with manufacturer warranty.', price: 3_850_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-AMG G 63 2025, Night Black', category: 'Cars', images: img('mercedesBenzG632025.jpg'),
    description: 'Brand new, dealer warranty, registration in the buyer’s name. View at our VI showroom.', price: 345_000_000, status: 'pending_review',
  },  {
    merchantId: MY_MERCHANT, title: 'AirPods Pro 3', category: 'Electronics', images: img('airpods-pro.jpg'),
    description: 'Brand new and sealed.', price: 420_000, status: 'for_sale',
  },
  {
    merchantId: MY_MERCHANT, title: 'Samsung Galaxy Watch 8', category: 'Electronics', images: img('samsung-galaxy-watch.jpg'),
    description: 'Brand new, 44mm, with charger.', price: 380_000, status: 'for_sale',
  },
  {
    merchantId: MY_MERCHANT, title: 'UK-used iPhone 18 Pro Max, 256GB', category: 'Phones', images: img('iphone18pmBlack.jpg'),
    description: 'UK-used, battery health 96%. Comes with a 3-month store warranty.', price: 2_150_000, status: 'for_sale',
  },
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26 Ultra, 1TB', category: 'Phones', images: img('samsungS26Ultra.jpg'),
    description: 'Brand new and sealed, with S Pen.', price: 2_450_000, status: 'for_sale',
  },
  {
    merchantId: 'm-lekki', title: 'Dyson V15 cordless vacuum', category: 'Home', images: img('dyson-cordless-vacuum.jpg'),
    description: 'Brand new with all attachments.', price: 1_250_000, status: 'for_sale',
  },
  {
    merchantId: 'm-lekki', title: 'Gucci horsebit loafers', category: 'Fashion', images: img('leather-loafer.jpg'),
    description: 'Authentic, sizes 41 to 45.', price: 1_100_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'LG UHD 55-inch smart TV', category: 'Electronics', images: img('LG55inchSmartTv.jpg'),
    description: 'With wall bracket. Delivery anywhere in Lagos.', price: 690_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'Hisense 1.5HP inverter AC', category: 'Home', images: img('split-air-conditioner.jpg'),
    description: 'Installation in Lagos included.', price: 520_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'Office desk and chair set', category: 'Home', images: [],
    description: 'Solid wood desk with an ergonomic mesh chair.', price: 350_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'MacBook Air 13-inch, M4', category: 'Electronics', images: img('macbook-air.jpg'),
    description: '16GB, 512GB SSD, brand new.', price: 1_650_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'HP LaserJet Pro printer', category: 'Electronics', images: img('hp-laserjet.jpg'),
    description: 'Wireless, prints and scans.', price: 285_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'JBL Charge 6 speaker', category: 'Electronics', images: img('jbl-charge.jpg'),
    description: 'Waterproof Bluetooth speaker, brand new.', price: 240_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'Ankara fabric bundle, 5 × 6 yards', category: 'Fashion', images: img('ankara-fabric.jpg'),
    description: 'Assorted prints, 100% cotton.', price: 85_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Toyota Camry 2018, Nigerian-used', category: 'Cars', images: img('toyota-camry-2018-1.jpg', 'toyota-camry-2018-2.jpg', 'toyota-camry-2018-3.jpg'),
    description: 'One owner, inspected, papers complete. View at our VI showroom.', price: 13_500_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-Benz GLE 350 2021', category: 'Cars', images: img('mercedes-gle-350-1.jpg', 'mercedes-gle-350-2.jpg', 'mercedes-gle-350-3.jpg'),
    description: 'Foreign-used, full service history.', price: 78_000_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Front and rear dashcam', category: 'Electronics', images: img('dashcam.jpg'),
    description: 'Installed while you wait at our VI showroom.', price: 120_000, status: 'for_sale',
  },
  {
    merchantId: TOLU_SHOP, title: 'PS5 Slim, barely used', category: 'Electronics', images: img('playstation-5-black.jpg'),
    description: 'With two controllers. Pickup in Yaba or delivery.', price: 650_000, status: 'for_sale',
  },
  {
    merchantId: TOLU_SHOP, title: 'iPad 10th gen, 64GB', category: 'Electronics', images: img('ipad-10th-gen.jpg'),
    description: 'Like new, with case and charger.', price: 420_000, status: 'for_sale',
  },
  {
    merchantId: TOLU_SHOP, title: 'Nintendo Switch 2', category: 'Electronics', images: img('nintendo-switch-2.jpg'),
    description: 'Sealed. Bought abroad.', price: 520_000, status: 'pending_review',
  },
  {
    merchantId: 'm-lekki', title: 'Samsung soundbar Q800', category: 'Electronics', images: img('samsung-soundbar.jpg'),
    description: 'With wireless subwoofer.', price: 560_000, status: 'pending_review',
  },
]

function productListing(input: NewProductInput & { merchantId: string; status: ListingStatus }, at: number): Listing {
  return {
    id: uid('L'), kind: 'product', merchantId: input.merchantId, title: input.title.trim(), description: input.description.trim(), category: input.category,
    images: input.images ?? [], priceKobo: input.priceKobo, ticketPriceKobo: 0, buyerTicketPriceKobo: 0, ticketCount: 0, ticketsSold: 0,
    feeMode: 'seller', feeBps: platformFeeBps(input.priceKobo), unsoldPolicy: 'refund', fallbackPriceKobo: null, durationDays: 0, extended: false,
    status: input.status, handover: null, cautionFee: { amountKobo: 0, status: 'none' }, commitment: '', createdAt: iso(at), closesAt: iso(at), boostedUntil: null, soldOutAt: null, drawAt: null, pickupBatchId: null,
  }
}

async function makeListing(s: SeedListing, now: number, seeds: Record<string, string>): Promise<Listing> {
  const id = uid('L')
  const merchant = MERCHANTS.find((m) => m.id === s.merchantId)!
  const status = s.status ?? 'live'
  const seed = createSeed()
  seeds[id] = seed
  const feeBps = platformFeeBps(nairaToKobo(s.price))
  const econ = computeListingEconomics({ priceKobo: nairaToKobo(s.price), ticketPriceKobo: nairaToKobo(s.ticket), feeBps, feeMode: 'seller' })
  return {
    id,
    kind: 'raffle',
    merchantId: s.merchantId,
    title: s.title,
    description: s.description,
    category: s.category,
    images: s.images ?? [],
    priceKobo: nairaToKobo(s.price),
    ticketPriceKobo: nairaToKobo(s.ticket),
    buyerTicketPriceKobo: econ.buyerTicketKobo,
    ticketCount: econ.ticketCount,
    ticketsSold: 0,
    feeMode: 'seller',
    feeBps,
    unsoldPolicy: s.unsold ?? 'refund',
    fallbackPriceKobo: s.fallback ? nairaToKobo(s.fallback) : null,
    durationDays: Math.max(RULES.minDurationDays, Math.ceil(s.closesInHours / 24)),
    extended: false,
    status,
    handover: {
      method: handoverMethodFor(s.category),
      address: `${merchant.name}, ${merchant.area}, Lagos`,
      location: null,
      contactPhone: '0803 000 0000',
      date: addDays(localDate(new Date(now)), status === 'pending_review' ? 2 : -3),
      slot: 'morning',
    },
    cautionFee: settleCautionFee({ amountKobo: cautionFeeFor(s.category), status: 'held' }, status),
    commitment: await commitmentFor(seed),
    createdAt: iso(now - 2 * DAY),
    closesAt: iso(now + s.closesInHours * 60 * 60 * 1000),
    boostedUntil: null,
    soldOutAt: null,
    drawAt: null,
    pickupBatchId: null,
  }
}

function crowdBuys(db: Db, listing: Listing, quantity: number, at: string): string {
  const purchaseId = `P-${randomHex(3).toUpperCase()}`
  for (let i = 0; i < quantity; i++) {
    listing.ticketsSold += 1
    db.tickets.push({ id: uid('T'), listingId: listing.id, userId: CROWD, number: listing.ticketsSold, purchaseId, purchasedAt: at })
  }
  return purchaseId
}

const DEMO_BUYERS = DEMO_ACCOUNTS.filter((a) => a.role === 'buyer')
const WELCOME_KOBO = nairaToKobo(25_000)

/** seller@drawmart.test already passed the ID check and has a shop. */
function seedSellerShop(db: Db, now: number) {
  db.merchants.push({ id: TOLU_SHOP, kind: 'individual', name: 'Tolu’s Gadgets', area: 'Yaba', cacNumber: '', verified: true })
  db.sellerShops[TOLU] = TOLU_SHOP
  const at = iso(now - 10 * DAY)
  db.sellerApplications[TOLU] = {
    id: uid('S'), status: 'approved', shopName: 'Tolu’s Gadgets', legalName: 'Toluwani Adebayo', nin: '12345678901', phone: '0803 123 4567',
    address: '12 Herbert Macaulay Way, Yaba', area: 'Yaba', idPhotoUrl: null, selfieUrl: null, reviewNote: null, createdAt: at, updatedAt: at, reviewedAt: at,
  }
}

async function freshDb(): Promise<Db> {
  const now = Date.now()
  const db: Db = {
    users: [
      ...DEMO_BUYERS.map((a) => ({ id: a.mockId, displayName: a.name, state: 'Lagos', weeklyLimitKobo: RULES.defaultWeeklyLimitKobo, ageVerified: true })),
      { id: CROWD, displayName: 'Other buyers', state: 'Lagos', weeklyLimitKobo: Number.MAX_SAFE_INTEGER, ageVerified: true },
    ],
    merchants: MERCHANTS.map((x) => ({ ...x })),
    listings: [],
    seeds: {},
    closingRefs: {},
    notifications: [],
    tickets: [],
    // Every buyer starts with the same test money (welcome_credit_kobo on Supabase).
    ledger: DEMO_BUYERS.map((a) => ({ id: uid('E'), userId: a.mockId, kind: 'topup' as const, cashKobo: WELCOME_KOBO, creditKobo: 0, memo: 'Welcome top-up (test money)', createdAt: iso(now - DAY) })),
    results: [],
    pendingLimits: {},
    orders: [],
    sellerApplications: {},
    sellerShops: {},
    conversations: [],
    messages: [],
    callPhones: { 'm-surulere': '0803 000 1234' },
    views: [],
    savedPickups: {},
    boosts: [],
    // The demo never reaches the real threshold, so boosts start switched on.
    boostSettings: { minActiveBuyers: BOOST_DEFAULTS.minActiveBuyers, forcedOn: true, maxActive: BOOST_DEFAULTS.maxActiveBoosts },
  }
  seedSellerShop(db, now)
  for (const p of SEED_PRODUCTS) {
    db.listings.push({ ...productListing({ ...p, priceKobo: nairaToKobo(p.price) }, now - DAY), status: p.status })
  }
  for (const s of SEED_LISTINGS) {
    const l = await makeListing(s, now, db.seeds)
    // Spread seeded sales over the last fortnight so seller insights have a shape.
    if (s.sold) for (let day = 13, left = s.sold; left > 0; day = Math.max(0, day - 1)) {
      const n = day === 0 ? left : Math.min(left, Math.ceil((s.sold / 14) * (0.4 + Math.random() * 1.2)))
      crowdBuys(db, l, n, iso(now - day * DAY - 2 * 60 * 60 * 1000))
      left -= n
    }
    db.listings.push(l)
  }
  // Finished draws so the results page isn't empty.
  for (const [i, s] of ([
    { merchantId: MY_MERCHANT, title: 'MacBook Pro 13-inch, M1', description: 'UK-used, 8GB RAM, 256GB SSD.', category: 'Electronics', images: img('macbookProM1.jpg'), price: 900_000, ticket: 2_500, sold: 0, closesInHours: 1 },
    { merchantId: 'm-lekki', title: 'Samsung 50-inch smart TV', description: 'Crystal UHD smart TV with wall bracket.', category: 'Electronics', images: img('samsung50inchTV.jpg'), price: 420_000, ticket: 1_500, sold: 0, closesInHours: 1 },
    { merchantId: 'm-vi', title: 'Toyota Camry 2018', description: 'Foreign-used, inspected, papers complete.', category: 'Cars', images: img('toyota-camry-2018-1.jpg', 'toyota-camry-2018-2.jpg', 'toyota-camry-2018-3.jpg'), price: 14_000_000, ticket: 10_000, sold: 0, closesInHours: 1 },
  ] satisfies SeedListing[]).entries()) {
    const l = await makeListing(s, now - (2 + i * 2) * DAY, db.seeds)
    const at = iso(now - (2 + i * 2) * DAY)
    const ref = crowdBuys(db, l, l.ticketCount, at)
    db.listings.push(l)
    await runDraw(db, l, ref, at)
  }
  seedChats(db, now)
  seedViews(db, now)
  seedBoosts(db, now)
  return db
}

/** Two other stores already paid for boosts, so Sponsored shows on the home page. */
function seedBoosts(db: Db, now: number) {
  const picks = [
    db.listings.find((l) => l.merchantId === 'm-vi' && l.status === 'live'),
    db.listings.find((l) => l.merchantId === 'm-surulere' && l.kind === 'product' && l.status === 'for_sale'),
  ]
  for (const l of picks) {
    if (!l) continue
    const pkg = DEFAULT_BOOST_PACKAGES[1]
    l.boostedUntil = iso(now + 4 * DAY)
    db.boosts.push({ id: uid('B'), txRef: `BST-${randomHex(8).toUpperCase()}`, listingId: l.id, merchantId: l.merchantId, days: pkg.days, priceKobo: pkg.priceKobo, status: 'paid', startsAt: iso(now - 3 * DAY), endsAt: l.boostedUntil, createdAt: iso(now - 3 * DAY) })
  }
}

/** A month of made-up visits to every listing, so each seller's insights have something in them. */
function seedViews(db: Db, now: number) {
  for (const l of db.listings) {
    if (!['live', 'for_sale', 'drawn'].includes(l.status)) continue
    const popularity = 2 + Math.random() * 10
    for (let d = 29; d >= 0; d--) {
      const day = lagosDay(now - d * DAY)
      const n = Math.round(popularity * (0.5 + Math.random()) * (d < 10 ? 1.4 : 1))
      for (let i = 0; i < n; i++) db.views.push({ listingId: l.id, visitor: `v:seed-${i}`, day })
    }
  }
}

/** A chat the demo buyer started, and one waiting for the demo store, so both inboxes have something. */
function seedChats(db: Db, now: number) {
  const tv = db.listings.find((l) => l.kind === 'product' && l.merchantId === 'm-surulere')
  const phone = db.listings.find((l) => l.kind === 'product' && l.merchantId === MY_MERCHANT)
  const chat = (listing: Listing | undefined, buyerId: string, lines: [ChatSide, string, number][], readByBuyer: boolean) => {
    if (!listing) return
    const id = uid('C')
    for (const [sender, body, minsAgo] of lines) db.messages.push({ id: uid('X'), conversationId: id, sender, body, createdAt: iso(now - minsAgo * 60_000) })
    const last = iso(now - lines[lines.length - 1][2] * 60_000)
    db.conversations.push({ id, listingId: listing.id, buyerId, merchantId: listing.merchantId, lastMessageAt: last, buyerReadAt: readByBuyer ? last : iso(now - DAY), sellerReadAt: iso(now - DAY) })
  }
  chat(tv, ME, [
    ['buyer', 'Hi, does the TV come with the wall bracket?', 95],
    ['seller', 'Yes, bracket and remote are in the box. We can deliver to Yaba tomorrow.', 80],
  ], false)
  chat(phone, 'u-chidi', [['buyer', 'Is the Glacier colour still available? Can I see it in person in Ikeja?', 30]], true)
}

// -------------------------------------------------------------- draw engine

async function runDraw(db: Db, listing: Listing, closingRef: string, at: string): Promise<void> {
  const seed = db.seeds[listing.id]
  const winningNumber = await winningTicketNumber(seed, closingRef, listing.ticketCount)
  const winner = db.tickets.find((t) => t.listingId === listing.id && t.number === winningNumber)
  if (!winner) throw new Error(`No ticket ${winningNumber} for ${listing.id}`)
  listing.status = 'drawn'
  listing.cautionFee = settleCautionFee(listing.cautionFee, 'drawn')
  db.results.push({ listingId: listing.id, commitment: listing.commitment, seed, closingRef, winningNumber, winnerUserId: winner.userId, drawnAt: at })

  // Consolation credit for every losing buyer (the crowd is a stand-in for many users).
  const losers = new Map<string, number>()
  for (const t of db.tickets) if (t.listingId === listing.id && t.userId !== winner.userId) losers.set(t.userId, (losers.get(t.userId) ?? 0) + 1)
  for (const [userId, count] of losers) {
    const credit = consolationCredit(count * listing.buyerTicketPriceKobo)
    if (credit > 0) db.ledger.push({ id: uid('E'), userId, kind: 'store_credit', cashKobo: 0, creditKobo: credit, memo: `Store credit · ${listing.title}`, listingId: listing.id, createdAt: at })
  }
  for (const userId of participants(db, listing)) notify(db, userId, userId === winner.userId ? 'draw_won' : 'draw_lost', listing.id, at)
}

/** Everyone holding a ticket, leaving out the demo's stand-in for other buyers. */
function participants(db: Db, listing: Listing): Set<string> {
  return new Set(db.tickets.filter((t) => t.listingId === listing.id && t.userId !== CROWD).map((t) => t.userId))
}

function notify(db: Db, userId: string, kind: NotificationKind, listingId: string, at: string) {
  db.notifications.push({ id: uid('N'), userId, kind, listingId, createdAt: at, read: false })
}

/** The last ticket has sold: sales stop and everyone hears when the winner comes. */
function closeTicketSales(db: Db, listing: Listing, closingRef: string, now: number) {
  listing.status = 'sold_out'
  listing.soldOutAt = iso(now)
  listing.drawAt = announcementDate(now, listing.closesAt)
  db.closingRefs[listing.id] = closingRef
  for (const userId of participants(db, listing)) notify(db, userId, 'draw_sold_out', listing.id, iso(now))
}

async function runDueDraws(db: Db, now: number) {
  for (const l of db.listings) {
    if (l.status === 'sold_out' && l.drawAt && Date.parse(l.drawAt) <= now) await runDraw(db, l, db.closingRefs[l.id], iso(now))
  }
}

/** Pays every ticket buyer back into the same buckets (cash/credit) the money came from. */
function refundBuyers(db: Db, l: Listing, at: string) {
  const paid = new Map<string, { cash: number; credit: number }>()
  for (const e of db.ledger) {
    if (e.listingId !== l.id || e.kind !== 'ticket_purchase') continue
    const p = paid.get(e.userId) ?? { cash: 0, credit: 0 }
    paid.set(e.userId, { cash: p.cash - e.cashKobo, credit: p.credit - e.creditKobo })
  }
  for (const [userId, p] of paid) {
    db.ledger.push({ id: uid('E'), userId, kind: 'refund', cashKobo: p.cash, creditKobo: p.credit, memo: `Refund · ${l.title} didn’t sell out`, listingId: l.id, createdAt: at })
  }
}

/**
 * Deadlines: extend once if the listing allows it; otherwise refund every
 * buyer, then either close the listing or keep it on as a regular product.
 */
function processDeadlines(db: Db, now: number): boolean {
  let changed = false
  for (const l of db.listings) {
    if (l.status !== 'live' || new Date(l.closesAt).getTime() > now) continue
    changed = true
    if (l.unsoldPolicy === 'extend_once' && !l.extended) {
      l.extended = true
      l.closesAt = iso(now + RULES.extensionDays * DAY)
      continue
    }
    refundBuyers(db, l, iso(now))
    l.status = l.unsoldPolicy === 'convert_to_sale' && l.fallbackPriceKobo ? 'for_sale' : 'refunded'
    l.cautionFee = settleCautionFee(l.cautionFee, l.status)
  }
  return changed
}

/** A shared pickup's one fee follows all its draws (listing.ts settlePickupFee). */
function settlePickups(db: Db) {
  const batches = new Map<string, Listing[]>()
  for (const l of db.listings) if (l.pickupBatchId) batches.set(l.pickupBatchId, [...(batches.get(l.pickupBatchId) ?? []), l])
  for (const members of batches.values()) {
    const status = settlePickupFee(members.map((l) => l.status))
    for (const l of members) l.cautionFee = { ...l.cautionFee, status }
  }
}

function applyPendingLimits(db: Db, now: number): boolean {
  let changed = false
  for (const [userId, p] of Object.entries(db.pendingLimits)) {
    if (new Date(p.effectiveAt).getTime() > now) continue
    const u = db.users.find((x) => x.id === userId)
    if (u) u.weeklyLimitKobo = p.amountKobo
    delete db.pendingLimits[userId]
    changed = true
  }
  return changed
}

// ------------------------------------------------------------------ views

function resultView(db: Db, r: DrawResult): DrawResultView {
  const me = db.viewer ?? ME
  const l = db.listings.find((x) => x.id === r.listingId)!
  const myNumbers = db.tickets.filter((t) => t.listingId === l.id && t.userId === me).map((t) => t.number)
  const myCreditKobo = db.ledger.filter((e) => e.userId === me && e.kind === 'store_credit' && e.listingId === l.id).reduce((s, e) => s + e.creditKobo, 0)
  return { ...r, listingTitle: l.title, listingImage: l.images[0] ?? null, ticketCount: l.ticketCount, iWon: r.winnerUserId === me, myNumbers, myCreditKobo }
}

/**
 * `full` is for the listing's own store and for admins. Buyers never see the
 * store's pickup address or phone number.
 */
function listingView(db: Db, l: Listing, audience: 'buyer' | 'full' = 'buyer'): ListingView {
  const merchant = db.merchants.find((m) => m.id === l.merchantId)!
  const myNumbers = db.tickets.filter((t) => t.listingId === l.id && t.userId === (db.viewer ?? ME)).map((t) => t.number)
  const r = db.results.find((x) => x.listingId === l.id)
  return { ...l, handover: audience === 'full' ? l.handover : null, merchant, myNumbers, result: r ? resultView(db, r) : null }
}

function conversationView(db: Db, c: MockConversation, me: ChatSide): ConversationView {
  const l = db.listings.find((x) => x.id === c.listingId)!
  const msgs = db.messages.filter((m) => m.conversationId === c.id)
  const last = msgs[msgs.length - 1]
  const readAt = me === 'buyer' ? c.buyerReadAt : c.sellerReadAt
  return {
    id: c.id, listingId: l.id, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category,
    priceKobo: l.kind === 'product' ? l.priceKobo : (l.fallbackPriceKobo ?? l.priceKobo), listingStatus: l.status,
    merchantName: db.merchants.find((m) => m.id === c.merchantId)!.name,
    buyerName: db.users.find((u) => u.id === c.buyerId)?.displayName ?? 'Buyer',
    me,
    lastMessage: last ? { body: last.body, sender: last.sender, createdAt: last.createdAt } : null,
    unread: msgs.filter((m) => m.sender !== me && m.createdAt > readAt).length,
    callPhone: me === 'buyer' ? (db.callPhones[c.merchantId] ?? null) : null,
    updatedAt: c.lastMessageAt,
  }
}

/** One listing's numbers between two Lagos days, inclusive (metrics.ts ListingMetricsInput). */
function statsBetween(db: Db, l: Listing, from: string, to: string) {
  const inRange = (at: string) => {
    const day = lagosDay(at)
    return day >= from && day <= to
  }
  const views = db.views.filter((v) => v.listingId === l.id && v.day >= from && v.day <= to)
  // A refunded draw's tickets were paid back, so they aren't sales.
  const tickets = l.kind === 'raffle' && (l.status === 'live' || l.status === 'sold_out' || l.status === 'drawn') ? db.tickets.filter((t) => t.listingId === l.id && inRange(t.purchasedAt)) : []
  const orders = db.orders.filter((o) => o.listingId === l.id && inRange(o.createdAt))
  return {
    views: views.length,
    visitors: new Set(views.map((v) => v.visitor)).size,
    chats: db.conversations.filter((c) => c.listingId === l.id && inRange(c.lastMessageAt)).length,
    units: tickets.length + orders.length,
    // Demo crowd buyers count once per purchase.
    buyers: new Set(tickets.map((t) => (t.userId === CROWD ? t.purchaseId : t.userId))).size + new Set(orders.map((o) => o.buyerId)).size,
    salesKobo: tickets.length * l.buyerTicketPriceKobo + orders.reduce((s, o) => s + o.priceKobo, 0),
  }
}

function orderView(db: Db, o: Order): OrderView {
  const l = db.listings.find((x) => x.id === o.listingId)!
  const merchant = db.merchants.find((m) => m.id === o.merchantId)!
  return { ...o, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category, merchantName: merchant.name }
}

// -------------------------------------------------------------------- API

export interface MockOptions {
  store?: KeyValueStore
  latencyMs?: number
  now?: () => number
}

export function createMockApi(opts: MockOptions = {}): DrawMartApi {
  const store = opts.store ?? (typeof localStorage !== 'undefined' ? localStorage : memoryStore())
  const latency = opts.latencyMs ?? 180
  const now = opts.now ?? (() => Date.now())
  let loading: Promise<Db> | null = null
  // Serialise writes so two quick clicks can't sell the same ticket twice.
  let queue: Promise<unknown> = Promise.resolve()

  const sleep = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve())

  async function load(): Promise<Db> {
    const raw = store.getItem(STORAGE_KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as Db
      } catch {
        /* fall through to a fresh db */
      }
    }
    loading ??= freshDb().then((db) => {
      store.setItem(STORAGE_KEY, JSON.stringify(db))
      loading = null
      return db
    })
    return loading
  }

  const save = (db: Db) => store.setItem(STORAGE_KEY, JSON.stringify(db))

  /** Runs a unit of work against a consistent snapshot, housekeeping first. */
  function tx<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      await sleep()
      const db = await load()
      db.viewer = buyer()
      const t = now()
      processDeadlines(db, t)
      applyPendingLimits(db, t)
      await runDueDraws(db, t)
      settlePickups(db)
      const out = await fn(db)
      settlePickups(db)
      delete db.viewer
      save(db)
      return out
    })
    queue = run.catch(() => undefined)
    return run
  }

  // Demo sign-in, so the mock opens the same three apps as a real backend. It
  // only decides which app you see: the mock's data rules don't check roles.
  const sessionListeners = new Set<(s: AuthSession | null) => void>()
  function readSession(): AuthSession | null {
    try {
      return JSON.parse(store.getItem(SESSION_KEY) ?? 'null') as AuthSession | null
    } catch {
      return null
    }
  }
  function setSession(s: AuthSession | null) {
    if (s) store.setItem(SESSION_KEY, JSON.stringify(s))
    else store.removeItem(SESSION_KEY)
    sessionListeners.forEach((l) => l(s))
  }
  const auth: AuthAdapter = {
    emailLinks: false,
    demoAccounts: DEMO_ACCOUNTS,
    getSession: async () => readSession(),
    onChange(callback) {
      sessionListeners.add(callback)
      return () => void sessionListeners.delete(callback)
    },
    async sendSignInLink() {
      throw new ApiError('invalid_input', 'The demo can’t send email. Use one of the demo accounts.')
    },
    async signInWithPassword(email, password) {
      await sleep()
      const a = DEMO_ACCOUNTS.find((d) => d.email === email.trim().toLowerCase())
      if (!a || a.password !== password) throw new ApiError('invalid_input', 'That email and password don’t match. Try one of the demo accounts.')
      // Stores sign in as their store: userId is the store id on the mock.
      setSession({ userId: a.mockId, email: a.email, role: a.role })
    },
    async signOut() {
      setSession(null)
    },
  }

  /** The buyer the call acts for: whoever is signed in, or buyer@ when nobody is. */
  function buyer(): string {
    const s = readSession()
    return s?.role === 'buyer' ? s.userId : ME
  }
  const me = (db: Db) => db.users.find((u) => u.id === buyer())!
  /** The shop whose side of chats the signed-in user sees, if any. */
  const myShop = (db: Db): string | null => {
    const role = readSession()?.role
    if (role === undefined) return MY_MERCHANT
    if (role === 'store') return readSession()!.userId
    return role === 'buyer' ? (db.sellerShops[buyer()] ?? null) : null
  }
  /** As buyer if the signed-in user is the demo buyer; otherwise as the shop. */
  const sideIn = (db: Db, c: MockConversation): ChatSide | null => {
    const role = readSession()?.role
    if ((role === 'buyer' || role === undefined) && c.buyerId === buyer()) return 'buyer'
    if (c.merchantId === myShop(db)) return 'seller'
    return null
  }
  /** Buyers who bought a ticket or an item in the last 30 days. */
  const activeBuyerCount = (db: Db) => {
    const monthAgo = iso(now() - 30 * DAY)
    return new Set(db.ledger.filter((e) => (e.kind === 'ticket_purchase' || e.kind === 'order_payment') && e.createdAt > monthAgo).map((e) => e.userId)).size
  }
  /** Checks and adds one message (messages.ts messageError, MAX_MESSAGES_PER_MINUTE). */
  function postMessage(db: Db, c: MockConversation, side: ChatSide, body: string): ChatMessage {
    const problem = messageError(body)
    if (problem) throw new ApiError('invalid_input', problem)
    const minuteAgo = iso(now() - 60_000)
    if (db.messages.filter((m) => m.conversationId === c.id && m.sender === side && m.createdAt > minuteAgo).length >= MAX_MESSAGES_PER_MINUTE)
      throw new ApiError('invalid_input', 'You’re sending messages very fast. Wait a moment.')
    const at = iso(now())
    const msg: ChatMessage = { id: uid('X'), conversationId: c.id, sender: side, body: body.trim(), createdAt: at }
    db.messages.push(msg)
    c.lastMessageAt = at
    if (side === 'buyer') c.buyerReadAt = at
    else c.sellerReadAt = at
    return msg
  }
  const conversationOr404 = (db: Db, id: string) => {
    const c = db.conversations.find((x) => x.id === id)
    const side = c ? sideIn(db, c) : null
    if (!c || !side) throw new ApiError('not_found', 'That conversation doesn’t exist.')
    return { c, side }
  }
  /** The shop being managed: the demo buyer's own once approved, otherwise the demo store. */
  const shopId = (db: Db) => {
    const s = readSession()
    if (s?.role === 'store') return s.userId
    if (s?.role !== 'buyer') return MY_MERCHANT
    const shop = db.sellerShops[s.userId]
    if (!shop) throw new ApiError('forbidden', 'Get verified as a seller to list products.')
    return shop
  }
  /** This store's saved items, unless they've expired. */
  function savedPickupOf(db: Db): SavedPickupView | null {
    const shop = shopId(db)
    const saved = db.savedPickups[shop]
    if (saved && Date.parse(saved.expiresAt) <= now()) delete db.savedPickups[shop]
    return db.savedPickups[shop] ?? null
  }

  /** Checks one draw item and adds it for review, with its own pickup booking and fee. */
  async function addRaffle(db: Db, input: NewListingInput): Promise<Listing> {
    if (readSession()?.role === 'buyer') throw new ApiError('forbidden', 'Only registered stores can run raffle draws.')
    const today = localDate(new Date(now()))
    const problems = [
      ...validateListingEconomics(input).map((e) => LISTING_ERROR_TEXT[e]),
      ...validateListingTerms(input).map((e) => LISTING_TERMS_ERROR_TEXT[e]),
      ...validateHandover(input.handover, today).map((e) => HANDOVER_ERROR_TEXT[e]),
    ]
    if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
    // DrawMart sets the fee from the item's value; the store never chooses it.
    const feeBps = platformFeeBps(input.priceKobo)
    const econ = computeListingEconomics({ ...input, feeBps })
    const seed = createSeed()
    const id = uid('L')
    db.seeds[id] = seed
    const at = now()
    const listing: Listing = {
      id, kind: 'raffle', merchantId: shopId(db), title: input.title.trim(), description: input.description.trim(), category: input.category, images: input.images ?? [],
      priceKobo: input.priceKobo, ticketPriceKobo: input.ticketPriceKobo, buyerTicketPriceKobo: econ.buyerTicketKobo,
      ticketCount: econ.ticketCount, ticketsSold: 0, feeMode: input.feeMode, feeBps,
      unsoldPolicy: input.unsoldPolicy, fallbackPriceKobo: input.unsoldPolicy === 'convert_to_sale' ? input.fallbackPriceKobo! : null,
      durationDays: input.durationDays, extended: false, status: 'pending_review',
      handover: { ...input.handover, address: input.handover.address.trim(), method: handoverMethodFor(input.category) },
      // In test mode the fee is recorded, not charged. A real backend takes it before booking the pickup.
      cautionFee: { amountKobo: cautionFeeFor(input.category), status: 'held' },
      commitment: await commitmentFor(seed), createdAt: iso(at), closesAt: iso(at + input.durationDays * DAY), boostedUntil: null, soldOutAt: null, drawAt: null, pickupBatchId: null,
    }
    db.listings.push(listing)
    return listing
  }

  const getListingOr404 = (db: Db, id: string) => {
    const l = db.listings.find((x) => x.id === id)
    if (!l) throw new ApiError('not_found', 'That listing doesn’t exist.')
    return l
  }

  return {
    testMode: true,
    auth,

    getCurrentUser: () => tx((db) => ({ ...me(db) })),

    updateProfile: (patch) =>
      tx((db) => {
        Object.assign(me(db), patch)
        return { ...me(db) }
      }),

    listListings: (filter: ListingFilter = {}) =>
      tx((db) => {
        const statuses = filter.status ?? ['live']
        return db.listings
          .filter((l) => statuses.includes(l.status) && (!filter.category || l.category === filter.category))
          .map((l) => listingView(db, l))
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'live' ? -1 : 1
            const share = (l: { ticketsSold: number; ticketCount: number }) => (l.ticketCount ? l.ticketsSold / l.ticketCount : 0)
            return share(b) - share(a)
          })
      }),

    getListing: (id) => tx((db) => listingView(db, getListingOr404(db, id))),

    buyTickets: (listingId, quantity) =>
      tx(async (db) => {
        const user = me(db)
        const listing = getListingOr404(db, listingId)
        const mine = db.ledger.filter((e) => e.userId === buyer())
        const balance = balanceFromLedger(mine)
        const held = db.tickets.filter((t) => t.listingId === listingId && t.userId === buyer()).length
        const err = checkPurchase({ user, listing, quantity, ticketsAlreadyHeld: held, balance, spentThisWeekKobo: spentInLastWeek(mine, new Date(now())) })
        if (err) throw new ApiError(err, PURCHASE_ERROR_TEXT[err])

        const costKobo = quantity * listing.buyerTicketPriceKobo
        const { fromCash, fromCredit } = splitPayment(costKobo, balance)
        const purchaseId = `P-${randomHex(3).toUpperCase()}`
        const at = iso(now())
        const numbers: number[] = []
        for (let i = 0; i < quantity; i++) {
          listing.ticketsSold += 1
          numbers.push(listing.ticketsSold)
          db.tickets.push({ id: uid('T'), listingId, userId: buyer(), number: listing.ticketsSold, purchaseId, purchasedAt: at })
        }
        db.ledger.push({
          id: uid('E'), userId: buyer(), kind: 'ticket_purchase', cashKobo: -fromCash, creditKobo: -fromCredit,
          memo: `${quantity} ${quantity === 1 ? 'ticket' : 'tickets'} · ${listing.title}`, listingId, createdAt: at,
        })
        const soldOut = listing.ticketsSold === listing.ticketCount
        if (soldOut) closeTicketSales(db, listing, purchaseId, now())
        return { purchaseId, numbers, costKobo, soldOut, drawAt: listing.drawAt }
      }),

    listMyListings: () =>
      tx((db) => {
        const ids = new Set(db.tickets.filter((t) => t.userId === buyer()).map((t) => t.listingId))
        return db.listings.filter((l) => ids.has(l.id)).map((l) => listingView(db, l))
      }),

    listResults: () =>
      tx((db) => db.results.map((r) => resultView(db, r)).sort((a, b) => b.drawnAt.localeCompare(a.drawnAt))),

    buyNow: (listingId, delivery) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (l.merchantId === db.sellerShops[buyer()]) throw new ApiError('forbidden', 'You can’t buy your own item.')
        const mine = db.ledger.filter((e) => e.userId === buyer())
        const balance = balanceFromLedger(mine)
        const notForSale = checkOrder(l, { cashKobo: Number.MAX_SAFE_INTEGER, creditKobo: 0 })
        if (notForSale) throw new ApiError(notForSale, ORDER_ERROR_TEXT[notForSale])
        const problems = validateDelivery(delivery).map((e) => DELIVERY_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const blocked = checkOrder(l, balance)
        if (blocked) throw new ApiError(blocked, ORDER_ERROR_TEXT[blocked])

        const price = salePriceKobo(l)!
        const pay = splitPayment(price, balance)
        const at = iso(now())
        db.ledger.push({ id: uid('E'), userId: buyer(), kind: 'order_payment', cashKobo: -pay.fromCash, creditKobo: -pay.fromCredit, memo: `Bought · ${l.title}`, listingId: l.id, createdAt: at })
        const order: Order = {
          id: uid('O'), listingId: l.id, buyerId: buyer(), merchantId: l.merchantId, priceKobo: price, feeKobo: saleEconomics(price, l.feeBps).feeKobo,
          delivery: { address: delivery.address.trim(), location: delivery.location, contactPhone: delivery.contactPhone.trim() }, status: 'paid', createdAt: at, dispatchedAt: null, deliveredAt: null,
        }
        db.orders.push(order)
        l.status = 'sold'
        return orderView(db, order)
      }),

    listMyOrders: () =>
      tx((db) => db.orders.filter((o) => o.buyerId === buyer()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => orderView(db, o))),

    confirmOrder: (orderId) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.buyerId === buyer() && x.status !== 'delivered')
        if (!o) throw new ApiError('invalid_input', 'Only your own orders that are on the way can be confirmed.')
        const at = iso(now())
        o.status = 'delivered'
        o.dispatchedAt ??= at
        o.deliveredAt = at
      }),

    listNotifications: () =>
      tx((db): NotificationView[] =>
        db.notifications
          .filter((n) => n.userId === buyer())
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((n) => {
            const l = getListingOr404(db, n.listingId)
            return {
              id: n.id, kind: n.kind, listingId: n.listingId, listingTitle: l.title, drawAt: l.drawAt,
              winningNumber: db.results.find((r) => r.listingId === n.listingId)?.winningNumber ?? null, createdAt: n.createdAt, read: n.read,
            }
          }),
      ),

    markNotificationsRead: () =>
      tx((db) => {
        for (const n of db.notifications) if (n.userId === buyer()) n.read = true
      }),

    getWallet: () =>
      tx((db): WalletView => {
        const mine = db.ledger.filter((e) => e.userId === buyer())
        return {
          balance: balanceFromLedger(mine),
          entries: [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          spentThisWeekKobo: spentInLastWeek(mine, new Date(now())),
          weeklyLimitKobo: me(db).weeklyLimitKobo,
          pendingLimit: db.pendingLimits[buyer()] ?? null,
          pendingDeposits: [], // the mock has no payment provider
        }
      }),

    topUp: (amountKobo) =>
      tx((db) => {
        const problem = topUpError(amountKobo)
        if (problem) throw new ApiError('invalid_input', problem)
        db.ledger.push({ id: uid('E'), userId: buyer(), kind: 'topup', cashKobo: amountKobo, creditKobo: 0, memo: 'Wallet top-up (test money)', createdAt: iso(now()) })
      }),

    setWeeklyLimit: (amountKobo) =>
      tx((db) => {
        if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new ApiError('invalid_input', 'Enter a limit.')
        const u = me(db)
        if (amountKobo <= u.weeklyLimitKobo) {
          u.weeklyLimitKobo = amountKobo // lowering is instant
          delete db.pendingLimits[buyer()]
        } else {
          db.pendingLimits[buyer()] = { amountKobo, effectiveAt: iso(now() + RULES.limitIncreaseDelayHours * 60 * 60 * 1000) }
        }
      }),

    getMyMerchant: () => tx((db) => db.merchants.find((m) => m.id === shopId(db))!),

    listMerchantListings: () =>
      tx((db) =>
        db.listings
          .filter((l) => l.merchantId === shopId(db))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((l) => listingView(db, l, 'full')),
      ),

    createListing: (input: NewListingInput) =>
      tx(async (db) => {
        const listing = await addRaffle(db, input)
        return listingView(db, listing, 'full')
      }),

    createListingBatch: ({ items, handover }: NewPickupInput) =>
      tx(async (db) => {
        const problems = validatePickup(items.map((i) => i.category)).map((e) => PICKUP_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const added = db.listings.length
        try {
          const batchId = uid('B')
          const fee = pickupCautionFee(items.map((i) => i.category))
          const listings: Listing[] = []
          for (const item of items) {
            const l = await addRaffle(db, { ...item, handover })
            l.pickupBatchId = batchId
            l.cautionFee = { amountKobo: fee, status: 'held' }
            listings.push(l)
          }
          return listings.map((l) => listingView(db, l, 'full'))
        } catch (e) {
          db.listings.length = added // all or none
          throw e
        }
      }),

    getSavedPickup: () => tx((db) => savedPickupOf(db)),

    savePickupItems: (items: PickupItemInput[]) =>
      tx((db) => {
        if (readSession()?.role === 'buyer') throw new ApiError('forbidden', 'Only store accounts can save draw items.')
        const shop = shopId(db)
        if (items.length === 0) {
          delete db.savedPickups[shop]
          return null
        }
        if (items.length > RULES.maxPickupItems) throw new ApiError('invalid_input', PICKUP_ERROR_TEXT.too_many_items)
        if (items.some((i) => i.category === 'Cars')) throw new ApiError('invalid_input', 'Cars are inspected where they are, so they can’t be saved to a pickup. List them on their own.')
        const current = savedPickupOf(db)
        const saved = { items, savedAt: current?.savedAt ?? iso(now()), expiresAt: current?.expiresAt ?? savedPickupExpiry(now()) }
        db.savedPickups[shop] = saved
        return saved
      }),

    createProduct: (input: NewProductInput) =>
      tx((db) => {
        const problems = validateProduct(input).map((e) => PRODUCT_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const listing = productListing({ ...input, merchantId: shopId(db), status: 'pending_review' }, now())
        db.listings.push(listing)
        return listingView(db, listing, 'full')
      }),

    listMerchantOrders: () =>
      tx((db) => db.orders.filter((o) => o.merchantId === shopId(db)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => orderView(db, o))),

    dispatchOrder: (orderId) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.merchantId === shopId(db) && x.status === 'paid')
        if (!o) throw new ApiError('invalid_input', 'Only your store’s paid orders can be marked as sent.')
        o.status = 'dispatched'
        o.dispatchedAt = iso(now())
      }),

    sendFirstMessage: (listingId, body) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (readSession() && readSession()!.role !== 'buyer') throw new ApiError('forbidden', 'Only buyer accounts can message sellers.')
        if (l.kind !== 'product') throw new ApiError('invalid_input', 'Raffle items are held and checked by DrawMart, so there’s no seller chat.')
        if (l.status !== 'for_sale' && l.status !== 'sold') throw new ApiError('not_found', 'That item isn’t on sale.')
        if (l.merchantId === db.sellerShops[buyer()]) throw new ApiError('invalid_input', 'This is your own item.')
        // Check the text before creating anything.
        const problem = messageError(body)
        if (problem) throw new ApiError('invalid_input', problem)
        let c = db.conversations.find((x) => x.listingId === l.id && x.buyerId === buyer())
        if (!c) {
          const at = iso(now())
          c = { id: uid('C'), listingId: l.id, buyerId: buyer(), merchantId: l.merchantId, lastMessageAt: at, buyerReadAt: at, sellerReadAt: iso(0) }
          db.conversations.push(c)
        }
        postMessage(db, c, 'buyer', body)
        return conversationView(db, c, 'buyer')
      }),

    listConversations: () =>
      tx((db) =>
        db.conversations
          .flatMap((c) => {
            const side = sideIn(db, c)
            return side ? [conversationView(db, c, side)] : []
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ),

    listMessages: (conversationId) =>
      tx((db) => {
        conversationOr404(db, conversationId)
        return db.messages.filter((m) => m.conversationId === conversationId)
      }),

    sendMessage: (conversationId, body) =>
      tx((db) => {
        const { c, side } = conversationOr404(db, conversationId)
        return postMessage(db, c, side, body)
      }),

    markConversationRead: (conversationId) =>
      tx((db) => {
        const { c, side } = conversationOr404(db, conversationId)
        if (side === 'buyer') c.buyerReadAt = iso(now())
        else c.sellerReadAt = iso(now())
      }),

    recordListingView: (listingId, visitorId) =>
      tx((db) => {
        const l = db.listings.find((x) => x.id === listingId)
        if (!l || !['live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold'].includes(l.status)) return
        const role = readSession()?.role
        if (role && l.merchantId === myShop(db)) return // a seller looking at their own item
        const visitor = role ? `u:${readSession()!.userId}` : /^[A-Za-z0-9-]{8,64}$/.test(visitorId) ? `v:${visitorId}` : null
        if (!visitor) return
        const day = lagosDay(now())
        if (!db.views.some((v) => v.listingId === l.id && v.visitor === visitor && v.day === day)) db.views.push({ listingId: l.id, visitor, day })
      }),

    getMerchantMetrics: (days) =>
      tx((db): MerchantMetricsView => {
        const shop = readSession() ? myShop(db) : null
        if (!shop) throw new ApiError('forbidden', 'Only sellers have insights.')
        const range = fillDays([], days, lagosDay(now()))
        const from = range[0].date
        const daily = new Map(range.map((d) => [d.date, { ...d }]))
        const today = range[range.length - 1].date
        const listings = db.listings
          .filter((l) => l.merchantId === shop && l.status !== 'rejected')
          .map((l): ListingMetrics => {
            for (const d of range) {
              const day = statsBetween(db, l, d.date, d.date)
              daily.get(d.date)!.views += day.views
              daily.get(d.date)!.salesKobo += day.salesKobo
            }
            return { listingId: l.id, title: l.title, image: l.images[0] ?? null, category: l.category, kind: l.kind, status: l.status, ...statsBetween(db, l, from, today) }
          })
          .sort((a, b) => b.views - a.views)
        return { days, listings, daily: [...daily.values()] }
      }),

    getBoostStatus: () =>
      tx((db) => {
        const s = db.boostSettings
        const running = db.boosts.filter((b) => b.status === 'paid' && b.endsAt! > iso(now())).length
        const activeBuyers = activeBuyerCount(db)
        return {
          unlocked: boostsUnlocked(activeBuyers, s.minActiveBuyers, s.forcedOn),
          slotsLeft: Math.max(0, s.maxActive - running),
          packages: DEFAULT_BOOST_PACKAGES,
          admin: readSession()?.role === 'admin' ? { ...s, activeBuyers } : null,
        }
      }),

    buyBoost: (listingId, packageId) =>
      tx((db) => {
        const shop = readSession() ? myShop(db) : null
        if (!shop) throw new ApiError('forbidden', 'Only sellers can boost listings.')
        const s = db.boostSettings
        if (!boostsUnlocked(activeBuyerCount(db), s.minActiveBuyers, s.forcedOn)) throw new ApiError('forbidden', BOOST_ERROR_TEXT.locked)
        const l = db.listings.find((x) => x.id === listingId && x.merchantId === shop)
        if (!l) throw new ApiError('not_found', 'That listing isn’t yours.')
        if (!canBoost(l)) throw new ApiError('invalid_input', BOOST_ERROR_TEXT.not_boostable)
        const pkg = DEFAULT_BOOST_PACKAGES.find((p) => p.id === packageId)
        if (!pkg) throw new ApiError('invalid_input', BOOST_ERROR_TEXT.no_package)
        if (db.boosts.filter((b) => b.status === 'paid' && b.endsAt! > iso(now())).length >= s.maxActive) throw new ApiError('invalid_input', BOOST_ERROR_TEXT.slots_full)
        // Test money: paid at once.
        const startsAt = l.boostedUntil && l.boostedUntil > iso(now()) ? l.boostedUntil : iso(now())
        l.boostedUntil = boostEndsAt(l.boostedUntil, pkg.days, now())
        db.boosts.push({ id: uid('B'), txRef: `BST-${randomHex(8).toUpperCase()}`, listingId: l.id, merchantId: shop, days: pkg.days, priceKobo: pkg.priceKobo, status: 'paid', startsAt, endsAt: l.boostedUntil, createdAt: iso(now()) })
        return 'successful'
      }),

    listBoosts: () =>
      tx((db) => {
        const role = readSession()?.role
        const shop = role && role !== 'admin' ? myShop(db) : null
        return db.boosts
          .filter((b) => role === 'admin' || b.merchantId === shop)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(({ merchantId, ...b }) => ({
            ...b,
            listingTitle: db.listings.find((l) => l.id === b.listingId)?.title ?? '',
            merchantName: db.merchants.find((m) => m.id === merchantId)?.name ?? '',
          }))
      }),

    getBoostInsights: (boostId) =>
      tx((db): BoostInsightsView => {
        const role = readSession()?.role
        const shop = role && role !== 'admin' ? myShop(db) : null
        const b = db.boosts.find((x) => x.id === boostId && (role === 'admin' || x.merchantId === shop))
        if (!b) throw new ApiError('not_found', 'That boost doesn’t exist.')
        if (b.status !== 'paid' || !b.startsAt || !b.endsAt) throw new ApiError('invalid_input', 'Results show once the boost has started.')
        const l = getListingOr404(db, b.listingId)
        const w = boostWindow(b.startsAt, b.endsAt, now())
        const daily = fillDays([], w.days * 2, w.to).map((d) => {
          const day = statsBetween(db, l, d.date, d.date)
          return { date: d.date, views: day.views, salesKobo: day.salesKobo }
        })
        return { window: w, before: statsBetween(db, l, w.beforeFrom, w.beforeTo), during: statsBetween(db, l, w.from, w.to), daily }
      }),

    setBoostSettings: (settings) =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        if (settings.minActiveBuyers < 0 || settings.maxActive < 1) throw new ApiError('invalid_input', 'Check the boost settings.')
        db.boostSettings = { ...settings }
      }),

    getCallPhone: () =>
      tx((db) => {
        const shop = myShop(db)
        return shop ? (db.callPhones[shop] ?? null) : null
      }),

    setCallPhone: (phone) =>
      tx((db) => {
        const shop = myShop(db)
        if (!shop) throw new ApiError('forbidden', 'Only sellers can share a call number.')
        if (!phone?.trim()) {
          delete db.callPhones[shop]
          return
        }
        if (!isNigerianMobile(phone)) throw new ApiError('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.')
        db.callPhones[shop] = phone.trim()
      }),

    getMySellerApplication: () => tx((db) => db.sellerApplications[buyer()] ?? null),

    submitSellerApplication: (input) =>
      tx((db) => {
        const prev = db.sellerApplications[buyer()]
        if (prev?.status === 'pending') throw new ApiError('invalid_input', 'Your application is already being reviewed.')
        if (prev?.status === 'approved') throw new ApiError('invalid_input', 'You’re already a verified seller.')
        const problems = validateSellerApplication(input).map((e) => SELLER_APPLICATION_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const at = iso(now())
        db.sellerApplications[buyer()] = {
          id: prev?.id ?? uid('S'), status: 'pending', shopName: input.shopName.trim(), legalName: input.legalName.trim(), nin: normalizeNin(input.nin),
          phone: input.phone.trim(), address: input.address.trim(), area: input.area.trim(), idPhotoUrl: input.idPhoto, selfieUrl: input.selfie,
          reviewNote: null, createdAt: prev?.createdAt ?? at, updatedAt: at, reviewedAt: null,
        }
        return db.sellerApplications[buyer()]
      }),

    listSellerApplications: () =>
      tx((db) => Object.values(db.sellerApplications).filter((a) => a.status === 'pending').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))),

    approveSeller: (applicationId) =>
      tx((db) => {
        const [userId, a] = Object.entries(db.sellerApplications).find(([, x]) => x.id === applicationId) ?? []
        if (!userId || !a || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be approved.')
        const shop: Merchant = { id: uid('M'), kind: 'individual', name: a.shopName, area: a.area, cacNumber: '', verified: true }
        db.merchants.push(shop)
        db.sellerShops[userId] = shop.id
        Object.assign(a, { status: 'approved', reviewedAt: iso(now()) })
      }),

    rejectSeller: (applicationId, note) =>
      tx((db) => {
        const a = Object.values(db.sellerApplications).find((x) => x.id === applicationId)
        if (note.trim().length < 5) throw new ApiError('invalid_input', 'Tell the applicant what to fix.')
        if (!a || a.id !== applicationId || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be rejected.')
        Object.assign(a, { status: 'rejected', reviewNote: note.trim(), reviewedAt: iso(now()) })
      }),

    listPendingListings: () =>
      tx((db) => db.listings.filter((l) => l.status === 'pending_review').map((l) => listingView(db, l, 'full'))),

    approveListing: (id) =>
      tx((db) => {
        const l = getListingOr404(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be approved.')
        if (l.kind === 'product') {
          l.status = 'for_sale' // products skip the draw
          return
        }
        l.status = 'live'
        l.closesAt = iso(now() + l.durationDays * DAY) // the clock starts when it goes live
      }),

    rejectListing: (id) =>
      tx((db) => {
        const l = getListingOr404(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be rejected.')
        l.status = 'rejected'
        l.cautionFee = settleCautionFee(l.cautionFee, 'rejected')
      }),

    demoSellOut: (listingId) =>
      tx(async (db) => {
        const l = getListingOr404(db, listingId)
        if (l.status !== 'live') throw new ApiError('not_live', PURCHASE_ERROR_TEXT.not_live)
        const at = iso(now())
        const ref = crowdBuys(db, l, l.ticketCount - l.ticketsSold, at)
        closeTicketSales(db, l, ref, now())
      }),

    demoRunDraw: (listingId) =>
      tx(async (db) => {
        const l = getListingOr404(db, listingId)
        if (l.status !== 'sold_out') throw new ApiError('invalid_input', 'Only sold-out draws can be announced.')
        l.drawAt = iso(now())
        await runDueDraws(db, now())
      }),

    demoExpire: (listingId) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (l.status !== 'live') throw new ApiError('not_live', PURCHASE_ERROR_TEXT.not_live)
        l.closesAt = iso(now() - 1)
        processDeadlines(db, now())
      }),

    demoReset: async () => {
      await queue
      store.removeItem(STORAGE_KEY)
    },

    resetTestData: async () => {
      if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
      await queue
      store.removeItem(STORAGE_KEY) // the next call rebuilds the sample data
    },
  }
}
