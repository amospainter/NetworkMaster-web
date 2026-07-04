import type { Device, GameState } from '../types'
import {
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
  const associations = new Map<string, string>()
  for (const client of state.devices) {
    if (!WIRELESS_CAPABLE_KINDS.includes(client.kind)) continue
    const inRange = hubs.filter((hub) => distanceBetween(hub, client) <= hubRange(hub))
    if (!inRange.length) continue
    const bestHub = inRange.sort((firstHub, secondHub) => {
      const loadDelta = loadByHubId.get(firstHub.id)! - loadByHubId.get(secondHub.id)!
      if (loadDelta !== 0) return loadDelta
      return distanceBetween(firstHub, client) - distanceBetween(secondHub, client)
    })[0]
    associations.set(client.id, bestHub.id)
  }
  return associations
}

/**
 * Returns the operational access point covering a wireless-capable client,
 * preferring the least-loaded hub among those in range so clients spread out
 * across access points instead of piling onto a single one; nearest distance
 * breaks ties between equally loaded hubs.
 *
 * @param state - Current game state.
 * @param wirelessDevice - Client seeking an access point.
 * @returns The preferred operational access point, or `undefined` when none is in range.
 */
export const findWirelessHub = (state: GameState, wirelessDevice: Device) => {
  const candidates = state.devices.filter(
    (candidate) =>
      candidate.kind === 'wireless' &&
      !candidate.offline &&
      distanceBetween(candidate, wirelessDevice) <= hubRange(candidate),
  )
  // Precompute each candidate's load once rather than inside the sort
  // comparator, which would otherwise re-scan every device O(n log n) times.
  const loadByHubId = new Map(candidates.map((hub) => [hub.id, wirelessClientLoad(state, hub)]))
  return candidates.sort((firstHub, secondHub) => {
    const loadDelta = loadByHubId.get(firstHub.id)! - loadByHubId.get(secondHub.id)!
    if (loadDelta !== 0) return loadDelta
    return distanceBetween(firstHub, wirelessDevice) - distanceBetween(secondHub, wirelessDevice)
  })[0]
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
  return findWirelessHub(state, wirelessDevice) ?? null
}

/**
 * Returns an access point's current Wi-Fi standard.
 *
 * @param device - Device to inspect.
 * @returns The matching Wi-Fi standard, or `null` for non-wireless devices.
 */
export const wifiInfo = (device: Device) =>
  device.kind === 'wireless' ? WIFI_STANDARDS[device.wifiLevel] : null
