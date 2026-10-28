import { createMockApi } from './mock'
import type { DrawMartApi } from './types'

/**
 * The one place the app chooses its backend. Swap this for a real
 * implementation of DrawMartApi when the backend exists.
 */
export const api: DrawMartApi = createMockApi()

export * from './types'
