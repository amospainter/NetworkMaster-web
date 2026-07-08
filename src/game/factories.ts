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
  firewallRules: [],
  generated: 0,
  delivered: 0,
  interference: 0,
  ups: false,
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
  style: CableStyle = 'diagonal',
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
 * Composable building blocks for a scenario's starting topology. Each flag
 * adds one optional slice on top of the always-present cloud/router/SW-A/SW-B
 * base, so scenarios can mix features freely (e.g. Smart City combines
 * wireless with the firewall + dual-router stack, which the old
 * mutually-exclusive `.includes(scenarioId)` checks could not express).
 */
type ScenarioTopology = {
  /** Access-point Wi-Fi generation (index into `WIFI_STANDARDS`); adds an AP + phone + tablet when set. Note 0 is a valid level, so callers must check `!== undefined`. */
  wireless?: number
  /** Add a firewall on the primary router. */
  firewall?: boolean
  /** Add a server on SW-B (subnet 2). */
  server?: boolean
  /** Add a second server on SW-A (subnet 1) for heavier east-west cross-subnet traffic. */
  extraServer?: boolean
  /** Add the SW-C third-subnet switch. */
  thirdSubnet?: boolean
  /** Upgrade every starting cable to 10 Gigabit. */
  backbone?: boolean
}

/**
 * Per-scenario topology feature flags. Scenarios absent here (only `home`)
 * build no optional slices. Dual-router presence is driven separately by
 * `DUAL_ROUTER_LAYOUT` so the load-balancer coordinates stay the single
 * source of truth for that feature.
 */
const SCENARIO_TOPOLOGY: Record<string, ScenarioTopology> = {
  cafe: { wireless: 0 },
  startup: { wireless: 1 },
  school: { firewall: true, server: true, thirdSubnet: true },
  corporate: { firewall: true, server: true, thirdSubnet: true },
  metro: { firewall: true, server: true, thirdSubnet: true },
  branch: { server: true },
  arena: { wireless: 2 },
  isp: { firewall: true, server: true, thirdSubnet: true, backbone: true },
  datacenter: {
    firewall: true,
    server: true,
    extraServer: true,
    thirdSubnet: true,
    backbone: true,
  },
  edge: { firewall: true, server: true, thirdSubnet: true, backbone: true },
  smartcity: { wireless: 3, firewall: true, server: true, thirdSubnet: true, backbone: true },
}

/**
 * Per-scenario canvas coordinates for the dual-router/load-balancer core.
 * Only scenarios with an entry here get the second router; its presence is
 * the single source of truth for both "does this scenario get a load
 * balancer" and "where does it visually sit". Each layout is deliberately
 * distinct so the scenarios don't render as the same silhouette on the menu
 * preview: Corporate HQ is a tight central stack, ISP Hub puts the second
 * router off to the corner (hub-and-spoke), Metro Campus spreads its switches
 * wide, Data Center sits low and compact, and Smart City runs wide with a
 * high stack.
 */
const DUAL_ROUTER_LAYOUT: Record<
  string,
  {
    switchA: [number, number]
    switchB: [number, number]
    routerB: [number, number]
    loadBalancer: [number, number]
  }
