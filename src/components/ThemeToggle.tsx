import { useTheme, type ThemePref } from '@/lib/theme'
import { MonitorIcon, MoonIcon, SunIcon } from './icons'
import { IconButton, Segmented } from './ui'

const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

/** Compact header toggle that cycles system → light → dark. */
export function ThemeToggle() {
  const [pref, setPref] = useTheme()
  const Icon = ICON[pref]
  return (
    <IconButton aria-label={`Theme: ${pref}. Switch to ${NEXT[pref]}`} title={`Theme: ${pref}`} onClick={() => setPref(NEXT[pref])}>
      <Icon />
    </IconButton>
  )
}

/** Full three-way picker for settings screens. */
export function ThemePicker() {
  const [pref, setPref] = useTheme()
  return (
    <Segmented<ThemePref>
      label="Theme"
      value={pref}
      onChange={setPref}
      size="sm"
      options={[
        { value: 'light', label: <><SunIcon size={14} /> Light</> },
        { value: 'dark', label: <><MoonIcon size={14} /> Dark</> },
        { value: 'system', label: <><MonitorIcon size={14} /> Auto</> },
      ]}
    />
  )
}
