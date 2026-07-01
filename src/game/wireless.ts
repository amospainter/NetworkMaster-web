import type { Device, GameState } from '../types'
import {
  WIFI_INTERFERENCE_PPS_FACTOR,
  WIFI_INTERFERENCE_RANGE_FACTOR,
  WIFI_STANDARDS,
  WIRELESS_CAPABLE_KINDS,
} from './constants'
import { distanceBetween } from './utils'

/** Effective Wi-Fi range for a hub, shrunk while it suffers interference. */
export const hubRange = (hub: Device) =>
  WIFI_STANDARDS[Math.max(0, hub.wifiLevel)].range *
  (hub.interference > 0 ? WIFI_INTERFERENCE_RANGE_FACTOR : 1)

/** Effective Wi-Fi throughput for a hub, halved while it suffers interference. */
export const hubPps = (hub: Device) =>
  Math.max(1, Math.floor(hub.pps * (hub.interference > 0 ? WIFI_INTERFERENCE_PPS_FACTOR : 1)))

/** A forwarding device's effective per-tick admission capacity. */
export const deviceCapacity = (device: Device) =>
  device.kind === 'wireless' ? hubPps(device) : device.pps

/** Counts the wireless-capable clients currently inside a hub's coverage circle. */
const wirelessClientLoad = (state: GameState, hub: Device) =>
  state.devices.filter(
    (candidate) =>
      WIRELESS_CAPABLE_KINDS.includes(candidate.kind) &&
      !candidate.offline &&
      candidate.id !== hub.id &&
      distanceBetween(candidate, hub) <= hubRange(hub),
  ).length

/**
 * Returns the operational access point covering a wireless-capable client,
 * preferring the least-loaded hub among those in range so clients spread out
 * across access points instead of piling onto a single one; nearest distance
 * breaks ties between equally loaded hubs.
 */
export const findWirelessHub = (state: GameState, wirelessDevice: Device) =>
  state.devices
    .filter(
      (candidate) =>
        candidate.kind === 'wireless' &&
        !candidate.offline &&
        distanceBetween(candidate, wirelessDevice) <= hubRange(candidate),
    )
    .sort((firstHub, secondHub) => {
      const loadDelta = wirelessClientLoad(state, firstHub) - wirelessClientLoad(state, secondHub)
      if (loadDelta !== 0) return loadDelta
      return distanceBetween(firstHub, wirelessDevice) - distanceBetween(secondHub, wirelessDevice)
    })[0]

/** Returns the access point currently serving a wireless-capable device, if any. */
export function servingWirelessHub(state: GameState, deviceId: string): Device | null {
  const wirelessDevice = state.devices.find((device) => device.id === deviceId)
  if (!wirelessDevice || !WIRELESS_CAPABLE_KINDS.includes(wirelessDevice.kind)) return null
  return findWirelessHub(state, wirelessDevice) ?? null
}

export const wifiInfo = (device: Device) =>
  device.kind === 'wireless' ? WIFI_STANDARDS[device.wifiLevel] : null
