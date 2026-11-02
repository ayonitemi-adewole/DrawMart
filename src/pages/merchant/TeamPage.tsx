import { useState, type FormEvent } from 'react'
import { useStoreActivity, useStoreTeam, useTeamActions } from '@/api/hooks'
import type { TeamMember } from '@/api/types'
import { ClockIcon, UsersIcon, XIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageTitle, Segmented, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { ACTIVITY_TEXT, MAX_TEAM, ROLE_TEXT, STORE_ROLES, inviteError, lastOwnerError, type StoreRole } from '@/domain/team'
import { dateTime } from '@/lib/time'

/** /store/team: the owner's view of who works on the store, what they can do, and what they've done. */
export function TeamPage() {
  const team = useStoreTeam()

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Team" sub="Invite your staff with the right role. They sign up on DrawMart with the email you enter, then accept the invite.">
        Your team
      </PageTitle>
      {team.isPending ? (
        <Skeleton className="h-60" />
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => team.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex flex-col divide-y divide-line p-0">
              {team.data.members.map((m) => (
                <MemberRow key={m.userId} member={m} members={team.data.members} />
              ))}
            </Card>
            {team.data.invites.length ? (
              <Card className="flex flex-col gap-2 p-5">
                <strong>Waiting to join</strong>
                <ul className="flex flex-col divide-y divide-line">
                  {team.data.invites.map((i) => (
                    <InviteRow key={i.id} id={i.id} email={i.email} role={i.role} createdAt={i.createdAt} />
                  ))}
                </ul>
              </Card>
            ) : null}
            <Activity />
          </div>
          <InviteForm count={team.data.members.length + team.data.invites.length} />
        </div>
      )}
    </div>
  )
}

function MemberRow({ member: m, members }: { member: TeamMember; members: TeamMember[] }) {
  const { setRole, remove } = useTeamActions()
  const toast = useToast()
  const onError = (e: unknown) => toast(errorMessage(e), 'error')

  function change(role: StoreRole) {
    const problem = lastOwnerError(members, m.userId, role)
    if (problem) return toast(problem, 'error')
    setRole.mutate({ userId: m.userId, role }, { onSuccess: () => toast(`${m.name} is now ${ROLE_TEXT[role].label.toLowerCase()}.`), onError })
  }

  function onRemove() {
    const problem = lastOwnerError(members, m.userId, null)
    if (problem) return toast(problem, 'error')
    remove.mutate(m.userId, { onSuccess: () => toast(`${m.name} has been removed. Their account is a buyer account again.`), onError })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <strong className="truncate">
          {m.name}
          {m.you ? ' (you)' : ''}
        </strong>
        <span className="truncate text-xs text-subtle">{m.email}</span>
      </div>
      <Segmented<StoreRole>
        label={`${m.name}’s role`}
        size="sm"
        value={m.role}
        onChange={change}
        options={STORE_ROLES.map((r) => ({ value: r, label: ROLE_TEXT[r].label }))}
      />
      {m.you ? null : (
        <Button variant="ghost" size="sm" className="min-h-11" loading={remove.isPending && remove.variables === m.userId} onClick={onRemove}>
          <XIcon size={16} /> Remove
        </Button>
      )}
    </div>
  )
}

function InviteRow({ id, email, role, createdAt }: { id: string; email: string; role: StoreRole; createdAt: string }) {
  const { revoke } = useTeamActions()
  const toast = useToast()
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{email}</span>
      <Badge tone="neutral">{ROLE_TEXT[role].label}</Badge>
      <span className="text-xs text-subtle">Invited {dateTime(createdAt)}</span>
      <Button variant="ghost" size="sm" className="min-h-11" loading={revoke.isPending && revoke.variables === id} onClick={() => revoke.mutate(id, { onSuccess: () => toast('Invite cancelled.'), onError: (e) => toast(errorMessage(e), 'error') })}>
        Cancel invite
      </Button>
    </li>
  )
}

function InviteForm({ count }: { count: number }) {
  const { invite } = useTeamActions()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StoreRole>('orders')
  const [showError, setShowError] = useState(false)
  const problem = inviteError(email, role) ?? (count >= MAX_TEAM ? `A store can have up to ${MAX_TEAM} people, counting invites.` : null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    invite.mutate(
      { email, role },
      {
        onSuccess: () => {
          toast(`Invited. Tell them to sign up on DrawMart with ${email.trim()} to accept.`)
          setEmail('')
          setShowError(false)
        },
        onError: (err) => toast(errorMessage(err), 'error'),
      },
    )
  }

  return (
    <Card className="flex flex-col gap-4 p-5 lg:sticky lg:top-24">
      <strong className="flex items-center gap-2">
        <UsersIcon size={18} /> Invite someone
      </strong>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Their email" htmlFor="invite-email" error={showError && problem ? problem : undefined}>
          <input id="invite-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="ada@yourstore.ng" />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1.5 text-sm font-bold">Role</legend>
          {STORE_ROLES.map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 py-2 text-sm">
              <input type="radio" name="invite-role" checked={role === r} onChange={() => setRole(r)} className="mt-0.5 size-4 shrink-0 accent-brand" />
              <span>
                <strong className="block">{ROLE_TEXT[r].label}</strong>
                <span className="text-xs text-subtle">{ROLE_TEXT[r].sub}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-subtle">The account they join with becomes a store account, so it can’t be one they’ve shopped with.</p>
        <Button type="submit" loading={invite.isPending}>
          Send invite
        </Button>
      </form>
    </Card>
  )
}

function Activity() {
  const q = useStoreActivity()
  return (
    <Card className="flex flex-col gap-3 p-5">
      <strong className="flex items-center gap-2">
        <ClockIcon size={18} /> Recent activity
      </strong>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={ClockIcon} title="Nothing yet" body="Who listed, changed or sent what will show here." />
      ) : (
        <ol className="flex flex-col divide-y divide-line text-sm">
          {q.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
              <strong>{a.who}</strong>
              <span className="text-muted">{ACTIVITY_TEXT[a.action] ?? a.action}</span>
              <span className="font-semibold">{a.listingTitle ?? 'a listing'}</span>
              {a.productCode ? <ProductId code={a.productCode} /> : null}
              <span className="ml-auto text-xs text-subtle">{dateTime(a.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
