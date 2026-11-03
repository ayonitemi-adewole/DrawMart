import { useState, type FormEvent } from 'react'
import { useMyRiderApplication, useRiderSignupsOpen, useSubmitRiderApplication } from '@/api/hooks'
import type { RiderApplicationView } from '@/api/types'
import { AlertIcon, CameraIcon, CheckIcon, ClockIcon, IdCardIcon, ShieldIcon, TruckIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, ErrorState, Field, Notice, PageTitle, Skeleton, buttonClass, cx, errorMessage, inputCls } from '@/components/ui'
import { DELIVERY_AREAS } from '@/domain/deliveryFees'
import { formatNaira } from '@/domain/money'
import {
  NEW_RIDER_JOBS,
  NEW_RIDER_MAX_KOBO,
  RIDER_APPLICATION_ERROR_TEXT,
  RIDER_QUIZ,
  RIDER_TRAINING,
  VEHICLE_TEXT,
  VEHICLE_TYPES,
  quizMistakes,
  validateRiderApplication,
  type RiderApplicationError,
  type RiderApplicationInput,
} from '@/domain/riderApplications'
import { IdPhoto } from './SellPage'

/**
 * /ride: apply to deliver for DrawMart. Only while admins have sign-up open. The account
 * applying becomes a delivery account once approved, so it must be one that hasn't bought.
 */
export function RiderApplicationPage() {
  const q = useMyRiderApplication()
  const open = useRiderSignupsOpen()
  if (q.isPending || open.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const a = q.data

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Ride with DrawMart" sub="Deliver orders across Lagos on your own time, and get paid weekly for every job.">
        Become a rider
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        {a?.status === 'approved' ? (
          <Approved />
        ) : a?.status === 'pending' ? (
          <UnderReview application={a} />
        ) : !open.data ? (
          <Notice tone="ticket" icon={ClockIcon} title="Rider sign-up isn’t open yet">
            We’re getting ready to take on riders. Check back soon.
          </Notice>
        ) : (
          <Apply previous={a} />
        )}
        <HowItWorks />
      </div>
    </div>
  )
}

function HowItWorks() {
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-24">
      <Card className="flex flex-col gap-3 p-5 text-sm">
        <strong className="font-display text-lg">How it works</strong>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted">
          <li>Read the training and pass a short quiz.</li>
          <li>Send your ID, a selfie holding it, your vehicle and a guarantor. We check them, usually within two working days.</li>
          <li>Once approved, this account opens the delivery app. Add your photo and bank account, and take your first job.</li>
          <li>
            For your first {NEW_RIDER_JOBS} deliveries you’ll carry orders worth up to {formatNaira(NEW_RIDER_MAX_KOBO)}, then everything.
          </li>
        </ol>
      </Card>
      <Notice tone="neutral" icon={ShieldIcon}>
        Your documents are only seen by DrawMart’s review team. Each job’s pay is shown before you take it.
      </Notice>
    </aside>
  )
}

function UnderReview({ application: a }: { application: RiderApplicationView }) {
  return (
    <Card className="flex animate-fade-up flex-col items-center gap-4 p-6 text-center sm:p-8">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-ticket-soft text-ticket-ink">
        <ClockIcon size={32} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">We’re checking your details</h2>
        <p className="text-sm text-muted">{a.fullName}. Don’t buy anything with this account meanwhile: it becomes your rider account.</p>
      </div>
      <Badge tone="ticket">Under review</Badge>
    </Card>
  )
}

function Approved() {
  return (
    <Card className="flex animate-fade-up flex-col items-center gap-4 p-6 text-center sm:p-8">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-soft text-brand-ink">
        <CheckIcon size={32} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">You’re approved to ride</h2>
        <p className="text-sm text-muted">This account is now your rider account.</p>
      </div>
      {/* A full load, so the app picks up the account's new role. */}
      <a href="/delivery" className={buttonClass('primary', 'lg')}>
        <TruckIcon size={18} /> Open the delivery app
      </a>
    </Card>
  )
}

/** Training and the quiz first; the details only once it's passed. */
function Apply({ previous }: { previous: RiderApplicationView | null | undefined }) {
  const [answers, setAnswers] = useState<number[] | null>(null)
  return answers ? <RiderApplicationForm previous={previous} quizAnswers={answers} /> : <Training previous={previous} onPassed={setAnswers} />
}

