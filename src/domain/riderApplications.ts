/**
 * Riders sign up in the app, behind a switch admins keep off until DrawMart is ready
 * (licence, insurance). An applicant does the training and passes the quiz, then sends
 * their ID, a selfie holding it, their vehicle and a guarantor. Approval turns that
 * account into a delivery account, so, as with stores, it must be one that hasn't
 * bought or sold. New riders can't take valuable jobs or won items until they've
 * completed NEW_RIDER_JOBS deliveries, unless an admin trusts them or their fleet.
 * Mirrored in supabase/migrations/…_rider_signup.sql.
 */
import { DELIVERY_AREAS } from './deliveryFees'
import { isNigerianMobile } from './listing'
import type { SellerApplicationStatus } from './sellers'
import type { Kobo } from './types'

export type RiderApplicationStatus = SellerApplicationStatus
export type VehicleType = 'motorcycle' | 'bicycle' | 'car' | 'van'

export const VEHICLE_TYPES: readonly VehicleType[] = ['motorcycle', 'bicycle', 'car', 'van']
export const VEHICLE_TEXT: Record<VehicleType, string> = { motorcycle: 'Motorcycle', bicycle: 'Bicycle', car: 'Car', van: 'Van' }

/** Defaults of app_settings.new_rider_jobs / new_rider_max_kobo. */
export const NEW_RIDER_JOBS = 20
export const NEW_RIDER_MAX_KOBO: Kobo = 50_000_00

export interface RiderApplicationInput {
  /** As on their ID. */
  fullName: string
  nin: string
  phone: string
  address: string
  /** A delivery area id, where they'll mostly work. */
  area: string
  vehicle: VehicleType
  /** Not for bicycles. */
  plate: string
  guarantorName: string
  guarantorPhone: string
  guarantorRelationship: string
  /** Photo of their government ID. */
  idPhoto: string
  /** A selfie holding that ID. */
  selfiePhoto: string
  /** The quiz, one answer index per question, for the current training version. */
  quizAnswers: number[]
}

export type RiderApplicationError =
  | 'name_required' | 'nin_invalid' | 'phone_invalid' | 'address_required' | 'area_required' | 'vehicle_required' | 'plate_required'
  | 'guarantor_name_required' | 'guarantor_phone_invalid' | 'guarantor_same_phone' | 'guarantor_relationship_required'
  | 'id_required' | 'selfie_required' | 'quiz_failed'

export const RIDER_APPLICATION_ERROR_TEXT: Record<RiderApplicationError, string> = {
  name_required: 'Enter your full name, as on your ID.',
  nin_invalid: 'Enter your 11-digit NIN.',
  phone_invalid: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.',
  address_required: 'Enter your home address, with street and area.',
  area_required: 'Pick the area you’ll mostly work in.',
  vehicle_required: 'Pick your vehicle.',
  plate_required: 'Enter your plate number.',
  guarantor_name_required: 'Enter your guarantor’s full name.',
  guarantor_phone_invalid: 'Enter your guarantor’s Nigerian mobile number.',
  guarantor_same_phone: 'Your guarantor needs their own phone number.',
  guarantor_relationship_required: 'Say how you know your guarantor.',
  id_required: 'Add a photo of your ID.',
  selfie_required: 'Add a selfie holding your ID.',
  quiz_failed: 'Finish the training and pass the quiz first.',
}

const digits = (s: string) => s.replace(/\D/g, '')
const fullName = (s: string) => s.trim().split(/\s+/).filter((w) => w.length > 1).length >= 2

export function validateRiderApplication(i: RiderApplicationInput): RiderApplicationError[] {
  const e: RiderApplicationError[] = []
  if (!fullName(i.fullName)) e.push('name_required')
  if (!/^\d{11}$/.test(i.nin.trim())) e.push('nin_invalid')
  if (!isNigerianMobile(i.phone)) e.push('phone_invalid')
  if (i.address.trim().length < 10) e.push('address_required')
  if (!DELIVERY_AREAS.some((a) => a.id === i.area)) e.push('area_required')
  if (!VEHICLE_TYPES.includes(i.vehicle)) e.push('vehicle_required')
  else if (i.vehicle !== 'bicycle' && !/^[A-Z0-9]{5,10}$/.test(i.plate.toUpperCase().replace(/[\s-]/g, ''))) e.push('plate_required')
  if (!fullName(i.guarantorName)) e.push('guarantor_name_required')
  if (!isNigerianMobile(i.guarantorPhone)) e.push('guarantor_phone_invalid')
  else if (digits(i.guarantorPhone).slice(-10) === digits(i.phone).slice(-10)) e.push('guarantor_same_phone')
  if (i.guarantorRelationship.trim().length < 3) e.push('guarantor_relationship_required')
  if (!i.idPhoto) e.push('id_required')
  if (!i.selfiePhoto) e.push('selfie_required')
  if (!quizPassed(i.quizAnswers)) e.push('quiz_failed')
  return e
}

