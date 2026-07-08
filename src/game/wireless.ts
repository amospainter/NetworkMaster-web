import type { Device, GameState } from '../types'
import {
  REPEATER_RANGE,
  WIFI_INTERFERENCE_PPS_FACTOR,
  WIFI_INTERFERENCE_RANGE_FACTOR,
  WIFI_STANDARDS,
  WIRELESS_CAPABLE_KINDS,
} from './constants'
import { distanceBetween } from './utils'

/**
 * Calculates effective Wi-Fi range for an access point.
 *
 * @param hub - Wireless access point to inspect.
 * @returns Coverage radius in normalized canvas units, reduced during interference.
 */
export const hubRange = (hub: Device) =>
  WIFI_STANDARDS[Math.max(0, hub.wifiLevel)].range *
  (hub.interference > 0 ? WIFI_INTERFERENCE_RANGE_FACTOR : 1)

/**
 * Calculates effective Wi-Fi throughput for an access point.
 *
 * @param hub - Wireless access point to inspect.
 * @returns Current wireless packets-per-tick capacity.
 */
export const hubPps = (hub: Device) =>
  Math.max(1, Math.floor(hub.pps * (hub.interference > 0 ? WIFI_INTERFERENCE_PPS_FACTOR : 1)))

/**
 * Resolves a forwarding device's effective per-tick admission capacity.
 *
 * @param device - Forwarding device to inspect.
 * @returns Wireless-adjusted capacity for access points, otherwise the device PPS value.
 */
export const deviceCapacity = (device: Device) =>
  device.kind === 'wireless' ? hubPps(device) : device.pps

/**
 * Counts wireless-capable clients currently inside an access point's coverage.
 *
 * @param state - Current game state.
 * @param hub - Access point whose client load should be counted.
 * @returns Number of online, in-range wireless-capable clients.
 */
const wirelessClientLoad = (state: GameState, hub: Device) =>
  state.devices.filter(
    (candidate) =>
      WIRELESS_CAPABLE_KINDS.includes(candidate.kind) &&
      !candidate.offline &&
      candidate.id !== hub.id &&
      distanceBetween(candidate, hub) <= hubRange(hub),
  ).length

/**
 * Precomputes every wireless-capable device's serving access point in a
 * single pass, so a simulation tick that resolves routes for many packets
 * (or the redundancy check for many deliveries) can reuse one result instead
 * of re-deriving each hub's client load — and re-sorting hubs — per call.
 * Cable topology does not affect wireless association, so the same map
 * remains valid for any cable-edge-filtered clone of the same devices.
 *
 * @param state - Current game state.
 * @returns A map from wireless-capable client id to its serving access point id.
 */
export function buildWirelessAssociations(state: GameState): Map<string, string> {
  const hubs = state.devices.filter((device) => device.kind === 'wireless' && !device.offline)
  const loadByHubId = new Map(hubs.map((hub) => [hub.id, wirelessClientLoad(state, hub)]))

  // Pass 1: a repeater associates to a hub using the same nearest/least-loaded
  // rule as a client. Repeaters cannot chain off another repeater — only
  // hubs are eligible parents — so this stays a fixed two-pass resolve.
  const repeaters = state.devices.filter((device) => device.kind === 'repeater' && !device.offline)
  const repeaterHubId = new Map<string, string>()
  for (const repeater of repeaters) {
    const inRange = hubs.filter((hub) => distanceBetween(hub, repeater) <= hubRange(hub))
    if (!inRange.length) continue
    const bestHub = inRange.sort((firstHub, secondHub) => {
      const loadDelta = loadByHubId.get(firstHub.id)! - loadByHubId.get(secondHub.id)!
      if (loadDelta !== 0) return loadDelta
      return distanceBetween(firstHub, repeater) - distanceBetween(secondHub, repeater)
    })[0]
    repeaterHubId.set(repeater.id, bestHub.id)
  }
  const activeRepeaters = repeaters.filter((repeater) => repeaterHubId.has(repeater.id))

  // Pass 2: a client associates directly to an in-range hub, or to an active
  // repeater's parent hub when only the repeater's extended zone reaches it.
  const associations = new Map<string, string>()
  for (const client of state.devices) {
    if (!WIRELESS_CAPABLE_KINDS.includes(client.kind)) continue
    const candidates = [
      ...hubs
        .filter((hub) => distanceBetween(hub, client) <= hubRange(hub))
        .map((hub) => ({ hubId: hub.id, distance: distanceBetween(hub, client) })),
      ...activeRepeaters
        .filter((repeater) => distanceBetween(repeater, client) <= REPEATER_RANGE)
        .map((repeater) => ({
          hubId: repeaterHubId.get(repeater.id)!,
          distance: distanceBetween(repeater, client),
        })),
    ]
    if (!candidates.length) continue
    const best = candidates.sort((firstCandidate, secondCandidate) => {
      const loadDelta =
        loadByHubId.get(firstCandidate.hubId)! - loadByHubId.get(secondCandidate.hubId)!
      if (loadDelta !== 0) return loadDelta
      return firstCandidate.distance - secondCandidate.distance
    })[0]
    associations.set(client.id, best.hubId)
  }
  return associations
}

/**
 * Tests whether a client's serving access point is reached only through a
 * repeater's extended zone rather than the hub's own direct coverage circle,
 * so callers can apply the repeater latency penalty without re-deriving the
 * full two-pass association.
 *
 * @param state - Current game state.
 * @param clientId - Wireless-capable client identifier.
 * @param hubId - The client's resolved serving access point identifier.
 * @returns Whether the client is outside the hub's own direct range.
 */
export function isServedViaRepeater(state: GameState, clientId: string, hubId: string): boolean {
  const client = state.devices.find((device) => device.id === clientId)
  const hub = state.devices.find((device) => device.id === hubId)
  if (!client || !hub) return false
  return distanceBetween(client, hub) > hubRange(hub)
}

/**
 * Returns the access point currently serving a wireless-capable device.
 *
 * @param state - Current game state.
 * @param deviceId - Identifier of the client to resolve.
 * @returns The serving access point, or `null` when the client is invalid or uncovered.
 */
export function servingWirelessHub(state: GameState, deviceId: string): Device | null {
  const wirelessDevice = state.devices.find((device) => device.id === deviceId)
  if (!wirelessDevice || !WIRELESS_CAPABLE_KINDS.includes(wirelessDevice.kind)) return null
  // Delegates to the two-pass association (rather than `findWirelessHub`
  // directly) so a client served only through a repeater's extended zone
  // still resolves to its actual parent hub here.
  const hubId = buildWirelessAssociations(state).get(deviceId)
  return hubId ? (state.devices.find((device) => device.id === hubId) ?? null) : null
}

/**
 * Returns an access point's current Wi-Fi standard.
 *
 * @param device - Device to inspect.
 * @returns The matching Wi-Fi standard, or `null` for non-wireless devices.
 */
export const wifiInfo = (device: Device) =>
  device.kind === 'wireless' ? WIFI_STANDARDS[device.wifiLevel] : null
