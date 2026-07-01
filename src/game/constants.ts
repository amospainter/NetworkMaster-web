import type { CableTier, DeviceKind, Priority, Scenario } from '../types'

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
export const WIFI_STANDARDS = [
  { range: 14, pps: 4, cost: 40, name: '802.11b' },
  { range: 18, pps: 8, cost: 60, name: '802.11g' },
  { range: 22, pps: 14, cost: 90, name: '802.11n' },
  { range: 26, pps: 22, cost: 130, name: 'Wi-Fi 5' },
  { range: 30, pps: 32, cost: 180, name: 'Wi-Fi 6' },
  { range: 34, pps: 44, cost: 240, name: 'Wi-Fi 6E' },
  { range: 40, pps: 60, cost: 999, name: 'Wi-Fi 7' },
]
export const SOURCE_SPAWN_ORDER: DeviceKind[] = ['pc', 'phone', 'console', 'tablet', 'tv']
/** Matches the native `wifiInterferenceRangeFactor`/`wifiInterferenceThroughputFactor`. */
export const WIFI_INTERFERENCE_RANGE_FACTOR = 0.6
export const WIFI_INTERFERENCE_PPS_FACTOR = 0.5
/** Higher weight forwards first under strict-priority admission. */
export const PRIORITY_WEIGHT: Record<Priority, number> = { realtime: 2, stream: 1, bulk: 0 }
/** A packet held at a forwarding device's queue longer than this is dropped. */
export const QUEUE_CAPACITY_TICKS = 6
export const FORWARDING_KINDS: DeviceKind[] = ['router', 'switch', 'wireless', 'firewall']
/**
 * End-user devices that can join an access point's coverage. Phones and
 * tablets have no wired ports and are Wi-Fi only; pc/tv/console additionally
 * keep their wired ports, so a cable and Wi-Fi coverage both count as valid
 * connectivity for them.
 */
export const WIRELESS_CAPABLE_KINDS: DeviceKind[] = ['pc', 'tv', 'console', 'phone', 'tablet']
export const WIRELESS_ONLY_KINDS: DeviceKind[] = ['phone', 'tablet']

export const DEVICE_RULES: Record<
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
  wireless: { ports: 1, pps: 4, priority: 'bulk', rate: 0 },
}

/**
 * Per-scenario delivery-count milestones and their one-time budget awards,
 * mirroring the native `checkMilestones`. Rewards scale with scenario difficulty.
 */
export const MILESTONES: Record<string, { at: number; award: number }[]> = {
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

export const costs: Partial<Record<DeviceKind, number>> = {
  switch: 80,
  router: 140,
  wireless: 90,
  server: 120,
  firewall: 110,
}

export const SALVAGE_RATE = 0.9
export const SITE_UPGRADE_DISCOUNT = 0.15

export const FORWARDING_SPEED_COSTS: Partial<Record<DeviceKind, number>> = {
  router: 90,
  switch: 60,
  wireless: 50,
}
export const FORWARDING_SPEED_GAIN: Partial<Record<DeviceKind, number>> = {
  router: 8,
  switch: 4,
  wireless: 2,
}