> = {
  // Router-B/Load Balancer are spaced 12 apart (not the tighter minimum the
  // collision check allows) so their device labels don't crowd each other.
  corporate: { switchA: [29, 43], switchB: [71, 43], routerB: [50, 34], loadBalancer: [50, 46] },
  // Router-B sits at (80, 10), clear of the firewall at (72, 27).
  isp: { switchA: [29, 43], switchB: [71, 43], routerB: [80, 10], loadBalancer: [50, 40] },
  metro: { switchA: [10, 48], switchB: [90, 48], routerB: [50, 34], loadBalancer: [50, 46] },
  datacenter: { switchA: [24, 50], switchB: [76, 50], routerB: [50, 35], loadBalancer: [50, 47] },
  smartcity: { switchA: [16, 44], switchB: [74, 44], routerB: [50, 33], loadBalancer: [50, 45] },
}

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
  const cloudUplinkTier: CableTier =
    scenarioId === 'cafe' ? 'Copper' : scenarioId === 'home' ? 'Gigabit' : '10 Gigabit'
  connectDevices(cables, cloud, router, cloudUplinkTier)
  if (scenarioId === 'home') {
    devices.push(
      createDevice('pc', 'PC-1', 25, 66),
      createDevice('tv', 'Smart TV', 50, 70),
      createDevice('console', 'Console', 76, 66),
    )
    return { devices, cables }
  }
  const topology = SCENARIO_TOPOLOGY[scenarioId] ?? {}
  const dualRouterLayout = DUAL_ROUTER_LAYOUT[scenarioId]
  const [switchAX, switchAY] = dualRouterLayout?.switchA ?? [29, 43]
  const [switchBX, switchBY] = dualRouterLayout?.switchB ?? [71, 43]
  const firstSwitch = createDevice('switch', 'SW-A', switchAX, switchAY, 1)
  const secondSwitch = createDevice('switch', 'SW-B', switchBX, switchBY, 2)
  devices.push(firstSwitch, secondSwitch)
  if (dualRouterLayout) {
    // A second router with its own Cloud Edge uplink, bridged to both
    // switches through a load balancer, gives these scenarios a genuine
    // dual-path core: outbound traffic splits across both routers instead
    // of funneling through one chokepoint (see the load balancer's routing
    // note in CLAUDE.md).
    const [routerBX, routerBY] = dualRouterLayout.routerB
    const [loadBalancerX, loadBalancerY] = dualRouterLayout.loadBalancer
    const routerB = createDevice('router', 'Router-B', routerBX, routerBY, 1)
    const loadBalancer = createDevice(
      'loadBalancer',
      'Load Balancer',
      loadBalancerX,
      loadBalancerY,
      1,
    )
    devices.push(routerB, loadBalancer)
    connectDevices(cables, cloud, routerB, '10 Gigabit')
    connectDevices(cables, router, loadBalancer)
    connectDevices(cables, routerB, loadBalancer)
    connectDevices(cables, loadBalancer, firstSwitch)
    connectDevices(cables, loadBalancer, secondSwitch)
  } else {
    connectDevices(cables, router, firstSwitch)
    connectDevices(cables, router, secondSwitch)
  }
  // One unconnected end device per subnet is enough to teach "wire this in
  // yourself" — a full set on both sides made the initial canvas cluttered
  // (spawnDevice() adds more of these naturally as the run progresses).
  devices.push(createDevice('pc', 'Desk-A1', 16, 70, 1), createDevice('tv', 'Display-B', 67, 78, 2))
  if (topology.wireless !== undefined) {
    const accessPoint = createDevice('wireless', 'WiFi-B', 82, 48, 2)
    accessPoint.wifiLevel = topology.wireless
    accessPoint.pps = WIFI_STANDARDS[accessPoint.wifiLevel].pps
    devices.push(
      accessPoint,
      createDevice('phone', 'Phone', 89, 58, 2),
      createDevice('tablet', 'Tablet', 72, 59, 2),
    )
    connectDevices(cables, secondSwitch, accessPoint)
  }
  if (topology.firewall) {
    const firewall = createDevice('firewall', 'Firewall', 72, 27, 2)
    devices.push(firewall)
    connectDevices(cables, router, firewall)
  }
  if (topology.server) {
    const server = createDevice('server', 'Server', 50, 91, 2)
    devices.push(server)
    connectDevices(cables, secondSwitch, server)
  }
  if (topology.extraServer) {
    const extraServer = createDevice('server', 'Server-B', 16, 88, 1)
    devices.push(extraServer)
    connectDevices(cables, firstSwitch, extraServer)
  }
  if (topology.thirdSubnet) {
    // The third subnet starts as just the switch — unconnected desk devices
    // for it only added to an already-busy initial canvas; the player builds
    // onto it (or a spawned device gets wired here) once ready. Offset from
    // x=50 so its cable to Router doesn't run straight through a dual-router
    // stack, which also sits on that axis.
    const thirdSwitch = createDevice('switch', 'SW-C', 35, 60, 3)
    devices.push(thirdSwitch)
    connectDevices(cables, router, thirdSwitch)
  }
  if (topology.backbone) {
    cables.forEach((networkCable) => {
      networkCable.tier = '10 Gigabit'
      networkCable.capacity = 100
    })
  }
  return { devices, cables }
}
