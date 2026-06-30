export type DeviceKind =
  | 'cloud'
  | 'router'
  | 'switch'
  | 'pc'
  | 'tv'
  | 'console'
  | 'phone'
  | 'tablet'
  | 'server'
  | 'firewall'
  | 'wireless'
export type CableTier =
  | 'Copper'
  | 'Fast Ethernet'
  | 'Gigabit'
  | '5 Gigabit'
  | '10 Gigabit'
  | '25 Gigabit'
  | '50 Gigabit'
  | '100 Gigabit'
export type Priority = 'bulk' | 'stream' | 'realtime'

/** A node in the network topology. Coordinates are canvas percentages. */
export type Device = {
  id: string
  kind: DeviceKind
  label: string
  x: number
  y: number
  ports: number
  maxPorts: number
  health: number
  wear: number
  offline: boolean
  pps: number
  subnet: number
  wifiLevel: number
  upgradeSpend: number
  firewallRule: DeviceKind | null
  generated: number
  delivered: number
}

/** An undirected, capacity-limited edge in the network graph. */
export type Cable = {
  id: string
  from: string
  to: string
  tier: CableTier
  capacity: number
  load: number
  status: 'idle' | 'active' | 'congested' | 'failed'
  age: number
  vlan: number | null
  upgradeSpend: number
  failedTicks: number
}

/** A packet moving between adjacent devices along a precomputed route. */
export type Packet = {
  id: string
  path: string[]
  hop: number
  progress: number
  priority: Priority
  source: string
  generatedTick: number
}

/** Versioned, JSON-safe state persisted directly to browser localStorage. */
export type GameState = {
  version: 2
  phase: 'playing' | 'paused' | 'gameover'
  scenario: string
  tick: number
  score: number
  budget: number
  delivered: number
  dropped: number
  failure: number
  speed: number
  devices: Device[]
  cables: Cable[]
  packets: Packet[]
  events: string[]
  recentDrops: number[]
  multiplier: number
  combo: number
  cleanTicks: number
  rate: number
  spawned: number
  seed: number
  unscored: boolean
}

/** Scenario presentation plus its simulation pacing thresholds. */
export type Scenario = {
  id: string
  name: string
  eyebrow: string
  description: string
  difficulty: number
  budget: number
  equipmentFailure: boolean
  rampStart: number
  spawnStart: number
  gameOverCheck: number
}
