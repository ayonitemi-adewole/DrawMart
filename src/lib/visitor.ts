const KEY = 'drawmart:visitor'

/**
 * A random id for this browser, so a signed-out visitor's repeat visits to a
 * listing count once a day in seller insights. Not tied to a person.
 */
export function visitorId(): string {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved
    const id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    return crypto.randomUUID() // storage blocked: counts as a new visitor each time
  }
}
