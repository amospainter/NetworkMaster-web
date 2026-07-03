import type { Cable, CableStyle, CableTier, Device, DeviceKind } from '../types'
import { CABLE_TIERS, DEVICE_RULES, WIFI_STANDARDS } from './constants'
import { createId } from './utils'

/**
 * Creates a device with the default port and throughput rules for its kind.
 *
 * @param kind - Device kind to create.
 * @param label - Player-facing device label.
 * @param x - Horizontal canvas percentage.
 * @param y - Vertical canvas percentage.
 * @param subnet - Initial logical subnet identifier.
 * @returns A new online device with no occupied ports or upgrade spend.
 */
export const createDevice = (
  kind: DeviceKind,
  label: string,
  x: number,
  y: number,
  subnet = 1,
): Device => ({
  id: createId(),
  kind,
  label,
  x,
  y,
  ports: 0,
  maxPorts: DEVICE_RULES[kind].ports,
  health: 100,
  wear: 0,
  offline: false,
  pps: DEVICE_RULES[kind].pps,
  subnet,
  wifiLevel: kind === 'wireless' ? 0 : -1,
  upgradeSpend: 0,
  firewallRule: null,
  generated: 0,
  delivered: 0,
  interference: 0,
})

/**
 * Creates an unloaded, operational cable between two devices.
 *
 * @param firstDevice - First endpoint.
 * @param secondDevice - Second endpoint.
 * @param tier - Initial cable tier.
 * @param vlan - Optional VLAN restriction.
 * @param style - Visual routing style.
 * @returns A new cable using the selected tier's capacity.
 */
export const createCable = (
  firstDevice: Device,
  secondDevice: Device,
  tier: CableTier = 'Copper',
  vlan: number | null = null,
  style: CableStyle = 'rightAngle',
): Cable => {
  const tierRules = CABLE_TIERS.find((candidate) => candidate.name === tier)!
  return {
    id: createId(),
    from: firstDevice.id,
    to: secondDevice.id,
    tier,
    capacity: tierRules.capacity,
    load: 0,
    status: 'idle',
    age: 0,
    vlan,
    upgradeSpend: 0,
    failedTicks: 0,
    style,
  }
}

/**
 * Appends a scenario-authored cable without player-economy validation.
 *
 * @param cables - Mutable scenario cable collection.
 * @param firstDevice - First endpoint.
 * @param secondDevice - Second endpoint.
 * @param tier - Initial cable tier.
 * @param vlan - Optional VLAN restriction.
 * @returns The new array length returned by `Array.push`.
 */
export const connectDevices = (
  cables: Cable[],
  firstDevice: Device,
  secondDevice: Device,
  tier: CableTier = 'Gigabit',
  vlan: number | null = null,
) => cables.push(createCable(firstDevice, secondDevice, tier, vlan))

/**
 * Builds the starting topology for a scenario definition.
 *
 * @param scenarioId - Scenario identifier; unknown values fall back to the home topology.
 * @returns Newly created devices and cables for the scenario.
 */
export function createScenarioTopology(scenarioId: string): {
  devices: Device[]
  cables: Cable[]
} {
  const cloud = createDevice('cloud', 'Cloud', 50, 7, 0),
    router = createDevice('router', 'Router', 50, 22, 1),
    devices = [cloud, router],
    cables: Cable[] = []
  connectDevices(cables, cloud, router, scenarioId === 'home' ? 'Gigabit' : '10 Gigabit')
  if (scenarioId === 'home') {
    devices.push(
      createDevice('pc', 'PC-1', 25, 66),
      createDevice('tv', 'Smart TV', 50, 70),
      createDevice('console', 'Console', 76, 66),
    )
    return { devices, cables }
  }
  const firstSwitch = createDevice('switch', 'SW-A', 29, 43, 1)
  const secondSwitch = createDevice('switch', 'SW-B', 71, 43, 2)
  devices.push(firstSwitch, secondSwitch)
  connectDevices(cables, router, firstSwitch)
  connectDevices(cables, router, secondSwitch)
  devices.push(
    createDevice('pc', 'Desk-A1', 16, 70, 1),
    createDevice('pc', 'Desk-A2', 32, 78, 1),
    createDevice('tv', 'Display-B', 67, 78, 2),
    createDevice('console', 'Console-B', 84, 69, 2),
  )
  if (['startup', 'arena'].includes(scenarioId)) {
    const accessPoint = createDevice('wireless', 'WiFi-B', 82, 48, 2)
    accessPoint.wifiLevel = scenarioId === 'arena' ? 2 : 1
    accessPoint.pps = WIFI_STANDARDS[accessPoint.wifiLevel].pps
    devices.push(
      accessPoint,
      createDevice('phone', 'Phone', 89, 58, 2),
      createDevice('tablet', 'Tablet', 72, 59, 2),
    )
    connectDevices(cables, secondSwitch, accessPoint)
  }
  if (!['startup', 'arena'].includes(scenarioId)) {
    const firewall = createDevice('firewall', 'Firewall', 72, 27, 2)
    const server = createDevice('server', 'Server', 50, 91, 2)
    devices.push(firewall, server)
    connectDevices(cables, router, firewall)
    connectDevices(cables, secondSwitch, server)
  }
  if (['corporate', 'metro', 'edge', 'isp'].includes(scenarioId)) {
    const thirdSwitch = createDevice('switch', 'SW-C', 50, 60, 3)
    devices.push(
      thirdSwitch,
      createDevice('pc', 'Desk-C1', 40, 83, 3),
      createDevice('console', 'Realtime-C', 55, 84, 3),
    )
    connectDevices(cables, router, thirdSwitch)
  }
  if (scenarioId === 'isp' || scenarioId === 'edge') {
    cables.forEach((networkCable) => {
      networkCable.tier = '10 Gigabit'
      networkCable.capacity = 100
    })
  }
  if (scenarioId === 'branch') {
    devices.splice(
      devices.findIndex((d) => d.kind === 'firewall'),
      1,
    )
    for (let i = cables.length - 1; i >= 0; i--)
      if (
        !devices.some((d) => d.id === cables[i].from) ||
        !devices.some((d) => d.id === cables[i].to)
      )
        cables.splice(i, 1)
  }
  return { devices, cables }
}
