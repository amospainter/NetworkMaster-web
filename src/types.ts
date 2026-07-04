/** Stable identifiers for every topology node supported by simulation and UI layers. */
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
  | 'loadBalancer'

/**
 * Persisted cable upgrade identifiers, ordered separately by `CABLE_TIERS`.
 * `Copper` is the legacy save value presented to players as “Ethernet”.
 */
export type CableTier =
  | 'Copper'
  | 'Fast Ethernet'
  | 'Gigabit'
  | '5 Gigabit'
  | '10 Gigabit'
  | '25 Gigabit'
  | '50 Gigabit'
  | '100 Gigabit'

/** Packet service class; forwarding devices admit realtime before stream, then bulk. */
export type Priority = 'bulk' | 'stream' | 'realtime'
/** Right-angle cables route through the orthogonal lane planner; diagonal cables draw a direct line. */
export type CableStyle = 'rightAngle' | 'diagonal'

/** A node in the network topology. Coordinates are canvas percentages. */
export type Device = {
  id: string
  kind: DeviceKind
  label: string
  x: number
  y: number
  /** Occupied physical ports; wireless associations do not consume these. */
  ports: number
  maxPorts: number
  health: number
  wear: number
  offline: boolean
  pps: number
  /** Logical broadcast domain used when choosing cross-subnet destinations. */
  subnet: number
  /** Index into `WIFI_STANDARDS`, or -1 for devices that are not access points. */
  wifiLevel: number
  /** Upgrade dollars eligible for salvage when the device is removed. */
  upgradeSpend: number
  firewallRule: DeviceKind | null
  generated: number
  delivered: number
  /** Ticks remaining of Wi-Fi interference (wireless access points only); shrinks range/throughput. */
  interference: number
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
  /** Upgrade dollars eligible for salvage; base cable cost is refunded separately. */
  upgradeSpend: number
  /** Automatic outage countdown caused by sustained congestion. */
  failedTicks: number
  style: CableStyle
}

/** Kinds of timed challenge event the simulation can roll, mirroring the native roster. */
export type ChallengeEventKind = 'trafficSpike' | 'budgetBonus' | 'deviceSurge' | 'equipmentFailure'

/** A timed challenge event; only `trafficSpike` lingers across ticks via `ticksRemaining`. */
export type ActiveEvent = {
  id: string
  kind: ChallengeEventKind
  ticksRemaining: number
  targetId: string | null
}

/** A live-feed entry, stamped with the tick it happened on rather than inferred from list position. */
export type GameEvent = {
  tick: number
  text: string
}

/** A packet moving between adjacent devices along a precomputed route. */
export type Packet = {
  id: string
  path: string[]
  /** Index of the device the packet most recently reached within `path`. */
  hop: number
  /** Normalized progress along the cable from `path[hop]` to the next device. */
  progress: number
  priority: Priority
  /** Device whose demand created this traffic, even when a response travels back from its peer. */
  owner?: string
  /** Actual endpoint at the beginning of `path`. */
  source: string
  generatedTick: number
  /** Ticks this packet has spent waiting in a forwarding device's queue. */
  queuedTicks: number
}

/** Versioned, JSON-safe state persisted directly to browser localStorage. */
export type GameState = {
  /** Save-schema discriminator. Increment when migrations require a new persisted shape. */
  version: 8
  phase: 'playing' | 'paused' | 'gameover'
  scenario: string
  tick: number
  score: number
  budget: number
  delivered: number
  dropped: number
  failure: number
  /** User-selected simulation multiplier; affects wall-clock cadence, not game rules. */
  speed: number
  devices: Device[]
  cables: Cable[]
  packets: Packet[]
  events: GameEvent[]
  /** Per-tick drop counts forming the rolling failure-pressure window. */
  recentDrops: number[]
  multiplier: number
  combo: number
  cleanTicks: number
  rate: number
  /** Number of dynamically introduced clients, used to continue the spawn rotation. */
  spawned: number
  /** Reserved deterministic seed retained for save compatibility. */
  seed: number
  /** Continued game-over runs remain playable but no longer qualify for scores. */
  unscored: boolean
  /** Delivery-count milestones already awarded, so each pays out only once. */
  milestonesReached: number[]
  /** Timed challenge events currently in effect (e.g. an active traffic spike). */
  activeEvents: ActiveEvent[]
  /** Rolling end-to-end delivery latency in ticks (generation to arrival at the cloud/destination), weighted 75/25 toward history like the native HUD. */
  recentLatencyTicks: number
  /** Rolling per-packet queue delay in ticks accrued waiting at forwarding-device queues, same 75/25 weighting. */
  recentQueueDelayTicks: number
}

/** A completed run recorded for the local, score-sorted leaderboard. */
export type LeaderboardEntry = {
  id: string
  scenario: string
  score: number
  delivered: number
  tick: number
  completedAt: number
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
  /** Tick at which timed challenge events begin rolling. */
  challengeStart: number
  /** Starting traffic fraction at tick 0 (0 = silent, 1 = full base rate). */
  warmupFloor: number
  /** Tick at which traffic eases up to 100% of the base rate. */
  warmupTicks: number
  /** One or two sentences framing this scenario's premise and goal, shown in the start-of-run briefing. */
  objective: string
  /** Concrete first actions for this scenario's actual starting topology, shown in the start-of-run briefing. */
  firstSteps: string[]
}