function Training({ previous, onPassed }: { previous: RiderApplicationView | null | undefined; onPassed: (answers: number[]) => void }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => RIDER_QUIZ.map(() => null))
  const [mistakes, setMistakes] = useState<number[]>([])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const wrong = quizMistakes(picked)
    setMistakes(wrong)
    if (!wrong.length) onPassed(picked as number[])
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-w-0 animate-fade-up flex-col gap-5">
      {previous?.status === 'rejected' ? (
        <Notice tone="hot" icon={XIcon} title="Your last application wasn’t approved">
          {previous.reviewNote} Go through the training again, then fix your details and send it.
        </Notice>
      ) : null}
      <Notice tone="ticket" icon={AlertIcon} title="This account becomes your rider account">
        Once approved, it opens the delivery app and can’t buy. Use an account you haven’t bought with.
      </Notice>
      {RIDER_TRAINING.map((lesson, i) => (
        <Card key={lesson.title} className="flex flex-col gap-2 p-5">
          <h2 className="font-display text-lg font-extrabold">
            {i + 1}. {lesson.title}
          </h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">
            {lesson.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      ))}
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-extrabold">Quick quiz</h2>
          <p className="text-xs text-subtle">Get them all right to continue. You can try as often as you like.</p>
        </div>
        {RIDER_QUIZ.map((q, i) => (
          <fieldset key={q.question} className="flex flex-col gap-1">
            <legend className={cx('mb-1 text-sm font-bold', mistakes.includes(i) && 'text-hot-ink')}>
              {i + 1}. {q.question}
            </legend>
            {q.options.map((o, n) => (
              <label key={o} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  type="radio"
                  name={`quiz-${i}`}
                  checked={picked[i] === n}
                  onChange={() => setPicked((p) => p.map((x, j) => (j === i ? n : x)))}
                  className="size-5 shrink-0 accent-brand"
                />
                {o}
              </label>
            ))}
            {mistakes.includes(i) ? <span className="text-xs font-semibold text-hot-ink">Not quite. Read the training above and try again.</span> : null}
          </fieldset>
        ))}
        <Button type="submit" size="lg">
          <CheckIcon size={18} /> Check my answers
        </Button>
      </Card>
    </form>
  )
}

const FIELD: Record<RiderApplicationError, keyof RiderApplicationInput> = {
  name_required: 'fullName',
  nin_invalid: 'nin',
  phone_invalid: 'phone',
  address_required: 'address',
  area_required: 'area',
  vehicle_required: 'vehicle',
  plate_required: 'plate',
  guarantor_name_required: 'guarantorName',
  guarantor_phone_invalid: 'guarantorPhone',
  guarantor_same_phone: 'guarantorPhone',
  guarantor_relationship_required: 'guarantorRelationship',
  id_required: 'idPhoto',
  selfie_required: 'selfiePhoto',
  quiz_failed: 'quizAnswers',
}