/** Bump with any change to the training or quiz; private.rider_quiz_key must match. */
export const RIDER_TRAINING_VERSION = 1

export const RIDER_TRAINING: { title: string; points: string[] }[] = [
  {
    title: 'Collecting from the seller',
    points: [
      'Check the item against the listing and the seller’s photo before you leave. Take 1 to 3 photos.',
      'If it’s the wrong item, a different quantity or damaged, report it there. Don’t take it.',
      'Collect within 2 hours of taking a job, or it goes back to the list. You can hold 5 jobs at once.',
    ],
  },
  {
    title: 'At the door',
    points: [
      'Let the buyer open it and check it. Only their 6-digit PIN completes a delivery. Never mark one done without it.',
      'If they refuse it because it’s wrong or damaged, record it with their PIN and a photo, then take it back to the seller.',
      'If nobody answers: say you’ve arrived, call, wait 10 minutes, then record a failed attempt with a photo at the address. Keep the item safe.',
      'Pickup orders go to the counter staff, who check the product ID and finish them.',
    ],
  },
  {
    title: 'Buyers’ privacy and your conduct',
    points: [
      'You see a buyer’s name, address and number only while you carry their item. Never share them, save them or contact the buyer afterwards.',
      'Use the in-app chat to talk to the buyer. Phone numbers aren’t allowed in it.',
      'Be polite. Never ask for money, tips or payment outside DrawMart.',
    ],
  },
  {
    title: 'On the road in Lagos',
    points: [
      'Wear a helmet, and a reflective jacket between 6pm and 6am. Use a delivery box.',
      'Never carry passengers, ride against traffic or use BRT lanes. Riders are stopped and bikes impounded for these.',
      'If something goes wrong, stop safely first, then tell DrawMart.',
    ],
  },
]

export const RIDER_QUIZ: { question: string; options: string[]; answer: number }[] = [
  { question: 'The buyer says they’re busy and asks you to leave the item with their gate man. What do you do?', options: ['Leave it with the gate man', 'Only hand it over with the buyer’s PIN', 'Mark it delivered and go'], answer: 1 },
  { question: 'At the seller, the item doesn’t match the photo on the listing. What do you do?', options: ['Take it anyway', 'Report the problem in the app and don’t take it', 'Swap it for another one'], answer: 1 },
  { question: 'Nobody answers at the address. What comes first?', options: ['Say you’ve arrived, call the buyer and wait 10 minutes', 'Leave it at the door', 'Take it home and try next week'], answer: 0 },
  { question: 'A week after a delivery, may you message the buyer?', options: ['Yes, on WhatsApp', 'Only to ask for a tip', 'No: their details are only for the delivery'], answer: 2 },
  { question: 'A friend needs a lift on your way. Can you carry them?', options: ['Yes, if they pay', 'No, never carry passengers', 'Only at night'], answer: 1 },
  { question: 'The buyer offers to pay you directly next time for a discount. What do you say?', options: ['Agree', 'Say no: all payments go through DrawMart', 'Give them your account number'], answer: 1 },
]

export const quizPassed = (answers: readonly number[]) => answers.length === RIDER_QUIZ.length && RIDER_QUIZ.every((q, i) => answers[i] === q.answer)

/** Which questions were wrong, for another try. */
export const quizMistakes = (answers: readonly (number | null)[]) => RIDER_QUIZ.flatMap((q, i) => (answers[i] === q.answer ? [] : [i]))

/** Null when this account can become a rider's (storeApplications.ts storeAccountBlocker, for riders). */
export function riderAccountBlocker(a: { isBuyer: boolean; sellsAsIndividual: boolean; hasBought: boolean; appliedAsStore: boolean }): string | null {
  if (!a.isBuyer) return 'Only a new account can become a rider’s account.'
  if (a.sellsAsIndividual || a.appliedAsStore) return 'This account sells on DrawMart. Sign up with a new account to ride.'
  if (a.hasBought) return 'This account has already bought on DrawMart. Sign up with a new account to ride.'
  return null
}

/** Whether a rider can take a job yet. Null when they can. */
export function newRiderLimitError(r: { completed: number; trusted: boolean; orderKobo: Kobo; isPrize: boolean; jobs?: number; maxKobo?: Kobo }): string | null {
  const jobs = r.jobs ?? NEW_RIDER_JOBS
  if (r.trusted || r.completed >= jobs) return null
  if (r.isPrize) return `Won items open up after ${jobs} completed deliveries.`
  if (r.orderKobo > (r.maxKobo ?? NEW_RIDER_MAX_KOBO)) return `Jobs worth this much open up after ${jobs} completed deliveries.`
  return null
}
