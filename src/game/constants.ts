import type { CableTier, DeviceKind, Priority, Scenario } from '../types'

/** Scenario catalog and pacing configuration, in menu display order. */
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
    objective:
      'Get every device online and delivering packets to the Cloud Edge before rising demand outpaces your capacity.',
    firstSteps: [
      'Select PC-1, choose Begin cable, then tap the Router to wire them together.',
      'Do the same for Smart TV and Console.',
      'Watch the canvas — an orange link is over capacity and needs an upgrade or a parallel route.',
    ],
  },
  {
    id: 'cafe',
    name: 'Café Hotspot',
    eyebrow: 'PUBLIC WI-FI',
    description: 'A coffee-shop counter and a crowd of phones on one hotspot.',
    difficulty: 2,
    budget: 130,
    equipmentFailure: false,
    rampStart: 150,
    spawnStart: 140,
    gameOverCheck: 75,
    challengeStart: 150,
    warmupFloor: 0.25,
    warmupTicks: 150,
    objective:
      'A wired counter and a growing crowd of phones and tablets all lean on a single access point. Keep everyone connected as the café fills up.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      "Phone and Tablet already sit inside WiFi-B's coverage — no cable needed for those.",
      'If the hotspot gets crowded, build a second access point to spread the wireless load.',
    ],
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
    objective:
      'Two subnets share one router. Wire in the wired desks and keep pace as new hires (and their devices) keep arriving.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      "Phone and Tablet already sit inside WiFi-B's coverage — no cable needed for those.",
      'Build more equipment as budget allows; new devices join automatically over time.',
    ],
  },
  {
    id: 'school',
    name: 'School Lab',
    eyebrow: 'ONE CLASS AT A TIME',
    description: 'A wired computer lab across three classrooms and a server.',
    difficulty: 3,
    budget: 190,
    equipmentFailure: false,
    rampStart: 100,
    spawnStart: 110,
    gameOverCheck: 55,
    challengeStart: 110,
    warmupFloor: 0.4,
    warmupTicks: 100,
    objective:
      'Three classroom subnets share a single router and a file server. Nothing fails here — the challenge is simply keeping every wired seat fed as classes fill up.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      "SW-C (the third classroom) starts unconnected — build a device there when you're ready.",
      'Switches cap at 8 pkt/tick — upgrade throughput or add a parallel switch before they choke.',
    ],
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
    objective:
      'A dual-router core already splits outbound traffic across two Cloud uplinks. Extend that same resilience out to every subnet.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      "SW-C (the third subnet) starts unconnected — build a device there when you're ready.",
      'Equipment wears down here — watch health and budget for field repairs.',
    ],
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
    objective:
      'Switches sit far apart across campus. A second Cloud path already exists through the dual-router core — build toward that same redundancy for your own links.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      'Long cable runs cost more to upgrade — plan tiers before you commit budget.',
      "SW-C (the third subnet) starts unconnected — build a device there when you're ready.",
    ],
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
    objective:
      'No firewall, no spare budget. Every port and every backup link you build here has to earn its place.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      "There's no firewall to start — budget for one later if a device kind starts causing trouble.",
      'Site Upgrades (top bar) save 15% over upgrading equipment one at a time — spend carefully.',
    ],
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
    objective:
      'A wireless crowd is about to flood your one access point. Keep coverage strong and get ahead of it before it saturates.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      "Phone and Tablet already sit inside WiFi-B's coverage — watch its load as more wireless devices join.",
      'A second access point spreads out wireless load once one hub gets crowded.',
    ],
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
    objective:
      'Router and Router-B each carry their own 10 Gigabit Cloud uplink through the Load Balancer. Traffic ramps fast — build ahead of it.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      'Watch link load closely; the high-volume ramp here outpaces the other scenarios.',
      'A Load Balancer throughput upgrade goes a long way before things get busy.',
    ],
  },
  {
    id: 'datacenter',
    name: 'Data Center',
    eyebrow: 'EAST-WEST TRAFFIC',
    description: 'Server-to-server traffic across a load-balanced core.',
    difficulty: 5,
    // Tighter budget and an earlier, steeper ramp than Edge Exchange (same
    // difficulty tier) so the two diff-5 scenarios don't play identically:
    // Data Center is a fast, sustained-volume squeeze on a lean budget, not
    // a per-packet priority puzzle.
    budget: 240,
    equipmentFailure: true,
    rampStart: 50,
    spawnStart: 65,
    gameOverCheck: 42,
    challengeStart: 65,
    warmupFloor: 0.6,
    warmupTicks: 50,
    objective:
      'Two servers on different subnets trade heavy east-west traffic across a dual-router core. Keep the load balancer and both uplinks ahead of a fast, relentless ramp.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      'Both servers are cross-subnet traffic magnets — watch the links between the switches and the core.',
      'Upgrade the Load Balancer early; it carries every path between subnets.',
    ],
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
    objective:
      'Realtime traffic (phones, consoles) needs to win priority over bulk traffic at every hop, or it queues up and starts dropping.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      "Check a forwarding device's Queue stat in its inspector — a growing queue means it needs more throughput.",
      "SW-C (the third subnet) starts unconnected — build a device there when you're ready.",
    ],
  },
  {
    id: 'smartcity',
    name: 'Smart City',
    eyebrow: 'EVERYTHING, EVERYWHERE',
    description: 'Wired subnets, wireless crowds, and no room for error.',
    difficulty: 5,
    budget: 280,
    equipmentFailure: true,
    rampStart: 55,
    spawnStart: 70,
    gameOverCheck: 38,
    challengeStart: 70,
    warmupFloor: 0.55,
    warmupTicks: 55,
    objective:
      'Wired offices, a wireless crowd, a firewall, and a dual-router core all at once — under the fastest ramp in the game. Everything you have learned, applied at speed.',
    firstSteps: [
      'Cable Desk-A1 into SW-A.',
      'Traffic ramps almost immediately here — build capacity before the warm-up ends.',
      'Redundancy is survival: extend the dual-router resilience out to every subnet.',
    ],
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
/** Repeating client sequence used when scenarios add devices during a run. */
export const SOURCE_SPAWN_ORDER: DeviceKind[] = ['pc', 'phone', 'console', 'tablet', 'tv']
/** Multipliers applied to an access point while interference is active. */
export const WIFI_INTERFERENCE_RANGE_FACTOR = 0.6
/** Throughput multiplier applied to an access point while interference is active. */
export const WIFI_INTERFERENCE_PPS_FACTOR = 0.5
/** Higher weight forwards first under strict-priority admission. */
export const PRIORITY_WEIGHT: Record<Priority, number> = { realtime: 2, stream: 1, bulk: 0 }
/** A packet held at a forwarding device's queue longer than this is dropped. */
export const QUEUE_CAPACITY_TICKS = 6
/** Infrastructure nodes whose incoming packets are subject to PPS admission limits. */
export const FORWARDING_KINDS: DeviceKind[] = [
  'router',
  'switch',
  'wireless',
  'firewall',
  'loadBalancer',
]
/**
 * End-user devices that can join an access point's coverage. Phones and
 * tablets have no wired ports and are Wi-Fi only; pc/tv/console additionally
 * keep their wired ports, so a cable and Wi-Fi coverage both count as valid
 * connectivity for them.
 */
export const WIRELESS_CAPABLE_KINDS: DeviceKind[] = ['pc', 'tv', 'console', 'phone', 'tablet']
/** Clients that cannot be attached by cable because their physical port count is zero. */
export const WIRELESS_ONLY_KINDS: DeviceKind[] = ['phone', 'tablet']

/** Base hardware capabilities and traffic behavior for each device kind. */
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
  loadBalancer: { ports: 4, pps: 24, priority: 'bulk', rate: 0 },
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
  cafe: [
    { at: 35, award: 50 },
    { at: 110, award: 100 },
    { at: 220, award: 200 },
  ],
  startup: [
    { at: 40, award: 50 },
    { at: 120, award: 100 },
    { at: 240, award: 200 },
  ],
  school: [
    { at: 70, award: 75 },
    { at: 200, award: 150 },
    { at: 400, award: 300 },
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
  datacenter: [
    { at: 160, award: 150 },
    { at: 460, award: 300 },
    { at: 920, award: 600 },
  ],
  smartcity: [
    { at: 180, award: 175 },
    { at: 520, award: 350 },
    { at: 1000, award: 700 },
  ],
  branch: [
    { at: 90, award: 100 },
    { at: 270, award: 200 },
    { at: 540, award: 400 },
  ],
}

/** Purchase prices for player-buildable infrastructure; absent kinds cannot be built. */
export const costs: Partial<Record<DeviceKind, number>> = {
  switch: 80,
  router: 140,
  wireless: 90,
  server: 120,
  firewall: 110,
  loadBalancer: 150,
}

/** Fraction of eligible investment returned when equipment or links are removed. */
export const SALVAGE_RATE = 0.9
/** Discount applied once to the aggregate price of a site-wide upgrade. */
export const SITE_UPGRADE_DISCOUNT = 0.15

/** Per-device price of one forwarding-throughput upgrade. */
export const FORWARDING_SPEED_COSTS: Partial<Record<DeviceKind, number>> = {
  router: 90,
  switch: 60,
  wireless: 50,
  loadBalancer: 100,
}
/** PPS gained from one forwarding-throughput upgrade. */
export const FORWARDING_SPEED_GAIN: Partial<Record<DeviceKind, number>> = {
  router: 8,
  switch: 4,
  wireless: 2,
  loadBalancer: 10,
}
