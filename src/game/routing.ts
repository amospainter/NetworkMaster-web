import type { Device, GameState } from '../types'
import { DEVICE_RULES, WIRELESS_CAPABLE_KINDS } from './constants'
import { cloneState } from './utils'
import { findWirelessHub } from './wireless'

/**
 * Finds a shortest operational route using breadth-first search.
 *
 * The graph includes working cables plus current wireless associations. Offline
 * devices, failed cables, incompatible VLAN tags, and source-kind firewall
 * blocks are excluded before traversal.
 *
 * @param state - Current topology and operational state.
 * @param sourceId - Origin device identifier.
 * @param destinationId - Destination device identifier.
 * @returns The shortest device-id path, or `null` when no route exists.
 */
export function findRoute(
  state: GameState,
  sourceId: string,
  destinationId: string,
): string[] | null {
  const source = state.devices.find((device) => device.id === sourceId)
  if (!source) return null
  const adjacency = new Map<string, string[]>()
  /**
   * Adds both directions of an operational edge to the transient routing graph.
   *
   * @param firstId - First endpoint identifier.
   * @param secondId - Second endpoint identifier.
   * @returns Nothing; the adjacency map is updated in place.
   */
  const addEdge = (firstId: string, secondId: string) => {
    adjacency.set(firstId, [...(adjacency.get(firstId) || []), secondId])
    adjacency.set(secondId, [...(adjacency.get(secondId) || []), firstId])
  }
  for (const networkCable of state.cables)
    if (networkCable.status !== 'failed') {
      const firstDevice = state.devices.find((device) => device.id === networkCable.from)
      const secondDevice = state.devices.find((device) => device.id === networkCable.to)
      const vlanAllowsTraffic = networkCable.vlan === null || networkCable.vlan === source.subnet
      const firstDeviceAllowsTraffic =
        firstDevice?.kind !== 'firewall' || firstDevice.firewallRule !== source.kind
      const secondDeviceAllowsTraffic =
        secondDevice?.kind !== 'firewall' || secondDevice.firewallRule !== source.kind
      if (
        firstDevice &&
        !firstDevice.offline &&
        firstDeviceAllowsTraffic &&
        secondDevice &&
        !secondDevice.offline &&
        secondDeviceAllowsTraffic &&
        vlanAllowsTraffic
      ) {
        addEdge(networkCable.from, networkCable.to)
      }
    }
  const wirelessDevices = state.devices.filter((device) =>
    WIRELESS_CAPABLE_KINDS.includes(device.kind),
  )
  for (const wirelessDevice of wirelessDevices) {
    const accessPoint = findWirelessHub(state, wirelessDevice)
    if (accessPoint) addEdge(wirelessDevice.id, accessPoint.id)
  }

  const queue: [string, string[]][] = [[sourceId, [sourceId]]]
  const visited = new Set([sourceId])
  while (queue.length) {
    const [currentId, path] = queue.shift()!
    if (currentId === destinationId) return path
    for (const neighborId of adjacency.get(currentId) || [])
      if (!visited.has(neighborId)) {
        visited.add(neighborId)
        queue.push([neighborId, [...path, neighborId]])
      }
  }
  return null
}

/**
 * Returns 0, 1, or 2 depending on whether an edge-disjoint backup route exists.
 * The score intentionally caps at two because gameplay rewards redundancy,
 * rather than the exact maximum-flow path count.
 *
 * @param state - Current topology and operational state.
 * @param sourceId - Origin device identifier.
 * @param destinationId - Destination device identifier.
 * @returns Zero for no path, one for a single path, or two when a backup exists.
 */
export function independentPathCount(state: GameState, sourceId: string, destinationId: string) {
  const primaryRoute = findRoute(state, sourceId, destinationId)
  if (!primaryRoute) return 0
  const primaryEdges = new Set(
    primaryRoute
      .slice(1)
      .map((deviceId, index) => [primaryRoute[index], deviceId].sort().join('|')),
  )
  const stateWithoutPrimaryRoute = cloneState(state)
  stateWithoutPrimaryRoute.cables = stateWithoutPrimaryRoute.cables.filter(
    (networkCable) => !primaryEdges.has([networkCable.from, networkCable.to].sort().join('|')),
  )
  return findRoute(stateWithoutPrimaryRoute, sourceId, destinationId) ? 2 : 1
}

/**
 * Selects an operational device in another subnet to receive cross-subnet traffic.
 *
 * @param state - Current game state.
 * @param source - Traffic-generating source device.
 * @returns A randomly selected eligible destination, or `undefined` when none exists.
 */
export function pickCrossSubnetDest(state: GameState, source: Device): Device | undefined {
  const candidates = state.devices.filter(
    (device) =>
      device.subnet !== source.subnet &&
      (device.kind === 'server' || DEVICE_RULES[device.kind].rate > 0) &&
      !device.offline &&
      device.id !== source.id,
  )
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/**
 * Finds a route from a source to a destination that must pass through another device.
 *
 * @param state - Current topology and operational state.
 * @param sourceId - Origin device identifier.
 * @param viaId - Required intermediate device identifier.
 * @param destinationId - Destination device identifier.
 * @returns The combined route, or `null` when either route segment is unavailable.
 */
export function findRouteThrough(
  state: GameState,
  sourceId: string,
  viaId: string,
  destinationId: string,
): string[] | null {
  const toVia = findRoute(state, sourceId, viaId)
  const fromVia = findRoute(state, viaId, destinationId)
  if (!toVia || !fromVia) return null
  return [...toVia, ...fromVia.slice(1)]
}
