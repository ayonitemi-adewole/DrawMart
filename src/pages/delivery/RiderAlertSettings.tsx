import { api } from '@/api'
import { usePushPreferences, useRiderAreas, useSetPushPreference, useSetRiderAreas } from '@/api/hooks'
import { MapPinIcon, TruckIcon } from '@/components/icons'
import { PushSettings, PushToggle } from '@/components/PushSettings'
import { useToast } from '@/components/toast'
import { Card, Switch, errorMessage } from '@/components/ui'
import { DELIVERY_AREAS } from '@/domain/deliveryFees'
import { RIDER_PUSH_CATEGORIES } from '@/domain/push'
import { RIDER_JOB_ALERTS_PER_HOUR } from '@/domain/riderAlerts'

const [NEW_JOBS, RETURNS, YOUR_JOBS] = RIDER_PUSH_CATEGORIES

/** On a rider's notifications page: which jobs to hear about, and where. */
export function RiderAlertSettings() {
  const prefs = usePushPreferences()
  const setPreference = useSetPushPreference()
  const areas = useRiderAreas()
  const setAreas = useSetRiderAreas()
  const toast = useToast()
  const onError = (e: unknown) => toast(errorMessage(e), 'error')
  const chosen = areas.data ?? []

  return (
    <>
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <TruckIcon size={18} className="shrink-0 text-muted" />
          <strong className="min-w-0 flex-1">Job alerts</strong>
        </div>
        <p className="text-sm text-muted">At most {RIDER_JOB_ALERTS_PER_HOUR} an hour, and none while you’re holding as many jobs as you can.</p>
        <ul className="flex flex-col border-t border-line pt-1">
          {[NEW_JOBS, RETURNS].map((c) => (
            <li key={c.value} className="flex min-h-14 items-center gap-3">
              <span className="flex min-w-0 flex-1 flex-col text-sm">
                <span id={`rider-alert-${c.value}`} className="font-bold">{c.label}</span>
                <span className="text-xs text-subtle">{c.sub}</span>
              </span>
              <Switch
                checked={prefs.data?.[c.value] ?? true}
                labelledBy={`rider-alert-${c.value}`}
                disabled={!prefs.data}
                onChange={() => setPreference.mutate({ category: c.value, enabled: !(prefs.data?.[c.value] ?? true) }, { onError })}
              />
            </li>
          ))}
        </ul>
        <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
          <legend className="flex items-center gap-2 text-sm font-bold">
            <MapPinIcon size={16} className="text-muted" /> Areas for new jobs
          </legend>
          <p className="text-xs text-subtle">{chosen.length ? 'Only jobs collected in these areas.' : 'None chosen, so you hear about jobs anywhere in Lagos.'} Returns go by where the buyer is.</p>
          <div className="grid gap-x-3 sm:grid-cols-2">
            {DELIVERY_AREAS.map((a) => (
              <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0"
                  checked={chosen.includes(a.id)}
                  disabled={!areas.data || setAreas.isPending}
                  onChange={(e) => setAreas.mutate(e.target.checked ? [...chosen, a.id] : chosen.filter((id) => id !== a.id), { onError })}
                />
                {a.name}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>
      {api.pushPublicKey ? <PushSettings categories={[YOUR_JOBS]} /> : <PushToggle />}
    </>
  )
}
