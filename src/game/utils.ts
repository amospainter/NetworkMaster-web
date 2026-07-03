import type { Device, GameEvent, GameState } from '../types'
import { SITE_UPGRADE_DISCOUNT } from './constants'

/**
 * Creates a UUID in modern browsers and a standards-shaped fallback elsewhere.
 *
 * @returns A locally unique identifier suitable for persisted game entities.
 */
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

/**
 * Removes Vue proxies and guarantees reducers return a new serializable state tree.
 *
 * @typeParam T - JSON-safe value type being cloned.
 * @param value - Value to deep-clone through JSON serialization.
 * @returns A detached copy of the supplied value.
 */
export const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/**
 * Builds a timestamped event for the live activity feed.
 *
 * @param state - State supplying the current simulation tick.
 * @param text - Human-readable event message.
 * @returns A new timestamped game event.
 */
export const event = (state: GameState, text: string): GameEvent => ({ tick: state.tick, text })

/**
 * Records a timestamped event on a mutable draft state, capping the log at six entries.
 *
 * @param state - Mutable reducer draft receiving the event.
 * @param text - Human-readable event message.
 * @returns Nothing; the supplied draft is updated in place.
 */
export const addEvent = (state: GameState, text: string) => {
  state.events.unshift(event(state, text))
  if (state.events.length > 6) state.events.length = 6
}

/**
 * Calculates Euclidean distance between devices in normalized canvas coordinates.
 *
 * @param firstDevice - First device.
 * @param secondDevice - Second device.
 * @returns Distance in normalized canvas units.
 */
export const distanceBetween = (firstDevice: Device, secondDevice: Device) =>
  Math.hypot(firstDevice.x - secondDevice.x, firstDevice.y - secondDevice.y)

/**
 * Applies the site discount and rounds down to the integer-dollar economy.
 *
 * @param fullPrice - Undiscounted aggregate price.
 * @returns Discounted whole-dollar price.
 */
export const discountedSiteCost = (fullPrice: number) =>
  Math.floor(fullPrice * (1 - SITE_UPGRADE_DISCOUNT))