function RiderApplicationForm({ previous, quizAnswers }: { previous: RiderApplicationView | null | undefined; quizAnswers: number[] }) {
  const submit = useSubmitRiderApplication()
  const toast = useToast()
  // A rejected applicant fixes the details; photos are always taken again.
  const [input, setInput] = useState<RiderApplicationInput>(() => ({
    fullName: previous?.fullName ?? '',
    nin: previous?.nin ?? '',
    phone: previous?.phone ?? '',
    address: previous?.address ?? '',
    area: previous?.area ?? '',
    vehicle: previous?.vehicle ?? 'motorcycle',
    plate: previous?.plate ?? '',
    guarantorName: previous?.guarantorName ?? '',
    guarantorPhone: previous?.guarantorPhone ?? '',
    guarantorRelationship: previous?.guarantorRelationship ?? '',
    idPhoto: '',
    selfiePhoto: '',
    quizAnswers,
  }))
  const [agreed, setAgreed] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const errors = validateRiderApplication(input)
  const set = (k: keyof RiderApplicationInput) => (v: string) => setInput((i) => ({ ...i, [k]: v }))
  const err = (k: keyof RiderApplicationInput) => {
    const e = showErrors ? errors.find((x) => FIELD[x] === k) : undefined
    return e ? RIDER_APPLICATION_ERROR_TEXT[e] : undefined
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setShowErrors(true)
    if (errors.length || !agreed) {
      toast(errors.length ? 'A few details need fixing first.' : 'Tick the box to confirm.', 'error')
      return
    }
    submit.mutate(input, {
      onSuccess: () => toast('Sent. We’ll check your details and let you know.'),
      onError: (error) => toast(errorMessage(error), 'error'),
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-w-0 animate-fade-up flex-col gap-5">
      <Notice tone="brand" icon={CheckIcon} title="Training done">
        Now your details. Only DrawMart’s review team sees them.
      </Notice>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold">About you</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="rider-name" error={err('fullName')} hint="As on your ID.">
            <input id="rider-name" autoComplete="name" value={input.fullName} onChange={(e) => set('fullName')(e.target.value)} className={inputCls} />
          </Field>
          <Field label="NIN" htmlFor="rider-nin" error={err('nin')} hint="Your 11-digit National Identification Number.">
            <input id="rider-nin" inputMode="numeric" autoComplete="off" maxLength={11} value={input.nin} onChange={(e) => set('nin')(e.target.value.replace(/\D/g, ''))} className={inputCls} />
          </Field>
          <Field label="Phone" htmlFor="rider-phone" error={err('phone')}>
            <input id="rider-phone" type="tel" inputMode="tel" autoComplete="tel" value={input.phone} onChange={(e) => set('phone')(e.target.value)} className={inputCls} placeholder="0803 123 4567" />
          </Field>
          <Field label="Area you’ll mostly work in" htmlFor="rider-area" error={err('area')}>
            <select id="rider-area" value={input.area} onChange={(e) => set('area')(e.target.value)} className={inputCls}>
              <option value="">Choose an area</option>
              {DELIVERY_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Home address" htmlFor="rider-address" error={err('address')}>
          <textarea id="rider-address" rows={2} autoComplete="street-address" value={input.address} onChange={(e) => set('address')(e.target.value)} className={cx(inputCls, 'min-h-20 py-3')} placeholder="Street, building and area" />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold">Your vehicle</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vehicle" htmlFor="rider-vehicle" error={err('vehicle')}>
            <select id="rider-vehicle" value={input.vehicle} onChange={(e) => set('vehicle')(e.target.value)} className={inputCls}>
              {VEHICLE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {VEHICLE_TEXT[v]}
                </option>
              ))}
            </select>
          </Field>
          {input.vehicle !== 'bicycle' ? (
            <Field label="Plate number" htmlFor="rider-plate" error={err('plate')}>
              <input id="rider-plate" autoComplete="off" autoCapitalize="characters" value={input.plate} onChange={(e) => set('plate')(e.target.value)} className={cx(inputCls, 'uppercase')} placeholder="LND 123 AB" />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-extrabold">Your guarantor</h2>
          <p className="text-xs text-subtle">Someone who knows you well and will vouch for you. We may call them.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Their full name" htmlFor="rider-g-name" error={err('guarantorName')}>
            <input id="rider-g-name" value={input.guarantorName} onChange={(e) => set('guarantorName')(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Their phone" htmlFor="rider-g-phone" error={err('guarantorPhone')}>
            <input id="rider-g-phone" type="tel" inputMode="tel" value={input.guarantorPhone} onChange={(e) => set('guarantorPhone')(e.target.value)} className={inputCls} placeholder="0803 123 4567" />
          </Field>
          <Field label="How you know them" htmlFor="rider-g-rel" error={err('guarantorRelationship')}>
            <input id="rider-g-rel" value={input.guarantorRelationship} onChange={(e) => set('guarantorRelationship')(e.target.value)} className={inputCls} placeholder="e.g. Uncle, former employer" />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-extrabold">Documents</h2>
          <p className="text-xs text-subtle">A clear photo of your government ID, and a selfie of you holding it next to your face.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <IdPhoto label="Your ID" icon={IdCardIcon} value={input.idPhoto} onChange={set('idPhoto')} error={err('idPhoto')} />
          <IdPhoto label="Selfie holding your ID" icon={CameraIcon} value={input.selfiePhoto} onChange={set('selfiePhoto')} error={err('selfiePhoto')} capture="user" />
        </div>
      </Card>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-surface p-4 text-sm shadow-card">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
        <span>
          These details are true. I’ll follow the training, keep buyers’ details private, and only complete deliveries with the buyer’s PIN. I understand DrawMart can close my account and keep pay
          if I don’t, or if an item goes missing with me.
        </span>
      </label>
      {showErrors && !agreed ? (
        <span className="-mt-3 text-xs font-semibold text-hot-ink" role="alert">
          Confirm to continue.
        </span>
      ) : null}

      <Button type="submit" size="lg" loading={submit.isPending}>
        <ShieldIcon size={18} /> {previous?.status === 'rejected' ? 'Send again for review' : 'Send for review'}
      </Button>
    </form>
  )
}
