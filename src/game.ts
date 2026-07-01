import type {
  Cable,
  CableStyle,
  CableTier,
  Device,
  DeviceKind,
  GameEvent,
  GameState,
  Packet,
  Priority,
  Scenario,
} from './types'

export const SCENARIOS: Scenario[] = [
  {
    id: 'home',
    name: 'Home Network',
    eyebrow: 'THE FIRST PACKET',
    description: 'Connect a small household and learn capacity, upgrades, and Wi-Fi.',
    difficulty: 1,
    budget: 100,
    equipmentFailure: false,
    rampStart: 180,
    spawnStart: 150,
    gameOverCheck: 80,
    challengeStart: 180,
    warmupFloor: 0.2,
    warmupTicks: 180,
  },
  {
    id: 'startup',
    name: 'Startup Office',
    eyebrow: 'MOVE FAST, ROUTE FASTER',
    description: 'Two teams share infrastructure while new hires arrive.',
    difficulty: 2,
    budget: 140,
    equipmentFailure: false,
    rampStart: 120,
    spawnStart: 120,
    gameOverCheck: 60,
    challengeStart: 120,
    warmupFloor: 0.3,
    warmupTicks: 120,
  },
  {
    id: 'corporate',
    name: 'Corporate HQ',
    eyebrow: 'NO SINGLE POINT OF FAILURE',
    description: 'Three subnets, a firewall, and aging equipment.',
    difficulty: 3,
    budget: 180,
    equipmentFailure: true,
    rampStart: 90,
    spawnStart: 105,
    gameOverCheck: 50,
    challengeStart: 105,
    warmupFloor: 0.45,
    warmupTicks: 90,
  },
  {
    id: 'isp',
    name: 'ISP Hub',
    eyebrow: 'THE BACKBONE',
    description: 'High-volume routing where every bottleneck becomes everyone’s problem.',
    difficulty: 4,
    budget: 220,
    equipmentFailure: true,
    rampStart: 75,
    spawnStart: 90,
    gameOverCheck: 45,
    challengeStart: 90,
    warmupFloor: 0.5,
    warmupTicks: 75,
  },
  {
    id: 'metro',
    name: 'Metro Campus',
    eyebrow: 'CROSS-CAMPUS TRAFFIC',
    description: 'Distributed switches and long paths reward redundancy.',
    difficulty: 3,
    budget: 200,
    equipmentFailure: true,
    rampStart: 90,
    spawnStart: 100,
    gameOverCheck: 50,
    challengeStart: 100,
    warmupFloor: 0.5,
    warmupTicks: 90,
  },
  {
    id: 'arena',
    name: 'Arena Night',
    eyebrow: 'WIRELESS CROWD',
    description: 'Phones, tablets, and streaming traffic flood access points.',
    difficulty: 4,
    budget: 240,
    equipmentFailure: true,
    rampStart: 70,
    spawnStart: 80,
    gameOverCheck: 45,
    challengeStart: 80,
    warmupFloor: 0.5,
    warmupTicks: 70,
  },
  {
    id: 'edge',
    name: 'Edge Exchange',
    eyebrow: 'LATENCY MATTERS',
    description: 'Realtime services compete with bulk traffic at the edge.',
    difficulty: 5,
    budget: 260,
    equipmentFailure: true,
    rampStart: 60,
    spawnStart: 75,
    gameOverCheck: 40,
    challengeStart: 75,
    warmupFloor: 0.5,
    warmupTicks: 60,
  },
  {
    id: 'branch',
    name: 'Branch Network',
    eyebrow: 'LEAN AND RESILIENT',
    description: 'A tight budget makes every port and backup link count.',
    difficulty: 4,
    budget: 120,
    equipmentFailure: true,
    rampStart: 75,
    spawnStart: 90,
    gameOverCheck: 45,
    challengeStart: 90,
    warmupFloor: 0.4,
    warmupTicks: 75,
  },
]

/** Ordered upgrade path shared by cable simulation, pricing, and the inspector UI. */
export const CABLE_TIERS: { name: CableTier; capacity: number; cost: number }[] = [
  { name: 'Copper', capacity: 2, cost: 50 },
  { name: 'Fast Ethernet', capacity: 5, cost: 90 },
  { name: 'Gigabit', capacity: 10, cost: 150 },
  { name: '5 Gigabit', capacity: 50, cost: 220 },
  { name: '10 Gigabit', capacity: 100, cost: 320 },
  { name: '25 Gigabit', capacity: 250, cost: 460 },
  { name: '50 Gigabit', capacity: 500, cost: 650 },
  { name: '100 Gigabit', capacity: 1000, cost: 999 },
]
/** Wi-Fi range is stored as a percentage of the responsive canvas width. */
const WIFI_STANDARDS = [
  { range: 14, pps: 4, cost: 40, name: '802.11b' },
  { range: 18, pps: 8, cost: 60, name: '802.11g' },
  { range: 22, pps: 14, cost: 90, name: '802.11n' },
  { range: 26, pps: 22, cost: 130, name: 'Wi-Fi 5' },
  { range: 30, pps: 32, cost: 180, name: 'Wi-Fi 6' },
  { range: 34, pps: 44, cost: 240, name: 'Wi-Fi 6E' },
  { range: 40, pps: 60, cost: 999, name: 'Wi-Fi 7' },
]
const SOURCE_SPAWN_ORDER: DeviceKind[] = ['pc', 'phone', 'console', 'tablet', 'tv']
/** Matches the native `wifiInterferenceRangeFactor`/`wifiInterferenceThroughputFactor`. */
const WIFI_INTERFERENCE_RANGE_FACTOR = 0.6
const WIFI_INTERFERENCE_PPS_FACTOR = 0.5
/** Higher weight forwards first under strict-priority admission. */
const PRIORITY_WEIGHT: Record<Priority, number> = { realtime: 2, stream: 1, bulk: 0 }
/** A packet held at a forwarding device's queue longer than this is dropped. */
const QUEUE_CAPACITY_TICKS = 6
const FORWARDING_KINDS: DeviceKind[] = ['router', 'switch', 'wireless', 'firewall']
/**
 * End-user devices that can join an access point's coverage. Phones and
 * tablets have no wired ports and are Wi-Fi only; pc/tv/console additionally
 * keep their wired ports, so a cable and Wi-Fi coverage both count as valid
 * connectivity for them.
 */
