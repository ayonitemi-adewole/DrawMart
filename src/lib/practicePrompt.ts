const KEY = 'drawmart:practice-prompt-dismissed'

/** Whether to keep offering the practice draw on this device. A convenience, so it's fine if storage is blocked. */
export function practicePromptDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function dismissPracticePrompt() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* storage blocked: it just shows again next time */
  }
}
