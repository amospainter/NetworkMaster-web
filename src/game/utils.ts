import type { Device, GameEvent, GameState } from '../types'
import { SITE_UPGRADE_DISCOUNT } from './constants'

/** Creates a UUID in modern browsers and a standards-shaped fallback elsewhere. */
export const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let index = 0; index < 16; index++) bytes[index] = Math.random() * 256
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hexadecimalBytes = [...bytes].map((value) => value.toString(16).padStart(2, '0'))
  return `${hexadecimalBytes.slice(0, 4).join('')}-${hexadecimalBytes.slice(4, 6).join('')}-${hexadecimalBytes.slice(6, 8).join('')}-${hexadecimalBytes.slice(8, 10).join('')}-${hexadecimalBytes.slice(10).join('')}`
}

/** Removes Vue proxies and guarantees reducers return a new serializable state tree. */
export const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Builds a timestamped event, so the HUD can show when it happened instead of guessing from list position. */
export const event = (state: GameState, text: string): GameEvent => ({ tick: state.tick, text })

/** Records a timestamped event on a mutable draft state, capping the log at 6 entries. */
export const addEvent = (state: GameState, text: string) => {
  state.events.unshift(event(state, text))
  if (state.events.length > 6) state.events.length = 6
}

export const distanceBetween = (firstDevice: Device, secondDevice: Device) =>
  Math.hypot(firstDevice.x - secondDevice.x, firstDevice.y - secondDevice.y)

export const discountedSiteCost = (fullPrice: number) =>
  Math.floor(fullPrice * (1 - SITE_UPGRADE_DISCOUNT))