export const WIRELESS_CAPABLE_KINDS: DeviceKind[] = ['pc', 'tv', 'console', 'phone', 'tablet']
const WIRELESS_ONLY_KINDS: DeviceKind[] = ['phone', 'tablet']

/** Creates a UUID in modern browsers and a standards-shaped fallback elsewhere. */
const createId = () => {
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
const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Builds a timestamped event, so the HUD can show when it happened instead of guessing from list position. */
const event = (state: GameState, text: string): GameEvent => ({ tick: state.tick, text })

/** Records a timestamped event on a mutable draft state, capping the log at 6 entries. */
const addEvent = (state: GameState, text: string) => {
  state.events.unshift(event(state, text))
  if (state.events.length > 6) state.events.length = 6
}

const DEVICE_RULES: Record<
  DeviceKind,
  { ports: number; pps: number; priority: Priority; rate: number }
> = {
  cloud: { ports: 2, pps: 999, priority: 'bulk', rate: 0 },
  router: { ports: 8, pps: 20, priority: 'bulk', rate: 0 },
  switch: { ports: 4, pps: 8, priority: 'bulk', rate: 0 },
  pc: { ports: 1, pps: 999, priority: 'bulk', rate: 1 },
  tv: { ports: 1, pps: 999, priority: 'stream', rate: 2 },
  console: { ports: 1, pps: 999, priority: 'realtime', rate: 1 },
  phone: { ports: 0, pps: 999, priority: 'realtime', rate: 1 },
  tablet: { ports: 0, pps: 999, priority: 'stream', rate: 2 },
  server: { ports: 2, pps: 999, priority: 'bulk', rate: 0 },
  firewall: { ports: 4, pps: 12, priority: 'bulk', rate: 0 },
  wireless: { ports: 6, pps: 4, priority: 'bulk', rate: 0 },
}
/** Creates a device with the native game's default port and throughput rules. */
const createDevice = (
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
/** Creates an unloaded, operational cable between two devices. */
const createCable = (
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
const connectDevices = (
  cables: Cable[],
  firstDevice: Device,
  secondDevice: Device,
  tier: CableTier = 'Gigabit',
  vlan: number | null = null,
) => cables.push(createCable(firstDevice, secondDevice, tier, vlan))

/** Builds the starting topology for one of the eight scenario definitions. */
function createScenarioTopology(scenarioId: string): { devices: Device[]; cables: Cable[] } {
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

/** Creates a fresh, serializable run for the requested scenario. */
export function newGame(scenario = 'home'): GameState {
  const scenarioConfig = SCENARIOS.find((candidate) => candidate.id === scenario) ?? SCENARIOS[0]
  const topology = createScenarioTopology(scenarioConfig.id)
  topology.devices.forEach(
    (device) =>
      (device.ports = topology.cables.filter(
        (cable) => cable.from === device.id || cable.to === device.id,
      ).length),
  )
  return {
    version: 8,
    phase: 'playing',
    scenario: scenarioConfig.id,
    tick: 0,
    score: 0,
    budget: scenarioConfig.budget,
    delivered: 0,
    dropped: 0,
    failure: 0,
    speed: 1,
    ...topology,
    packets: [],
    events: [{ tick: 0, text: 'Run initialized. Connect clients to bring them online.' }],
    recentDrops: [],
    multiplier: 1,
    combo: 1,
    cleanTicks: 0,
    rate: 1,
    spawned: topology.devices.filter((device) => DEVICE_RULES[device.kind].rate > 0).length,
    seed: Math.floor(Math.random() * 0xffffffff),
    unscored: false,
    milestonesReached: [],
    activeEvents: [],
    recentLatencyTicks: 0,
    recentQueueDelayTicks: 0,
  }
}

/**
 * Per-scenario delivery-count milestones and their one-time budget awards,
 * mirroring the native `checkMilestones`. Rewards scale with scenario difficulty.
 */
const MILESTONES: Record<string, { at: number; award: number }[]> = {
  home: [
    { at: 25, award: 50 },
    { at: 75, award: 100 },
    { at: 150, award: 200 },
  ],
  startup: [
    { at: 40, award: 50 },
    { at: 120, award: 100 },
    { at: 240, award: 200 },
  ],
  corporate: [
    { at: 60, award: 50 },
    { at: 180, award: 100 },
    { at: 360, award: 200 },
  ],
  isp: [
    { at: 80, award: 75 },
    { at: 240, award: 150 },
    { at: 480, award: 300 },
  ],
  metro: [
    { at: 100, award: 100 },
    { at: 300, award: 200 },
    { at: 600, award: 400 },
  ],
  arena: [
    { at: 120, award: 125 },
    { at: 360, award: 250 },
    { at: 720, award: 500 },
  ],
  edge: [
    { at: 150, award: 150 },
    { at: 450, award: 300 },
    { at: 900, award: 600 },
  ],
  branch: [
    { at: 90, award: 100 },
    { at: 270, award: 200 },
    { at: 540, award: 400 },
  ],
}

/**
 * Eases demand in over a scenario's opening ticks so the network starts quiet
 * and the player can connect devices before traffic reaches full intensity.
 * Mirrors the native `warmupFactor`.
 */
function warmupFactor(tick: number, scenario: Scenario): number {
  if (tick >= scenario.warmupTicks) return 1
  const progress = tick / scenario.warmupTicks
  return scenario.warmupFloor + (1 - scenario.warmupFloor) * progress
}

/** Returns the active traffic-spike multiplier for a device (2x while spiked). */
function trafficSpikeMultiplier(state: GameState, deviceId: string): number {
  return state.activeEvents.some(
    (event) => event.kind === 'trafficSpike' && event.targetId === deviceId,
  )
    ? 2
    : 1
}

/**
 * Game-over score bonus rewarding a network that stayed intact and kept
 * delivering. Mirrors the native `calculateNetworkHealth`: the product of the
 * surviving-source ratio and the lifetime delivery ratio, scaled to 1000.
 */
export function networkHealthBonus(state: GameState): number {
  const sources = state.devices.filter((device) => DEVICE_RULES[device.kind].rate > 0)
  const totalGenerated = sources.reduce((total, device) => total + device.generated, 0)
  if (totalGenerated <= 0) return 0
  const totalDelivered = sources.reduce((total, device) => total + device.delivered, 0)
  const deviceRatio = sources.length / Math.max(1, state.spawned)
  const deliveryRatio = totalDelivered / totalGenerated
  return Math.round(deviceRatio * deliveryRatio * 1000)
}

/**
 * Upgrades a persisted save to the current schema, or returns null if it is too
 * old to migrate safely. Version 2 runs predate challenge events and milestones;
 * version 3 runs predate Wi-Fi interference; version 4 runs predate per-packet
 * queue admission; version 5 runs predate cable styles; version 6 runs predate
 * latency/queue-delay telemetry; version 7 runs predate per-event tick stamps.
 * Older or malformed saves are discarded.
 */
export function migrateSavedGame(
  savedGame: { version: number } & Partial<Omit<GameState, 'version'>>,
): GameState | null {
  if (savedGame.version === 2) {
    savedGame.devices?.forEach((device) => {
      device.upgradeSpend ??= 0
      device.firewallRule ??= null
    })
    savedGame.milestonesReached ??= []
    savedGame.activeEvents ??= []
    savedGame.version = 3
  }
  if (savedGame.version === 3) {
    savedGame.devices?.forEach((device) => {
      device.interference ??= 0
    })
    savedGame.version = 4
  }
  if (savedGame.version === 4) {
    // In-flight packets predate the queued-admission model; dropping them
    // loses no persisted progress since they are transient simulation state.
    savedGame.packets = []
    savedGame.version = 5
  }
  if (savedGame.version === 5) {
    savedGame.cables?.forEach((cable) => {
      cable.style ??= 'rightAngle'
    })
    savedGame.version = 6
  }
  if (savedGame.version === 6) {
    savedGame.recentLatencyTicks ??= 0
    savedGame.recentQueueDelayTicks ??= 0
    savedGame.version = 7
  }
  if (savedGame.version === 7) {
    // Legacy plain-string events predate per-event tick stamps; the original
    // tick each happened on isn't recoverable, so they're stamped with the
    // save's current tick as a one-time best-effort backfill.
    const legacyEvents = savedGame.events as unknown as string[] | undefined
    savedGame.events = (legacyEvents ?? []).map((text) => ({
      tick: savedGame.tick ?? 0,
      text,
    }))
    savedGame.version = 8
  }
  return savedGame.version === 8 ? (savedGame as GameState) : null
}

const distanceBetween = (firstDevice: Device, secondDevice: Device) =>
  Math.hypot(firstDevice.x - secondDevice.x, firstDevice.y - secondDevice.y)

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
const findWirelessHub = (state: GameState, wirelessDevice: Device) =>
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

/** Finds a shortest operational route using breadth-first search. */
export function findRoute(
  state: GameState,
  sourceId: string,
  destinationId: string,
): string[] | null {
  const source = state.devices.find((device) => device.id === sourceId)
  if (!source) return null
  const adjacency = new Map<string, string[]>()
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

/** Returns 0, 1, or 2 depending on whether an edge-disjoint backup route exists. */
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

/** Returns a random operational device in a different subnet to receive cross-subnet traffic. */
function pickCrossSubnetDest(state: GameState, source: Device): Device | undefined {
  const candidates = state.devices.filter(
    (device) =>
      device.subnet !== source.subnet &&
      (device.kind === 'server' || DEVICE_RULES[device.kind].rate > 0) &&
      !device.offline &&
      device.id !== source.id,
  )
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/** Finds a route from `sourceId` to `destinationId` that must pass through `viaId`. */
function findRouteThrough(
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

/** Creates an in-flight packet at the beginning of a resolved route. */
function packet(source: Device, path: string[], tick: number): Packet {
  return {
    id: createId(),
    path,
    hop: 0,
    progress: 0,
    priority: DEVICE_RULES[source.kind].priority,
    source: source.id,
    generatedTick: tick,
    queuedTicks: 0,
  }
}
/** Adds the next end-user device in the native spawn rotation. */
function spawnDevice(s: GameState) {
  if (s.devices.length >= 20) return
  const kind = SOURCE_SPAWN_ORDER[s.spawned % SOURCE_SPAWN_ORDER.length],
    router = s.devices.find((d) => d.kind === 'router')!,
    angle = (s.spawned * 2.4) % 6.28,
    d = createDevice(
      kind,
      `${kind[0].toUpperCase() + kind.slice(1)}-${s.spawned + 1}`,
      Math.max(8, Math.min(92, router.x + Math.cos(angle) * 34)),
      Math.max(38, Math.min(92, router.y + 45 + Math.sin(angle) * 18)),
      1,
    )
  s.devices.push(d)
  s.spawned++
  addEvent(
    s,
    `${d.label} joined — ${WIRELESS_ONLY_KINDS.includes(kind) ? 'move it into Wi-Fi coverage' : 'draw a cable, or move it into Wi-Fi coverage'}.`,
  )
}

/**
 * Rolls a single challenge event, mirroring the native `rollChallengeEvent`
 * weighting. Equipment-failure events only fire in scenarios that enable
 * equipment failure; the others can occur in any scenario.
 */
function rollChallengeEvent(state: GameState, scenario: Scenario) {
  const roll = Math.random() * 100
  let kind: 'trafficSpike' | 'budgetBonus' | 'deviceSurge' | 'equipmentFailure'
  if (roll < 35) kind = 'trafficSpike'
  else if (roll < 70) kind = scenario.equipmentFailure ? 'equipmentFailure' : 'budgetBonus'
  else if (roll < 90) kind = 'budgetBonus'
  else kind = 'deviceSurge'

  if (kind === 'trafficSpike') {
    // Weight selection inversely by packet rate so high-demand devices (TV,
    // tablet) are less likely to be spiked, matching the native bias.
    const candidates = state.devices.filter(
      (device) => DEVICE_RULES[device.kind].rate > 0 && !device.offline,
    )
    if (!candidates.length) return
    const minRate = Math.min(...candidates.map((device) => DEVICE_RULES[device.kind].rate))
    const weights = candidates.map((device) => minRate * 2 + 1 - DEVICE_RULES[device.kind].rate)
    let pick = Math.floor(
      Math.random() *
        Math.max(
          1,
          weights.reduce((sum, w) => sum + w, 0),
        ),
    )
    let target = candidates[0]
    for (let index = 0; index < candidates.length; index++) {
      pick -= weights[index]
      if (pick < 0) {
        target = candidates[index]
        break
      }
    }
    state.activeEvents.push({
      id: createId(),
      kind: 'trafficSpike',
      ticksRemaining: 10,
      targetId: target.id,
    })
    addEvent(state, `Traffic spike: ${target.label} doubles demand for 10 ticks.`)
    return
  }
  if (kind === 'budgetBonus') {
    state.budget += 75
    addEvent(state, 'Budget bonus! +$75')
    return
  }
  if (kind === 'deviceSurge') {
    spawnDevice(state)
    spawnDevice(state)
    addEvent(state, 'Device surge! Two new devices joined the network.')
    return
  }
  // equipmentFailure: fail a worn, online infrastructure device outright.
  const candidates = state.devices.filter(
    (device) =>
      ['router', 'switch', 'wireless', 'firewall'].includes(device.kind) && !device.offline,
  )
  if (!candidates.length) return
  const target = candidates[Math.floor(Math.random() * candidates.length)]
  // Failure probability scales with accumulated wear: fresh gear rarely fails.
  const failChance = Math.min(90, 15 + target.wear)
  if (Math.random() * 100 >= failChance) return
  target.health = 0
  target.wear += 30
  target.offline = true
  state.packets = []
  addEvent(state, `${target.label} failed! Repair or replace it.`)
}

/** Decrements timed events, announces expirations, and drops spent entries. */
function tickActiveEvents(state: GameState) {
  for (const event of state.activeEvents) {
    event.ticksRemaining--
    if (event.ticksRemaining <= 0 && event.kind === 'trafficSpike') {
      const target = state.devices.find((device) => device.id === event.targetId)
      addEvent(state, `Traffic spike on ${target?.label ?? 'device'} subsided.`)
    }
  }
  state.activeEvents = state.activeEvents.filter((event) => event.ticksRemaining > 0)
}

/**
 * Random Wi-Fi interference: active access points occasionally lose range and
 * throughput for a stretch of ticks, making wireless less dependable than a
 * wired link. Mirrors the native `tickWirelessInterference`.
 */
function tickWirelessInterference(state: GameState) {
  for (const device of state.devices) {
    if (device.kind !== 'wireless') continue
    if (device.interference > 0) {
      device.interference--
      if (device.interference === 0) {
        addEvent(state, `${device.label} interference cleared.`)
      }
      continue
    }
    if (device.offline) continue
    // Hubs actually serving clients are more exposed to interference.
    const serving = state.devices.some(
      (candidate) =>
        WIRELESS_CAPABLE_KINDS.includes(candidate.kind) &&
        !candidate.offline &&
        distanceBetween(candidate, device) <= hubRange(device),
    )
    const chancePerTick = serving ? 0.007 : 0.002
    if (Math.random() < chancePerTick) {
      device.interference = 8 + Math.floor(Math.random() * 11) // 8-18 ticks
      addEvent(state, `${device.label} hit by Wi-Fi interference — range & speed cut.`)
    }
  }
}

/** Awards each delivery-count milestone once, mirroring the native rewards. */
function checkMilestones(state: GameState) {
  const milestones = MILESTONES[state.scenario] ?? MILESTONES.home
  for (const milestone of milestones) {
    if (state.delivered < milestone.at || state.milestonesReached.includes(milestone.at)) continue
    state.milestonesReached.push(milestone.at)
    state.budget += milestone.award
    addEvent(state, `Milestone: ${milestone.at} packets delivered! +$${milestone.award}`)
  }
}

/**
 * Advances the deterministic game model by one simulation tick.
 *
 * The reducer never mutates the caller's object. Its phases mirror the native
 * engine: advance packets, account for link/device load, generate traffic,
 * update pressure/economy, then evaluate progression and game over.
 */
export function simulate(state: GameState): GameState {
  if (state.phase !== 'playing') return state
  const nextState = cloneState(state)
  const scenarioConfig =
    SCENARIOS.find((scenario) => scenario.id === nextState.scenario) ?? SCENARIOS[0]

  nextState.tick++
  nextState.cables.forEach((networkCable) => {
    networkCable.load = 0
    networkCable.age++
    if (networkCable.failedTicks > 0 && --networkCable.failedTicks === 0) {
      networkCable.status = 'idle'
    } else if (!networkCable.failedTicks) {
      networkCable.status = 'idle'
    }
  })

  let packetsDroppedThisTick = 0
  // Packets that finish traversing their current cable this tick try to arrive
  // at path[hop + 1]. Forwarding devices (router/switch/wireless/firewall)
  // admit only as many as their PPS allows, in strict priority order
  // (realtime > stream > bulk); the rest wait in a real per-device queue
  // instead of vanishing, and are dropped only after `QUEUE_CAPACITY_TICKS`.
  const arrivingByDevice = new Map<string, Packet[]>()
  const steadyPackets: Packet[] = []
  for (const activePacket of nextState.packets) {
    if (activePacket.progress + 0.5 < 1) {
      activePacket.progress += 0.5
      steadyPackets.push(activePacket)
      continue
    }
    const arrivingDeviceId = activePacket.path[activePacket.hop + 1]
    const arrivals = arrivingByDevice.get(arrivingDeviceId) ?? []
    arrivals.push(activePacket)
    arrivingByDevice.set(arrivingDeviceId, arrivals)
  }

  const admittedPackets: Packet[] = []
  const requeuedPackets: Packet[] = []
  for (const [arrivingDeviceId, arrivals] of arrivingByDevice) {
    const arrivingDevice = nextState.devices.find((device) => device.id === arrivingDeviceId)
    if (!arrivingDevice || !FORWARDING_KINDS.includes(arrivingDevice.kind)) {
      admittedPackets.push(...arrivals)
      continue
    }
    const capacity = deviceCapacity(arrivingDevice)
    const ordered = [...arrivals].sort(
      (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority],
    )
    admittedPackets.push(...ordered.slice(0, capacity))
    const overflow = ordered.slice(capacity)
    for (const overflowPacket of overflow) {
      overflowPacket.queuedTicks++
      if (overflowPacket.queuedTicks > QUEUE_CAPACITY_TICKS) packetsDroppedThisTick++
      else requeuedPackets.push(overflowPacket)
    }
    if (overflow.length > 0) {
      arrivingDevice.wear++
      if (scenarioConfig.equipmentFailure && arrivingDevice.wear > 20) {
        const healthLoss = Math.max(1, Math.floor(arrivingDevice.wear / 25))
        arrivingDevice.health = Math.max(0, arrivingDevice.health - healthLoss)
        arrivingDevice.offline = arrivingDevice.health === 0
      }
    }
  }
  for (const admittedPacket of admittedPackets) {
    admittedPacket.progress = 0
    admittedPacket.hop++
  }
  // Requeued packets keep their pre-arrival progress so they retry admission
  // next tick instead of restarting their cable traversal from the source.
  nextState.packets = [...steadyPackets, ...admittedPackets, ...requeuedPackets]

  const deliveredPackets = nextState.packets.filter(
    (activePacket) => activePacket.hop >= activePacket.path.length - 1,
  )
  const inFlightPackets = nextState.packets.filter(
    (activePacket) => activePacket.hop < activePacket.path.length - 1,
  )
  nextState.packets = inFlightPackets
  nextState.delivered += deliveredPackets.length

  for (const deliveredPacket of deliveredPackets) {
    const sourceDevice = nextState.devices.find((device) => device.id === deliveredPacket.source)
    if (sourceDevice) sourceDevice.delivered++
    const destinationId = deliveredPacket.path[deliveredPacket.path.length - 1]
    const redundancyBonus =
      independentPathCount(nextState, deliveredPacket.source, destinationId) >= 2 ? 5 : 0
    nextState.score += 10 * nextState.multiplier * nextState.combo + redundancyBonus
    const latency = Math.max(0, nextState.tick - deliveredPacket.generatedTick)
    nextState.recentLatencyTicks =
      nextState.recentLatencyTicks === 0
        ? latency
        : nextState.recentLatencyTicks * 0.75 + latency * 0.25
    nextState.recentQueueDelayTicks =
      nextState.recentQueueDelayTicks === 0
        ? deliveredPacket.queuedTicks
        : nextState.recentQueueDelayTicks * 0.75 + deliveredPacket.queuedTicks * 0.25
  }

  for (const activePacket of inFlightPackets) {
    const currentDeviceId = activePacket.path[activePacket.hop]
    const nextDeviceId = activePacket.path[activePacket.hop + 1]
    const activeCable = nextState.cables.find(
      (networkCable) =>
        (networkCable.from === currentDeviceId && networkCable.to === nextDeviceId) ||
        (networkCable.to === currentDeviceId && networkCable.from === nextDeviceId),
    )
    if (activeCable) activeCable.load++
  }

  const cloud = nextState.devices.find((device) => device.kind === 'cloud')!
  const router = nextState.devices.find((device) => device.kind === 'router')!
  const warmup = warmupFactor(nextState.tick, scenarioConfig)
  const sourceDevices = nextState.devices.filter((device) => DEVICE_RULES[device.kind].rate > 0)
  for (const sourceDevice of sourceDevices) {
    const requestedTraffic =
      DEVICE_RULES[sourceDevice.kind].rate *
      nextState.rate *
      warmup *
      trafficSpikeMultiplier(nextState, sourceDevice.id)
    const packetAttempts =
      Math.floor(requestedTraffic) + (Math.random() < requestedTraffic % 1 ? 1 : 0)
    for (let attempt = 0; attempt < packetAttempts; attempt++) {
      if (Math.random() > 0.24) continue
      sourceDevice.generated++
      let route = findRoute(nextState, sourceDevice.id, cloud.id)
      // 30% of traffic in multi-subnet scenarios targets another device on the
      // network (e.g. desk-to-server) instead of the cloud, routed via the router.
      if (scenarioConfig.id !== 'home' && Math.random() < 0.3) {
        const crossDest = pickCrossSubnetDest(nextState, sourceDevice)
        if (crossDest) {
          const crossRoute = findRouteThrough(nextState, sourceDevice.id, router.id, crossDest.id)
          if (crossRoute) route = crossRoute
        }
      }
      if (route) nextState.packets.push(packet(sourceDevice, route, nextState.tick))
      else packetsDroppedThisTick++
    }
  }

  for (const networkCable of nextState.cables) {
    if (!networkCable.load) continue
    networkCable.status = networkCable.load > networkCable.capacity ? 'congested' : 'active'
    if (networkCable.status === 'congested') {
      packetsDroppedThisTick += Math.max(0, networkCable.load - networkCable.capacity)
    }
  }

  nextState.dropped += packetsDroppedThisTick
  nextState.recentDrops.push(packetsDroppedThisTick)
  if (nextState.recentDrops.length > 20) nextState.recentDrops.shift()
  const rollingDropTotal = nextState.recentDrops.reduce((total, drops) => total + drops, 0)
  nextState.failure = Math.min(100, (rollingDropTotal / 30) * 100)

  if (packetsDroppedThisTick === 0) {
    nextState.cleanTicks++
    nextState.combo = Math.min(5, 1 + Math.floor(nextState.cleanTicks / 5))
  } else if (packetsDroppedThisTick >= 3) {
    nextState.cleanTicks = 0
    nextState.combo = 1
  }

  if (nextState.tick % 15 === 0) {
    const income = 25 + 5 * nextState.multiplier
    nextState.budget += income
    addEvent(nextState, `Budget allocation received: +$${income}`)
  }
  if (nextState.tick % 90 === 0) nextState.multiplier++
  if (nextState.tick >= scenarioConfig.rampStart && nextState.tick % 90 === 0) {
    nextState.rate = Math.min(2.25, nextState.rate * 1.04)
  }
  if (nextState.tick >= scenarioConfig.spawnStart && nextState.tick % 150 === 0) {
    spawnDevice(nextState)
  }

  if (scenarioConfig.equipmentFailure && nextState.rate >= 2 && nextState.tick % 90 === 0) {
    const faultCandidates = nextState.cables.filter(
      (networkCable) =>
        !networkCable.failedTicks &&
        nextState.devices.find((device) => device.id === networkCable.from)?.kind !== 'router',
    )
    const failedCable = faultCandidates[Math.floor(Math.random() * faultCandidates.length)]
    if (failedCable) {
      failedCable.status = 'failed'
      failedCable.failedTicks = 4
      addEvent(nextState, 'Cable fault — rerouting traffic for 4 ticks.')
    }
  }

  // Warn equipment-failure scenarios 5 ticks before challenge events begin.
  if (scenarioConfig.equipmentFailure && nextState.tick === scenarioConfig.challengeStart - 5) {
    addEvent(nextState, 'Network stress event imminent — check your infrastructure.')
  }
  if (
    nextState.tick >= scenarioConfig.challengeStart &&
    (nextState.tick - scenarioConfig.challengeStart) % 90 === 0
  ) {
    rollChallengeEvent(nextState, scenarioConfig)
  }
  tickActiveEvents(nextState)
  checkMilestones(nextState)
  tickWirelessInterference(nextState)

  const shouldEndRun =
    !nextState.unscored &&
    nextState.tick >= scenarioConfig.gameOverCheck &&
    nextState.recentDrops.length === 20 &&
    rollingDropTotal > 30
  if (shouldEndRun) {
    nextState.phase = 'gameover'
    const healthBonus = networkHealthBonus(nextState)
    nextState.score += healthBonus
    addEvent(
      nextState,
      `Network failure threshold exceeded.${healthBonus ? ` Network health bonus: +${healthBonus}.` : ''}`,
    )
  }
  nextState.events = nextState.events.slice(0, 6)
  return nextState
}

/** Validates topology rules and adds a new copper connection. */
export function addCable(
  state: GameState,
  from: string,
  to: string,
  style: CableStyle = 'rightAngle',
): GameState {
  const s = cloneState(state),
    a = s.devices.find((d) => d.id === from),
    b = s.devices.find((d) => d.id === to)
  if (!a || !b || from === to) return state
  if ([a, b].some((d) => WIRELESS_ONLY_KINDS.includes(d.kind)))
    return {
      ...state,
      events: [
        event(state, 'Phones and tablets connect through Wi-Fi coverage only.'),
        ...state.events,
      ].slice(0, 6),
    }
  if (s.cables.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from)))
    return state
  if (a.ports >= a.maxPorts || b.ports >= b.maxPorts)
    return {
      ...state,
      events: [event(state, 'Connection rejected: no free ports.'), ...state.events].slice(0, 6),
    }
  const end = (d: Device) => ['pc', 'tv', 'console', 'server'].includes(d.kind)
  if (end(a) && end(b))
    return {
      ...state,
      events: [
        event(state, 'End devices need network equipment between them.'),
        ...state.events,
      ].slice(0, 6),
    }
  if ((a.kind === 'cloud' || b.kind === 'cloud') && a.kind !== 'router' && b.kind !== 'router')
    return {
      ...state,
      events: [event(state, 'Only a router may connect to the Cloud Edge.'), ...state.events].slice(
        0,
        6,
      ),
    }
  s.cables.push(createCable(a, b, 'Copper', null, style))
  a.ports++
  b.ports++
  s.packets = []
  addEvent(s, `${a.label} linked to ${b.label}.`)
  return s
}

/**
 * Moves one end of an existing cable to a new device, preserving its tier,
 * VLAN, style, and upgrade investment. Validation mirrors `addCable` while
 * keeping the fixed end untouched. Mirrors the native `rerouteCable`.
 */
export function rerouteCable(
  state: GameState,
  cableId: string,
  movingFromEnd: boolean,
  newDeviceId: string,
): GameState {
  const s = cloneState(state),
    cable = s.cables.find((c) => c.id === cableId)
  if (!cable) return state
  const fixedId = movingFromEnd ? cable.to : cable.from
  const movingId = movingFromEnd ? cable.from : cable.to
  if (newDeviceId === fixedId || newDeviceId === movingId) return state
  const fixed = s.devices.find((d) => d.id === fixedId),
    target = s.devices.find((d) => d.id === newDeviceId),
    moving = s.devices.find((d) => d.id === movingId)
  if (!fixed || !target || !moving) return state
  const end = (d: Device) => ['pc', 'tv', 'console', 'server'].includes(d.kind)
  if (end(fixed) && end(target))
    return {
      ...state,
      events: [
        event(state, 'End devices need network equipment between them.'),
        ...state.events,
      ].slice(0, 6),
    }
  if ([fixed, target].some((d) => WIRELESS_ONLY_KINDS.includes(d.kind)))
    return {
      ...state,
      events: [
        event(state, 'Phones and tablets connect through Wi-Fi coverage only.'),
        ...state.events,
      ].slice(0, 6),
    }
  if (
    (fixed.kind === 'cloud' || target.kind === 'cloud') &&
    fixed.kind !== 'router' &&
    target.kind !== 'router'
  )
    return {
      ...state,
      events: [event(state, 'Only a router may connect to the Cloud Edge.'), ...state.events].slice(
        0,
        6,
      ),
    }
  if (
    s.cables.some(
      (c) =>
        c.id !== cableId &&
        ((c.from === fixedId && c.to === newDeviceId) ||
          (c.from === newDeviceId && c.to === fixedId)),
    )
  )
    return {
      ...state,
      events: [event(state, 'That connection already exists.'), ...state.events].slice(0, 6),
    }
  if (target.ports >= target.maxPorts)
    return {
      ...state,
      events: [
        event(state, `${target.label} has no free ports for this connection.`),
        ...state.events,
      ].slice(0, 6),
    }
  moving.ports--
  target.ports++
  if (movingFromEnd) cable.from = newDeviceId
  else cable.to = newDeviceId
  s.packets = []
  addEvent(s, `Rerouted connection to ${target.label}.`)
  return s
}
const costs: Partial<Record<DeviceKind, number>> = {
  switch: 80,
  router: 140,
  wireless: 90,
  server: 120,
  firewall: 110,
}

const SALVAGE_RATE = 0.9
const SITE_UPGRADE_DISCOUNT = 0.15

const discountedSiteCost = (fullPrice: number) =>
  Math.floor(fullPrice * (1 - SITE_UPGRADE_DISCOUNT))

/** Returns the native 90% salvage value for removable infrastructure. */
export function deviceRemovalRefund(device: Device): number {
  const buildCost = costs[device.kind]
  if (!buildCost) return 0
  return Math.floor((buildCost + device.upgradeSpend) * SALVAGE_RATE)
}

/** Purchases and places infrastructure at a canvas percentage coordinate. */
export function buildDevice(state: GameState, kind: DeviceKind, x = 50, y = 55): GameState {
  const cost = costs[kind] ?? 999
  if (state.budget < cost)
    return { ...state, events: [event(state, 'Insufficient budget.'), ...state.events].slice(0, 6) }
  const s = cloneState(state),
    count = s.devices.filter((d) => d.kind === kind).length + 1
  s.devices.push(createDevice(kind, `${kind[0].toUpperCase() + kind.slice(1)}-${count}`, x, y))
  s.budget -= cost
  addEvent(s, `${kind} placed. Drag it into position.`)
  return s
}
/** Advances a cable by one tier and records its refundable player investment. */
export function upgradeCable(state: GameState, cableId: string): GameState {
  const s = cloneState(state),
    c = s.cables.find((x) => x.id === cableId)
  if (!c) return state
  const i = CABLE_TIERS.findIndex((t) => t.name === c.tier),
    next = CABLE_TIERS[i + 1]
  if (!next) return state
  const cost = CABLE_TIERS[i].cost
  if (s.budget < cost)
    return {
      ...state,
      events: [event(state, 'Insufficient budget for cable upgrade.'), ...state.events].slice(0, 6),
    }
  c.tier = next.name
  c.capacity = next.capacity
  c.upgradeSpend += cost
  s.budget -= cost
  addEvent(s, `Cable upgraded to ${next.name}.`)
  return s
}
/** Removes a cable, clears in-flight traffic, and returns 90% of upgrade spend. */
export function deleteCable(state: GameState, cableId: string): GameState {
  const s = cloneState(state),
    c = s.cables.find((x) => x.id === cableId)
  if (!c) return state
  s.cables = s.cables.filter((x) => x.id !== cableId)
  for (const id of [c.from, c.to]) {
    const d = s.devices.find((x) => x.id === id)
    if (d) d.ports = Math.max(0, d.ports - 1)
  }
  const refund = Math.floor(c.upgradeSpend * 0.9)
  s.budget += refund
  s.packets = []
  addEvent(s, `Cable removed${refund ? ` · $${refund} salvaged` : ''}.`)
  return s
}

/** Cycles a cable through untagged and VLANs 1–4. */
export function cycleCableVlan(state: GameState, cableId: string): GameState {
  const nextState = cloneState(state)
  const networkCable = nextState.cables.find((candidate) => candidate.id === cableId)
  if (!networkCable) return state
  networkCable.vlan =
    networkCable.vlan === null ? 1 : networkCable.vlan >= 4 ? null : networkCable.vlan + 1
  nextState.packets = []
  addEvent(nextState, `Cable VLAN set to ${networkCable.vlan ?? 'untagged'}.`)
  return nextState
}

/** Cycles a firewall rule through no block, PC, TV, and console traffic. */
export function cycleFirewallRule(state: GameState, deviceId: string): GameState {
  const nextState = cloneState(state)
  const firewall = nextState.devices.find((device) => device.id === deviceId)
  if (!firewall || firewall.kind !== 'firewall') return state
  const rules: (DeviceKind | null)[] = [null, 'pc', 'tv', 'console']
  const nextRuleIndex = (rules.indexOf(firewall.firewallRule) + 1) % rules.length
  firewall.firewallRule = rules[nextRuleIndex]
  nextState.packets = []
  addEvent(nextState, `${firewall.label} block rule: ${firewall.firewallRule ?? 'none'}.`)
  return nextState
}
/** Adds two physical ports to a router or switch. */
export function upgradeDevicePorts(state: GameState, deviceId: string): GameState {
  if (state.budget < 50)
    return {
      ...state,
      events: [event(state, 'Insufficient budget for port expansion.'), ...state.events].slice(
        0,
        6,
      ),
    }
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || !['router', 'switch'].includes(d.kind)) return state
  d.maxPorts += 2
  d.upgradeSpend += 50
  s.budget -= 50
  addEvent(s, `${d.label} expanded by 2 ports.`)
  return s
}
/** Raises forwarding throughput for a router or switch. */
export function upgradeDeviceSpeed(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || !['router', 'switch'].includes(d.kind)) return state
  const upgradeCost = d.kind === 'router' ? 90 : 60
  if (s.budget < upgradeCost) return state
  d.pps += d.kind === 'router' ? 8 : 4
  d.upgradeSpend += upgradeCost
  s.budget -= upgradeCost
  addEvent(s, `${d.label} forwarding capacity upgraded.`)
  return s
}
/** Advances an access point to the next Wi-Fi generation. */
export function upgradeWifi(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || d.kind !== 'wireless' || d.wifiLevel >= WIFI_STANDARDS.length - 1) return state
  const cost = WIFI_STANDARDS[d.wifiLevel].cost
  if (s.budget < cost) return state
  d.wifiLevel++
  d.pps = WIFI_STANDARDS[d.wifiLevel].pps
  d.upgradeSpend += cost
  s.budget -= cost
  addEvent(s, `${d.label} upgraded to ${WIFI_STANDARDS[d.wifiLevel].name}.`)
  return s
}
/** Restores an infrastructure device while intentionally retaining accumulated wear. */
export function repairDevice(state: GameState, deviceId: string): GameState {
  if (state.budget < 40) return state
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d) return state
  d.health = 100
  d.offline = false
  s.budget -= 40
  addEvent(s, `${d.label} repaired; accumulated wear remains.`)
  return s
}

/**
 * Removes player-manageable equipment and every attached cable.
 *
 * The refund combines 90% of build and device-upgrade spend with the salvage
 * value of attached cable upgrades. End-user devices and the Cloud are fixed.
 */
export function removeDevice(state: GameState, deviceId: string): GameState {
  const device = state.devices.find((candidate) => candidate.id === deviceId)
  if (!device || !costs[device.kind]) return state

  const nextState = cloneState(state)
  const attachedCables = nextState.cables.filter(
    (networkCable) => networkCable.from === deviceId || networkCable.to === deviceId,
  )
  const cableRefund = attachedCables.reduce(
    (total, networkCable) => total + Math.floor(networkCable.upgradeSpend * SALVAGE_RATE),
    0,
  )
  const equipmentRefund = deviceRemovalRefund(device)
  const attachedCableIds = new Set(attachedCables.map((networkCable) => networkCable.id))

  nextState.cables = nextState.cables.filter(
    (networkCable) => !attachedCableIds.has(networkCable.id),
  )
  nextState.devices = nextState.devices.filter((candidate) => candidate.id !== deviceId)
  for (const remainingDevice of nextState.devices) {
    remainingDevice.ports = nextState.cables.filter(
      (networkCable) =>
        networkCable.from === remainingDevice.id || networkCable.to === remainingDevice.id,
    ).length
  }
  nextState.packets = []
  nextState.budget += equipmentRefund + cableRefund
  addEvent(nextState, `Removed ${device.label} (+$${equipmentRefund + cableRefund} salvage).`)
  return nextState
}
/** True when a cable is the fixed-tier ISP uplink, excluded from site bulk-upgrades. */
const isCloudCable = (state: GameState, cable: Cable) => {
  const cloudId = state.devices.find((device) => device.kind === 'cloud')?.id
  return cable.from === cloudId || cable.to === cloudId
}

/** Cables (excluding the cloud uplink) below the given tier, eligible for a site upgrade. */
export function siteCableUpgradeTargets(state: GameState, target: CableTier): Cable[] {
  const targetIndex = CABLE_TIERS.findIndex((tier) => tier.name === target)
  return state.cables.filter(
    (cable) =>
      CABLE_TIERS.findIndex((tier) => tier.name === cable.tier) < targetIndex &&
      !isCloudCable(state, cable),
  )
}

/** Undiscounted price to bring every eligible cable up to `target`, every intervening tier included. */
export function siteCableUpgradeFullCost(state: GameState, target: CableTier): number {
  const targetIndex = CABLE_TIERS.findIndex((tier) => tier.name === target)
  return siteCableUpgradeTargets(state, target).reduce((total, cable) => {
    const fromIndex = CABLE_TIERS.findIndex((tier) => tier.name === cable.tier)
    const intervening = CABLE_TIERS.slice(fromIndex, targetIndex)
    return total + intervening.reduce((sum, tier) => sum + tier.cost, 0)
  }, 0)
}

/**
 * Applies a discounted bulk upgrade to every cable below `target`, paying for
 * every intervening tier per cable. Mirrors the native `upgradeAllCables`,
 * which exposes a 100 Mbps / 1 Gbps target picker; the cloud uplink is
 * excluded since its tier is fixed by the scenario.
 */
export function upgradeAllCables(state: GameState, target: CableTier): GameState {
  const targets = siteCableUpgradeTargets(state, target)
  const cost = discountedSiteCost(siteCableUpgradeFullCost(state, target))
  const targetTier = CABLE_TIERS.find((tier) => tier.name === target)!
  if (!targets.length || state.budget < cost)
    return {
      ...state,
      events: [
        event(
          state,
          targets.length
            ? 'Insufficient budget for site cable upgrade.'
            : `All connections already meet the ${target} standard.`,
        ),
        ...state.events,
      ].slice(0, 6),
    }
  const s = cloneState(state)
  const targetIds = new Set(targets.map((cable) => cable.id))
  s.cables
    .filter((cable) => targetIds.has(cable.id))
    .forEach((c) => {
      c.tier = targetTier.name
      c.capacity = targetTier.capacity
      c.upgradeSpend += Math.floor(cost / targets.length)
    })
  s.budget -= cost
  addEvent(s, `Site upgrade: ${targets.length} links moved to ${target}.`)
  return s
}
/** Applies the discounted two-port expansion to every router and switch. */
export function upgradeAllPorts(state: GameState): GameState {
  const targets = state.devices.filter((d) => ['router', 'switch'].includes(d.kind)),
    cost = discountedSiteCost(targets.length * 50)
  if (!targets.length || state.budget < cost)
    return {
      ...state,
      events: [event(state, 'Insufficient budget for site port expansion.'), ...state.events].slice(
        0,
        6,
      ),
    }
  const s = cloneState(state)
  s.devices
    .filter((d) => ['router', 'switch'].includes(d.kind))
    .forEach((d) => {
      d.maxPorts += 2
      d.upgradeSpend += Math.floor(cost / targets.length)
    })
  s.budget -= cost
  addEvent(s, 'Site upgrade: +2 ports on all network equipment.')
  return s
}

/** Applies the native 15%-discounted speed upgrade to every installed switch. */
export function upgradeAllSwitchSpeed(state: GameState): GameState {
  const switches = state.devices.filter((device) => device.kind === 'switch')
  const cost = discountedSiteCost(switches.length * 60)
  if (!switches.length || state.budget < cost) {
    return {
      ...state,
      events: [
        event(state, 'Insufficient budget for the site switch upgrade.'),
        ...state.events,
      ].slice(0, 6),
    }
  }
  const nextState = cloneState(state)
  nextState.devices
    .filter((device) => device.kind === 'switch')
    .forEach((networkSwitch) => {
      networkSwitch.pps += 4
      networkSwitch.upgradeSpend += Math.floor(cost / switches.length)
    })
  nextState.budget -= cost
  addEvent(nextState, `Site upgrade: faster forwarding on ${switches.length} switches.`)
  return nextState
}
/** Moves a device while clamping it inside the playable canvas. */
export function moveDevice(state: GameState, deviceId: string, x: number, y: number): GameState {
  const s = cloneState(state),
    d = s.devices.find((v) => v.id === deviceId)
  if (!d) return state
  d.x = Math.max(5, Math.min(95, x))
  d.y = Math.max(7, Math.min(94, y))
  return s
}
export const wifiInfo = (device: Device) =>
  device.kind === 'wireless' ? WIFI_STANDARDS[device.wifiLevel] : null
