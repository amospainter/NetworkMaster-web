<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Activity,
  Cable as CableIcon,
  EthernetPort,
  Network,
  Trash2,
  Unplug,
  Wrench,
  X,
  Zap,
} from 'lucide-vue-next'
import { computeCableRoutes, pointAlongRoute, routeToSvgPath } from './cableGeometry'
import BuildPanel from './components/BuildPanel.vue'
import GameHud from './components/GameHud.vue'
import GameOverModal from './components/GameOverModal.vue'
import RunHistoryChart from './components/RunHistoryChart.vue'
import HoverTooltip from './components/HoverTooltip.vue'
import MenuScreen from './components/MenuScreen.vue'
import PacketLayer from './components/PacketLayer.vue'
import ScenarioBriefing from './components/ScenarioBriefing.vue'
import { useCanvasPanZoom } from './composables/useCanvasPanZoom'
import { LEADERBOARD_SIZE, useLeaderboard } from './composables/useLeaderboard'
import { useOfflineBlink } from './composables/useOfflineBlink'
import { useSimulationClock } from './composables/useSimulationClock'
import { TUTORIAL_STEPS, useTutorial } from './composables/useTutorial'
import { deviceIcons } from './deviceIcons'
import {
  acceptSlaContract,
  addCable,
  buildDevice,
  CABLE_TIERS,
  CACHE_HIT_CHANCE,
  CACHE_HIT_RATE_COST,
  CACHE_HIT_RATE_MAX,
  CACHE_HIT_RATE_STEP,
  cycleCableVlan,
  cycleQosBoost,
  declineSlaContract,
  deleteCable,
  deviceCapacity,
  deviceRemovalRefund,
  FORWARDING_KINDS,
  FORWARDING_SPEED_COSTS,
  FORWARDING_SPEED_GAIN,
  hubRange,
  independentPathCount,
  migrateSavedGame,
  moveDevice,
  newGame,
  OUTAGE_RADIUS,
  PEAK_PERIOD_TICKS,
  QOS_OVERHEAD,
  repairDevice,
  removeDevice,
  REPEATER_RANGE,
  rerouteCable,
  SALVAGE_RATE,
  SCENARIOS,
  servingWirelessHub,
  siteCableUpgradeFullCost,
  siteCableUpgradeTargets,
  toggleFirewallRule,
  upgradeAllCables,
  upgradeAllPorts,
  upgradeAllSwitchSpeed,
  upgradeCable,
  upgradeCacheHitRate,
  upgradeDevicePorts,
  upgradeDeviceSpeed,
  upgradeUps,
  upgradeWifi,
  UPS_COST,
  UPS_ELIGIBLE_KINDS,
  wifiInfo,
  WIRELESS_CAPABLE_KINDS,
} from './game'
import type { Cable, CableTier, Device, DeviceKind, GameState } from './types'

const ACTIVE_RUN_STORAGE_KEY = 'networkmaster.active-run.v1'
const HIGH_SCORE_STORAGE_KEY = 'networkmaster.best.v1'
const FIREWALL_BLOCK_TYPES: { kind: DeviceKind; label: string }[] = [
  { kind: 'pc', label: 'PCs' },
  { kind: 'tv', label: 'TVs' },
  { kind: 'console', label: 'Consoles' },
  { kind: 'phone', label: 'Phones' },
  { kind: 'tablet', label: 'Tablets' },
]

/** Friendly speed labels for the site cable-upgrade picker, keyed by cable tier. */
const TIER_SPEED_LABEL: Record<CableTier, string> = {
  Copper: '10 Mbps',
  'Fast Ethernet': '100 Mbps',
  Gigabit: '1 Gbps',
  '5 Gigabit': '5 Gbps',
  '10 Gigabit': '10 Gbps',
  '25 Gigabit': '25 Gbps',
  '50 Gigabit': '50 Gbps',
  '100 Gigabit': '100 Gbps',
}
/**
 * Presents a player-facing cable tier without changing persisted identifiers.
 *
 * @param tier - Persisted cable tier.
 * @returns Player-facing tier label.
 */
function cableTierLabel(tier: CableTier): string {
  return tier === 'Copper' ? 'Ethernet' : tier
}
/**
 * Presents a device kind as spaced, uppercase words for the inspector header
 * (e.g. `loadBalancer` -> `LOAD BALANCER`) instead of squishing multi-word
 * kinds together with a plain `.toUpperCase()`.
 *
 * @param kind - Persisted device kind.
 * @returns Player-facing, space-separated uppercase label.
 */
function deviceKindLabel(kind: DeviceKind): string {
  return kind.replace(/([A-Z])/g, ' $1').toUpperCase()
}
/**
 * Loads and migrates the active run from local storage.
 *
 * @returns A compatible game state, or `null` for missing/malformed saves.
 */
const loadSavedGame = () => {
  try {
    const savedGame = JSON.parse(localStorage.getItem(ACTIVE_RUN_STORAGE_KEY) || 'null') as
      (GameState & { version: number }) | null
    if (!savedGame) return null
    return migrateSavedGame(savedGame)
  } catch {
    return null
  }
}
const screen = ref<'menu' | 'game'>('menu')
const game = ref<GameState | null>(loadSavedGame())
const selected = ref<string | null>(null)
const cableStart = ref<string | null>(null)
const cableStyle = ref<'rightAngle' | 'diagonal'>('diagonal')
/** Set while rerouting an existing cable's endpoint; cleared once a target device is chosen. */
const reroutingCable = ref<{ cableId: string; movingFromEnd: boolean } | null>(null)
/** Armed build-panel tool; while set, canvas clicks stamp a new device at the cursor. */
const placingKind = ref<DeviceKind | null>(null)
/** Cursor position (canvas percent) for the placement ghost outline; null while off-canvas. */
const ghostPos = ref<{ x: number; y: number } | null>(null)
const mobileOverviewOpen = ref(false)
const canvasStageEl = ref<HTMLElement | null>(null)
const modal = ref<'help' | 'stats' | 'upgrades' | 'leaderboard' | null>(null)
const MODAL_TITLES: Record<'help' | 'stats' | 'upgrades' | 'leaderboard', string> = {
  help: 'How to play',
  upgrades: 'Site upgrades',
  stats: 'Run telemetry',
  leaderboard: 'Leaderboard',
}
const modalTitle = computed(() => (modal.value ? MODAL_TITLES[modal.value] : ''))
const inspectorTitle = computed(() => (picked.value ? 'Device inspector' : 'Connection'))
const HELP_SECTIONS = ['Basics', 'Devices & Wi-Fi', 'Scoring & economy', 'Survival'] as const
const helpSection = ref<(typeof HELP_SECTIONS)[number]>('Basics')
/** Target tier for the site-wide cable rollout picker; defaults to the cheapest upgrade. */
const cableUpgradeTarget = ref<CableTier>('Fast Ethernet')
const dark = ref(true)
const chosen = ref('home')
/** Menu-side sandbox toggle; consumed once by `start()` when launching a new run. */
const sandboxSelected = ref(false)
const best = ref(Number(localStorage.getItem(HIGH_SCORE_STORAGE_KEY) || 0))
const { leaderboard } = useLeaderboard(game)
const { tutorialStep, tutorialActive, dismissTutorial, advanceTutorial } = useTutorial()
const { offlineBlinkOn } = useOfflineBlink()
const picked = computed(() => game.value?.devices.find((device) => device.id === selected.value))
const pickedCable = computed(() =>
  game.value?.cables.find((networkCable) => networkCable.id === selected.value),
)
/** Cost to upgrade the selected cable to the next tier, if one exists. */
const cableUpgradeCost = computed(() => {
  const cable = pickedCable.value
  if (!cable) return 0
  return CABLE_TIERS[CABLE_TIERS.findIndex((t) => t.name === cable.tier)].cost
})
const cableSalvageValue = computed(() =>
  pickedCable.value ? Math.floor(pickedCable.value.upgradeSpend * SALVAGE_RATE) : 0,
)
const cableRoutes = computed(() =>
  game.value ? computeCableRoutes(game.value.devices, game.value.cables) : new Map(),
)
const wirelessConnections = computed(() => {
  if (!game.value) return []
  return game.value.devices
    .filter((device) => WIRELESS_CAPABLE_KINDS.includes(device.kind))
    .map((device) => ({ device, hub: servingWirelessHub(game.value!, device.id) }))
    .filter((connection) => connection.hub !== null)
})
/** All access points, shared by the Wi-Fi zone layer and minimap so both avoid re-filtering devices per render. */
const wirelessHubs = computed(() => game.value?.devices.filter((d) => d.kind === 'wireless') ?? [])
/** Online repeaters, rendered as a second, dashed coverage zone around each. */
const onlineRepeaters = computed(
  () => game.value?.devices.filter((d) => d.kind === 'repeater' && !d.offline) ?? [],
)
/** O(1) device lookup by id, shared by the minimap's per-cable endpoint resolution. */
const deviceById = computed(() => {
  const byId = new Map<string, Device>()
  for (const device of game.value?.devices ?? []) byId.set(device.id, device)
  return byId
})
/**
 * Serving access-point label per wireless-capable client, resolved once per
 * game-state change instead of once per template binding — the canvas badge
 * and inspector each read a client's label from two separate expressions.
 */
const wirelessHubLabelById = computed(() => {
  const labels = new Map<string, string>()
  const currentGame = game.value
  if (!currentGame) return labels
  for (const device of currentGame.devices) {
    if (!WIRELESS_CAPABLE_KINDS.includes(device.kind)) continue
    const hub = servingWirelessHub(currentGame, device.id)
    if (hub) labels.set(device.id, hub.label)
  }
  return labels
})
/**
 * Returns the label of the access point currently serving a client.
 *
 * @param deviceId - Client device identifier.
 * @returns Serving access-point label, or `null` when uncovered.
 */
function wirelessHubLabel(deviceId: string): string | null {
  return wirelessHubLabelById.value.get(deviceId) ?? null
}
/**
 * Calculates an access point's coverage-circle diameter.
 *
 * @param hub - Wireless access point.
 * @returns Diameter in normalized canvas units.
 */
function wifiZoneDiameter(hub: Device): number {
  return hubRange(hub) * 2
}
/**
 * Calculates a cache device's current hit chance from its upgrade level.
 *
 * @param cache - Cache device to inspect.
 * @returns Hit chance from 0 through `CACHE_HIT_RATE_MAX`.
 */
function cacheHitRate(cache: Device): number {
  return Math.min(CACHE_HIT_RATE_MAX, CACHE_HIT_CHANCE + cache.cacheLevel * CACHE_HIT_RATE_STEP)
}
/** Id of the switch currently targeted by an active DDoS event, if any. */
const ddosTargetId = computed(
  () => game.value?.activeEvents.find((e) => e.kind === 'ddos')?.targetId ?? null,
)
/** Active power-outage zones, positioned/sized for the canvas ring overlay. */
const outageZones = computed(
  () =>
    game.value?.activeEvents
      .filter((e) => e.kind === 'powerOutage' && e.centerX !== undefined && e.centerY !== undefined)
      .map((e) => ({
        id: e.id,
        centerX: e.centerX!,
        centerY: e.centerY!,
        diameter: OUTAGE_RADIUS * 2,
        ticksRemaining: e.ticksRemaining,
      })) ?? [],
)

/**
 * Counts packets waiting in a forwarding device's strict-priority queue.
 *
 * @param deviceId - Forwarding device identifier.
 * @returns Number of queued packets awaiting admission.
 */
function queueDepth(deviceId: string): number {
  if (!game.value) return 0
  return game.value.packets.filter((p) => p.queuedTicks > 0 && p.path[p.hop + 1] === deviceId)
    .length
}

const THROUGHPUT_KINDS: DeviceKind[] = ['router', 'switch', 'wireless', 'firewall', 'loadBalancer']

const SPEED_OPTIONS = [0.5, 1, 2, 3]
/**
 * Cycles simulation speed through the supported options.
 *
 * @returns Nothing; the current game speed is updated when a game exists.
 */
function cycleSpeed() {
  if (!game.value) return
  const next = SPEED_OPTIONS[(SPEED_OPTIONS.indexOf(game.value.speed) + 1) % SPEED_OPTIONS.length]
  game.value = { ...game.value, speed: next }
}

/**
 * Toggles between playing and paused.
 *
 * Replaces the game object rather than mutating `phase` in place so the
 * (shallow) persistence watcher below observes the change via reassignment.
 *
 * @returns Nothing; game state is replaced with a new object when a game exists.
 */
function togglePause() {
  if (!game.value) return
  game.value = { ...game.value, phase: game.value.phase === 'playing' ? 'paused' : 'playing' }
}

/**
 * Sums attached-cable load per device in a single pass over `game.cables`,
 * rather than the canvas/inspector re-filtering all cables per device shown.
 */
const deviceThroughputUsedById = computed(() => {
  const usage = new Map<string, number>()
  for (const networkCable of game.value?.cables ?? []) {
    usage.set(networkCable.from, (usage.get(networkCable.from) ?? 0) + networkCable.load)
    usage.set(networkCable.to, (usage.get(networkCable.to) ?? 0) + networkCable.load)
  }
  return usage
})
/**
 * Totals current traffic over a forwarding device's attached cables.
 *
 * @param device - Device whose attached link load should be measured.
 * @returns Aggregate packets per tick across attached cables.
 */
function deviceThroughputUsed(device: Device): number {
  return deviceThroughputUsedById.value.get(device.id) ?? 0
}

/** Throughput ratio per forwarding device, resolved once per game-state change. */
const throughputRatioById = computed(() => {
  const ratios = new Map<string, number>()
  for (const device of game.value?.devices ?? []) {
    if (!THROUGHPUT_KINDS.includes(device.kind)) continue
    ratios.set(
      device.id,
      (deviceThroughputUsedById.value.get(device.id) ?? 0) / deviceCapacity(device),
    )
  }
  return ratios
})
/**
 * Calculates the utilization ratio used by canvas and inspector throughput bars.
 *
 * @param device - Forwarding device to inspect.
 * @returns Load divided by effective capacity; may exceed one.
 */
function throughputRatio(device: Device): number {
  return throughputRatioById.value.get(device.id) ?? 0
}

const {
  canvasTransform,
  startCanvasPan,
  moveCanvasPan,
  endCanvasPan,
  zoomBy,
  handleCanvasWheel,
  resetView,
} = useCanvasPanZoom(cableStart, reroutingCable, placingKind)

/** A single contextual tip from "Jackie", the in-game advisor, prioritized by urgency. */
const advisorTip = computed(() => {
  const currentGame = game.value
  if (!currentGame) return ''
  if (currentGame.failure > 50)
    return 'Failure pressure is high — add capacity or reroute traffic before it tips over.'
  if (currentGame.cables.some((c) => c.status === 'congested'))
    return 'An orange link is over capacity. Upgrade it or build a parallel route to relieve it.'
  if (
    currentGame.devices.some(
      (d) =>
        WIRELESS_CAPABLE_KINDS.includes(d.kind) &&
        d.ports === 0 &&
        !servingWirelessHub(currentGame, d.id),
    )
  )
    return 'A device has no signal — move it into Wi-Fi range or run a cable to it.'
  if (currentGame.budget < 50)
    return 'Budget is tight. Bulk site upgrades save 15% over upgrading equipment one at a time.'
  if (currentGame.recentQueueDelayTicks > 2)
    return 'Packets are queuing at a forwarding device — boost its throughput or add a path around it.'
  if (currentGame.combo >= 3) return `Nice streak — a ${currentGame.combo}× combo is building.`
  const peakSwing = Math.sin((2 * Math.PI * currentGame.tick) / PEAK_PERIOD_TICKS)
  if (peakSwing > 0.3 && peakSwing < 0.95)
    return 'Demand is climbing toward its daily peak — make sure capacity is ahead of it.'
  return 'Network looks steady. Keep an eye on capacity as traffic ramps up.'
})

const { packetVisualProgress } = useSimulationClock(game, screen)

/**
 * Cancels an armed build tool when Escape is pressed.
 *
 * @param event - Window keyboard event.
 * @returns Nothing; placement state may be cleared.
 */
function handleEscapeKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && placingKind.value) cancelPlacing()
}
/**
 * Uses right-click as a build-tool cancellation gesture.
 *
 * @param event - Window context-menu event.
 * @returns Nothing; the browser menu is suppressed and placement may be cleared.
 */
function handleContextMenu(event: MouseEvent) {
  event.preventDefault()
  if (placingKind.value) cancelPlacing()
}
/**
 * Flushes any pending debounced save immediately.
 *
 * @returns Nothing; local storage is updated when a game exists.
 */
function flushActiveRunPersist() {
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer)
    persistTimer = undefined
  }
  if (game.value) localStorage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(game.value))
}
/**
 * Flushes a pending save when the tab is backgrounded, so a rapid sequence of
 * changes (e.g. a device drag) isn't lost if the page is closed mid-debounce.
 *
 * @returns Nothing; local storage may be updated.
 */
function handleVisibilityChange() {
  if (document.hidden) flushActiveRunPersist()
}
onMounted(() => {
  window.addEventListener('keydown', handleEscapeKey)
  window.addEventListener('contextmenu', handleContextMenu)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('pagehide', flushActiveRunPersist)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleEscapeKey)
  window.removeEventListener('contextmenu', handleContextMenu)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('pagehide', flushActiveRunPersist)
  flushActiveRunPersist()
})

const PERSIST_DEBOUNCE_MS = 400
let persistTimer: number | undefined
/**
 * Arms a trailing-debounced local storage write so a burst of rapid state
 * changes (dragging a device, a run of simulation ticks) collapses into one
 * write instead of one synchronous `JSON.stringify` + write per change.
 *
 * @returns Nothing; a pending write timer is (re)armed.
 */
function scheduleActiveRunPersist() {
  if (persistTimer !== undefined) clearTimeout(persistTimer)
  persistTimer = window.setTimeout(flushActiveRunPersist, PERSIST_DEBOUNCE_MS)
}

/**
 * Tracks the personal best immediately and persists the active run (debounced)
 * on every change. Every reducer replaces `game.value` wholesale, so a shallow
 * watch — rather than `deep: true` — is sufficient and avoids Vue re-traversing
 * the full state tree on every trigger.
 */
watch(game, (currentGame) => {
  if (!currentGame) return
  if (currentGame.mode !== 'sandbox' && currentGame.score > best.value) {
    best.value = currentGame.score
    localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(currentGame.score))
  }
  scheduleActiveRunPersist()
})

/**
 * Starts a fresh run and clears transient canvas selection.
 *
 * @param scenarioId - Scenario identifier to initialize.
 * @returns Nothing; reactive game and screen state are replaced.
 */
function start(scenarioId: string) {
  game.value = newGame(scenarioId, sandboxSelected.value ? 'sandbox' : 'normal')
  screen.value = 'game'
  selected.value = null
  canvasInteractionCount.value = 0
  briefingActive.value = true
}
/** Scenario metadata for the currently active run, if any. */
const activeScenario = computed(() => SCENARIOS.find((s) => s.id === game.value?.scenario))
/** Shown once per run start with that scenario's objective and first steps. */
const briefingActive = ref(false)
/**
 * Dismisses the start-of-run scenario briefing.
 *
 * @returns Nothing; briefing visibility state is cleared.
 */
function dismissBriefing() {
  briefingActive.value = false
}
const CANVAS_HINT_ACTIONS = 4
/** Counts canvas interactions so the idle "select a device" hint can fade out. */
const canvasInteractionCount = ref(0)
const canvasHintVisible = computed(() => canvasInteractionCount.value < CANVAS_HINT_ACTIONS)

/**
 * Resolves a device tap according to the active interaction mode.
 *
 * @param device - Device selected by the player.
 * @returns Nothing; topology or selection state may be updated.
 */
function selectDevice(device: Device) {
  if (!game.value) return
  canvasInteractionCount.value++
  if (reroutingCable.value) {
    game.value = rerouteCable(
      game.value,
      reroutingCable.value.cableId,
      reroutingCable.value.movingFromEnd,
      device.id,
    )
    selected.value = reroutingCable.value.cableId
    reroutingCable.value = null
    return
  }
  if (cableStart.value && cableStart.value !== device.id) {
    game.value = addCable(game.value, cableStart.value, device.id, cableStyle.value)
    cableStart.value = null
  }
  selected.value = device.id
}
/**
 * Starts drawing a new cable from a device, canceling any pending reroute.
 *
 * @param deviceId - Starting device identifier.
 * @returns Nothing; cabling interaction state is armed.
 */
function beginCable(deviceId: string) {
  reroutingCable.value = null
  cableStart.value = deviceId
}
/**
 * Begins rerouting one end of the selected cable on the next device pick.
 *
 * @param movingFromEnd - Whether the cable's `from` endpoint should move.
 * @returns Nothing; rerouting interaction state is armed when a cable is selected.
 */
function startReroute(movingFromEnd: boolean) {
  if (!pickedCable.value) return
  cableStart.value = null
  reroutingCable.value = { cableId: pickedCable.value.id, movingFromEnd }
}
/**
 * Closes the inspector and cancels any in-progress cable reroute.
 *
 * @returns Nothing; selection and reroute state are cleared.
 */
function closeInspector() {
  selected.value = null
  reroutingCable.value = null
}
/**
 * Replaces the reactive game snapshot with an engine operation result.
 *
 * @param next - Next immutable game snapshot.
 * @returns Nothing; reactive game state is replaced.
 */
function setGame(next: GameState) {
  game.value = next
}
/**
 * Arms or disarms the build-panel stamp tool.
 *
 * @param kind - Device kind selected in the build panel.
 * @returns Nothing; placement and ghost state are updated.
 */
function armBuildTool(kind: DeviceKind) {
  placingKind.value = placingKind.value === kind ? null : kind
  ghostPos.value = null
}
/**
 * Converts a pointer event to normalized coordinates within the transformed stage.
 *
 * @param event - Pointer event to project.
 * @returns Canvas coordinates, or `null` before the stage is mounted.
 */
function canvasPercentPosition(event: PointerEvent): { x: number; y: number } | null {
  const stage = canvasStageEl.value
  if (!stage) return null
  const stageBounds = stage.getBoundingClientRect()
  return {
    x: ((event.clientX - stageBounds.left) / stageBounds.width) * 100,
    y: ((event.clientY - stageBounds.top) / stageBounds.height) * 100,
  }
}
/**
 * Updates canvas panning and the armed placement ghost.
 *
 * @param event - Canvas pointer-move event.
 * @returns Nothing; pan and ghost state may be updated.
 */
function trackGhost(event: PointerEvent) {
  moveCanvasPan(event)
  if (placingKind.value) ghostPos.value = canvasPercentPosition(event)
}
/**
 * Stamps the armed build tool at the clicked canvas point.
 *
 * @param event - Canvas pointer event supplying placement coordinates.
 * @returns Nothing; game state may receive a newly built device.
 */
function placeArmedDevice(event: PointerEvent) {
  if (!game.value || !placingKind.value) return
  const position = canvasPercentPosition(event)
  if (!position) return
  canvasInteractionCount.value++
  game.value = buildDevice(game.value, placingKind.value, position.x, position.y)
}
/**
 * Clears placement state for keyboard, context-menu, and repeat-button cancellation.
 *
 * @returns Nothing; armed kind and ghost coordinates are cleared.
 */
function cancelPlacing() {
  placingKind.value = null
  ghostPos.value = null
}

/**
 * Removes the selected cable and closes its inspector.
 *
 * @returns Nothing; game and selection state are updated when a cable is selected.
 */
function deleteSelectedCable() {
  if (!game.value || !pickedCable.value) return
  game.value = deleteCable(game.value, pickedCable.value.id)
  selected.value = null
  reroutingCable.value = null
}

/**
 * Removes selected infrastructure and closes its inspector.
 *
 * @returns Nothing; game and selection state are updated when a device is selected.
 */
function removeSelectedDevice() {
  if (!game.value || !picked.value) return
  game.value = removeDevice(game.value, picked.value.id)
  selected.value = null
  reroutingCable.value = null
}

/**
 * Applies the site-wide discount to a full-price total for UI estimates.
 *
 * @param fullPrice - Undiscounted aggregate price.
 * @returns Discounted whole-dollar price.
 */
const siteDiscountedCost = (fullPrice: number) => Math.floor(fullPrice * 0.85)
/** Discounted cost of the site-wide cable rollout to the currently picked tier. */
const siteCableCost = computed(() =>
  game.value
    ? siteDiscountedCost(siteCableUpgradeFullCost(game.value, cableUpgradeTarget.value))
    : 0,
)
/** Discounted cost of the site-wide +2 ports upgrade across all routers/switches. */
const sitePortCost = computed(() =>
  game.value
    ? siteDiscountedCost(
        game.value.devices.filter((d) => ['router', 'switch'].includes(d.kind)).length * 50,
      )
    : 0,
)
/** Discounted cost of the site-wide switch throughput upgrade. */
const siteSwitchSpeedCost = computed(() =>
  game.value
    ? siteDiscountedCost(game.value.devices.filter((d) => d.kind === 'switch').length * 60)
    : 0,
)

/**
 * Resumes a failed topology without allowing additional leaderboard scoring.
 *
 * @returns Nothing; phase, score eligibility, and failure pressure are updated.
 */
function continueUnscored() {
  if (!game.value) return
  game.value = { ...game.value, phase: 'playing', unscored: true, failure: 0, recentDrops: [] }
}
/**
 * Returns the SVG path selected by the cable router.
 *
 * @param cableId - Cable whose route should be serialized.
 * @returns SVG path data, or an empty string when no route exists.
 */
function cablePath(cableId: string): string {
  const route = cableRoutes.value.get(cableId)
  return route ? routeToSvgPath(route) : ''
}

/**
 * Calculates the midpoint of a routed cable for its bandwidth label.
 *
 * @param cableId - Cable whose midpoint should be found.
 * @returns Normalized canvas position, or the origin when no route exists.
 */
function cableLabelPos(cableId: string): { x: number; y: number } {
  const route = cableRoutes.value.get(cableId)
  if (!route) return { x: 0, y: 0 }
  return pointAlongRoute(route.points, 0.5)
}

/** Hovered equipment/connection for the floating info tooltip; mutually exclusive. */
const hoveredDeviceId = ref<string | null>(null)
const hoveredCableId = ref<string | null>(null)
/** Fixed (viewport) pixel position for the tooltip, independent of canvas pan/zoom. */
const hoverPos = ref({ x: 0, y: 0 })

/** Tooltip content for the hovered device, or `null` when none is hovered. */
const hoverDeviceInfo = computed(() => {
  const device = game.value?.devices.find((candidate) => candidate.id === hoveredDeviceId.value)
  if (!device) return null
  const used = deviceThroughputUsedById.value.get(device.id) ?? 0
  const capacity = deviceCapacity(device)
  return {
    title: device.label,
    rows: [
      { label: 'Status', value: device.offline ? 'Offline' : 'Online' },
      { label: 'Ports', value: `${device.ports} / ${device.maxPorts}` },
      { label: 'Health / wear', value: `${device.health}% / ${device.wear}` },
      {
        label: 'Throughput',
        value: capacity > 100 ? 'No limit' : `${used} / ${capacity} pkt/tick`,
      },
    ],
  }
})
/** Tooltip content for the hovered cable, or `null` when none is hovered. */
const hoverCableInfo = computed(() => {
  const cable = game.value?.cables.find((candidate) => candidate.id === hoveredCableId.value)
  if (!cable) return null
  const from = deviceById.value.get(cable.from)
  const to = deviceById.value.get(cable.to)
  return {
    title: `${from?.label ?? '?'} ↔ ${to?.label ?? '?'}`,
    rows: [
      { label: 'Tier', value: cableTierLabel(cable.tier) },
      { label: 'Status', value: cable.status },
      { label: 'Age', value: `${cable.age} ticks` },
    ],
  }
})
/** The single active tooltip payload, if any device or cable is currently hovered. */
const hoverInfo = computed(() => hoverDeviceInfo.value ?? hoverCableInfo.value)

/**
 * Clears any active hover tooltip.
 *
 * @returns Nothing; hovered device/cable state is cleared.
 */
function hideTooltip() {
  hoveredDeviceId.value = null
  hoveredCableId.value = null
}
/**
 * Arms the device tooltip, anchored above the hovered device's own screen position.
 *
 * @param event - Device pointer-enter event.
 * @param device - Device being hovered.
 * @returns Nothing; hover and tooltip-position state are updated.
 */
function showDeviceTooltip(event: PointerEvent, device: Device) {
  hoveredCableId.value = null
  hoveredDeviceId.value = device.id
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  hoverPos.value = { x: rect.left + rect.width / 2, y: rect.top }
}
/**
 * Arms the cable tooltip at the pointer's current position.
 *
 * @param event - Cable pointer-enter or pointer-move event.
 * @param cable - Cable being hovered.
 * @returns Nothing; hover and tooltip-position state are updated.
 */
function showCableTooltip(event: PointerEvent, cable: Cable) {
  hoveredDeviceId.value = null
  hoveredCableId.value = cable.id
  hoverPos.value = { x: event.clientX, y: event.clientY }
}
/**
 * Follows the pointer while a cable tooltip is active.
 *
 * @param event - Cable pointer-move event.
 * @returns Nothing; tooltip position is updated when a cable is hovered.
 */
function trackCableTooltip(event: PointerEvent) {
  if (!hoveredCableId.value) return
  hoverPos.value = { x: event.clientX, y: event.clientY }
}

let activeDrag: { id: string; startX: number; startY: number; moved: boolean } | null = null
/**
 * Captures a device pointer unless another active tool owns the gesture.
 *
 * @param event - Device pointer-down event.
 * @param device - Device targeted by the pointer.
 * @returns Nothing; drag state and pointer capture may be initialized.
 */
function startDeviceDrag(event: PointerEvent, device: Device) {
  if (cableStart.value || placingKind.value) return
  event.stopPropagation() // don't also start a background canvas pan
  hideTooltip()
  activeDrag = { id: device.id, startX: event.clientX, startY: event.clientY, moved: false }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
/**
 * Moves a captured device after a threshold separates drags from selection taps.
 *
 * @param event - Device pointer-move event.
 * @returns Nothing; game state may receive updated device coordinates.
 */
function moveDraggedDevice(event: PointerEvent) {
  if (!activeDrag || !game.value) return
  const canvas = (event.currentTarget as HTMLElement).parentElement
  if (!canvas) return
  const canvasBounds = canvas.getBoundingClientRect()
  const horizontalMovement = event.clientX - activeDrag.startX
  const verticalMovement = event.clientY - activeDrag.startY
  if (Math.hypot(horizontalMovement, verticalMovement) < 5 && !activeDrag.moved) return
  activeDrag.moved = true
  game.value = moveDevice(
    game.value,
    activeDrag.id,
    ((event.clientX - canvasBounds.left) / canvasBounds.width) * 100,
    ((event.clientY - canvasBounds.top) / canvasBounds.height) * 100,
  )
}
/**
 * Completes a drag or delegates to normal selection when the pointer did not move.
 *
 * @param event - Device pointer-up event.
 * @param device - Device targeted by the completed gesture.
 * @returns Nothing; drag and selection state are updated.
 */
function finishDeviceDrag(event: PointerEvent, device: Device) {
  const moved = activeDrag?.moved
  activeDrag = null
  if (moved) {
    event.preventDefault()
    canvasInteractionCount.value++
    selected.value = device.id
  } else selectDevice(device)
}
</script>

<template>
  <main class="app" :class="{ dark }">
    <MenuScreen
      v-if="screen === 'menu'"
      v-model:chosen="chosen"
      v-model:dark="dark"
      v-model:sandbox="sandboxSelected"
      :game="game"
      :best="best"
      @start="start"
      @continue-game="screen = 'game'"
      @open-leaderboard="modal = 'leaderboard'"
    />
    <div v-else-if="game" class="game-shell">
      <GameHud
        v-model:dark="dark"
        :game="game"
        @open-upgrades="modal = 'upgrades'"
        @open-help="modal = 'help'"
        @exit-to-menu="screen = 'menu'"
        @toggle-pause="togglePause"
        @open-leaderboard="modal = 'leaderboard'"
        @accept-sla="setGame(acceptSlaContract(game!))"
        @decline-sla="setGame(declineSlaContract(game!))"
      />
      <div class="workspace" :class="{ 'inspector-open': picked || pickedCable }">
        <BuildPanel
          :budget="game.mode === 'sandbox' ? Infinity : game.budget"
          :active-kind="placingKind"
          @select="armBuildTool"
        />
        <div
          class="canvas"
          :class="{ placing: placingKind }"
          @wheel="handleCanvasWheel"
          @pointerdown="startCanvasPan"
          @pointermove="trackGhost"
          @pointerup="endCanvasPan"
          @pointercancel="endCanvasPan"
          @pointerleave="ghostPos = null"
          @click="placeArmedDevice"
        >
          <div ref="canvasStageEl" class="canvas-stage" :style="{ transform: canvasTransform }">
            <svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none">
              <g
                v-for="c in game.cables"
                :key="c.id"
                @pointerdown.stop
                @click="!placingKind && (selected = c.id)"
                @pointerenter="showCableTooltip($event, c)"
                @pointermove="trackCableTooltip"
                @pointerleave="hideTooltip"
              >
                <path class="link-hit" :d="cablePath(c.id)" />
                <path :class="[c.status, { selected: selected === c.id }]" :d="cablePath(c.id)" />
              </g>
              <line
                v-for="connection in wirelessConnections"
                :key="'wifi-link-' + connection.device.id"
                class="wireless-link"
                :x1="connection.device.x"
                :y1="connection.device.y"
                :x2="connection.hub!.x"
                :y2="connection.hub!.y"
              />
            </svg>
            <div
              v-for="c in game.cables"
              :key="'bandwidth-' + c.id"
              class="cable-label"
              :class="c.status"
              :style="{ left: cableLabelPos(c.id).x + '%', top: cableLabelPos(c.id).y + '%' }"
            >
              <b>{{ cableTierLabel(c.tier) }}</b
              ><span>{{ c.load }}/{{ c.capacity }} pkt</span>
            </div>
            <div
              v-for="hub in wirelessHubs"
              :key="'zone-' + hub.id"
              class="wifi-zone"
              :class="{ interfered: hub.interference > 0 }"
              :style="{
                left: hub.x + '%',
                top: hub.y + '%',
                width: wifiZoneDiameter(hub) + '%',
                height: wifiZoneDiameter(hub) + '%',
              }"
            >
              <span>{{
                hub.interference > 0
                  ? `${wifiInfo(hub)!.name} · INTERFERED (${hub.interference}t)`
                  : wifiInfo(hub)!.name
              }}</span>
            </div>
            <div
              v-for="repeater in onlineRepeaters"
              :key="'repeater-zone-' + repeater.id"
              class="wifi-zone repeater-zone"
              :style="{
                left: repeater.x + '%',
                top: repeater.y + '%',
                width: REPEATER_RANGE * 2 + '%',
                height: REPEATER_RANGE * 2 + '%',
              }"
            >
              <span>Repeater zone</span>
            </div>
            <div
              v-for="outage in outageZones"
              :key="'outage-' + outage.id"
              class="outage-zone"
              :style="{
                left: outage.centerX + '%',
                top: outage.centerY + '%',
                width: outage.diameter + '%',
                height: outage.diameter + '%',
              }"
            >
              <span>OUTAGE · {{ outage.ticksRemaining }}t</span>
            </div>
            <button
              v-for="d in game.devices"
              :key="d.id"
              class="device"
              :class="[
                d.kind,
                { selected: selected === d.id, cabling: cableStart === d.id, offline: d.offline },
              ]"
              :style="{ left: d.x + '%', top: d.y + '%' }"
              :aria-label="`${d.label}, ${d.kind}, ${d.offline ? 'offline, ' : ''}${d.ports} of ${d.maxPorts} ports`"
              @pointerdown="startDeviceDrag($event, d)"
              @pointermove="moveDraggedDevice"
              @pointerup="finishDeviceDrag($event, d)"
              @pointerenter="showDeviceTooltip($event, d)"
              @pointerleave="hideTooltip"
              @click.prevent
            >
              <span
                ><component :is="deviceIcons[d.kind]" v-if="!d.offline || offlineBlinkOn" /><Unplug
                  v-else
                  class="icon-unplugged"
              /></span>
              <b>{{ d.label }}</b
              ><small v-if="ddosTargetId === d.id" class="attack-badge">ATTACK</small
              ><small
                v-if="WIRELESS_CAPABLE_KINDS.includes(d.kind) && d.ports === 0"
                class="wifi-badge"
                :class="{ 'out-of-range': !wirelessHubLabel(d.id) }"
              >
                {{ wirelessHubLabel(d.id) ? 'WI-FI · ' + wirelessHubLabel(d.id) : 'OUT OF RANGE' }}
              </small>
              <small v-else-if="d.kind !== 'cloud'">{{ d.ports }}/{{ d.maxPorts }} PORTS</small>
              <div v-if="THROUGHPUT_KINDS.includes(d.kind)" class="throughput-bar">
                <i
                  :class="{
                    warn: throughputRatio(d) >= 0.5 && throughputRatio(d) < 0.85,
                    over: throughputRatio(d) >= 0.85,
                  }"
                  :style="{ width: Math.min(100, throughputRatio(d) * 100) + '%' }"
                />
              </div>
            </button>
            <PacketLayer
              :packets="game.packets"
              :devices="game.devices"
              :cables="game.cables"
              :cable-routes="cableRoutes"
              :packet-visual-progress="packetVisualProgress"
            />
            <div
              v-if="placingKind && ghostPos"
              class="device ghost-device"
              :class="placingKind"
              :style="{ left: ghostPos.x + '%', top: ghostPos.y + '%' }"
            >
              <span><component :is="deviceIcons[placingKind]" /></span>
            </div>
          </div>
          <HoverTooltip
            v-if="hoverInfo"
            :x="hoverPos.x"
            :y="hoverPos.y"
            :title="hoverInfo.title"
            :rows="hoverInfo.rows"
          />
          <div v-if="cableStart || canvasHintVisible" class="canvas-note">
            <CableIcon />{{
              cableStart ? 'Choose a destination device' : 'Select a device to inspect or connect'
            }}
          </div>
          <div class="advisor-tip"><EthernetPort />Jackie: {{ advisorTip }}</div>
          <div class="mobile-canvas-controls" @pointerdown.stop>
            <button aria-label="Zoom in" @click="zoomBy(0.2)">+</button>
            <button aria-label="Zoom out" @click="zoomBy(-0.2)">−</button>
            <button aria-label="Reset view" @click="resetView">Reset</button>
            <button
              aria-label="Toggle network overview"
              :aria-pressed="mobileOverviewOpen"
              @click="mobileOverviewOpen = !mobileOverviewOpen"
            >
              Map
            </button>
          </div>
          <div class="minimap" :class="{ 'mobile-open': mobileOverviewOpen }" @pointerdown.stop>
            <div class="panel-title">
              <span>Overview</span>
              <div class="zoom-controls">
                <button aria-label="Zoom in" @click="zoomBy(0.2)">+</button
                ><button aria-label="Zoom out" @click="zoomBy(-0.2)">−</button
                ><button aria-label="Reset view" @click="resetView">Reset</button>
              </div>
            </div>
            <svg class="minimap-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <circle
                v-for="hub in wirelessHubs"
                :key="'mini-zone-' + hub.id"
                :cx="hub.x"
                :cy="hub.y"
                :r="hubRange(hub)"
                class="minimap-wifi"
                :class="{ interfered: hub.interference > 0 }"
              />
              <line
                v-for="c in game.cables"
                :key="'mini-' + c.id"
                :x1="deviceById.get(c.from)?.x"
                :y1="deviceById.get(c.from)?.y"
                :x2="deviceById.get(c.to)?.x"
                :y2="deviceById.get(c.to)?.y"
              />
              <rect
                v-for="d in game.devices"
                :key="'mini-' + d.id"
                :x="d.x - 2.2"
                :y="d.y - 2.2"
                width="4.4"
                height="4.4"
                rx="1.2"
                :class="{ offline: d.offline }"
              />
            </svg>
          </div>
          <div v-if="tutorialActive && !briefingActive" class="tutorial-card" @pointerdown.stop>
            <p class="overline">
              QUICK START · STEP {{ tutorialStep + 1 }} / {{ TUTORIAL_STEPS.length }}
            </p>
            <p>{{ TUTORIAL_STEPS[tutorialStep] }}</p>
            <div class="tutorial-actions">
              <button @click="dismissTutorial">Skip</button
              ><button class="primary" @click="advanceTutorial">
                {{ tutorialStep >= TUTORIAL_STEPS.length - 1 ? 'Got it' : 'Next' }}
              </button>
            </div>
          </div>
        </div>
        <aside v-if="picked || pickedCable" class="inspector">
          <div class="modal-titlebar">
            <span>{{ inspectorTitle }}</span
            ><button class="close" @click="closeInspector"><X /></button>
          </div>
          <div class="inspector-body">
            <template v-if="picked"
              ><div class="inspect-head">
                <span><component :is="deviceIcons[picked.kind]" /></span>
                <div>
                  <h2>{{ picked.label }}</h2>
                  <p>{{ deviceKindLabel(picked.kind) }} · SUBNET {{ picked.subnet }}</p>
                </div>
              </div>
              <div class="stat">
                <span>Status</span
                ><b :class="{ 'danger-text': picked.offline }">{{
                  picked.offline ? 'Offline' : 'Online'
                }}</b>
              </div>
              <div class="stat">
                <span>Ports</span><b>{{ picked.ports }} / {{ picked.maxPorts }}</b>
              </div>
              <div class="stat">
                <span>Health / wear</span><b>{{ picked.health }}% / {{ picked.wear }}</b>
              </div>
              <div class="stat">
                <span>Throughput</span
                ><b
                  >{{ picked.pps > 100 ? 'No limit' : picked.pps + ' pkt/tick'
                  }}{{ picked.qosBoost ? ` (−${Math.round(QOS_OVERHEAD * 100)}% QoS)` : '' }}</b
                >
              </div>
              <div
                v-if="THROUGHPUT_KINDS.includes(picked.kind)"
                class="pressure inspector-pressure"
              >
                <span
                  >Current load
                  <b
                    >{{ deviceThroughputUsed(picked) }} / {{ deviceCapacity(picked) }} pkt/tick</b
                  ></span
                >
                <div>
                  <i
                    :class="{
                      warn: throughputRatio(picked) >= 0.5 && throughputRatio(picked) < 0.85,
                      over: throughputRatio(picked) >= 0.85,
                    }"
                    :style="{ width: Math.min(100, throughputRatio(picked) * 100) + '%' }"
                  />
                </div>
              </div>
              <div v-if="WIRELESS_CAPABLE_KINDS.includes(picked.kind)" class="stat">
                <span>Delivered</span><b>{{ picked.delivered }} / {{ picked.generated }}</b>
              </div>
              <div v-if="WIRELESS_CAPABLE_KINDS.includes(picked.kind)" class="stat">
                <span>Wireless link</span
                ><b :class="{ 'danger-text': picked.ports === 0 && !wirelessHubLabel(picked.id) }">
                  {{ wirelessHubLabel(picked.id) ?? 'Out of range' }}
                </b>
              </div>
              <div v-if="!['cloud', 'router'].includes(picked.kind)" class="stat">
                <span>Independent paths</span
                ><b>{{
                  independentPathCount(
                    game!,
                    picked.id,
                    game!.devices.find((d) => d.kind === 'cloud')!.id,
                  )
                }}</b>
              </div>
              <div v-if="picked.kind === 'wireless'" class="stat">
                <span>Wi-Fi</span
                ><b>{{ wifiInfo(picked)!.name }} · {{ wifiInfo(picked)!.pps }} pkt</b>
              </div>
              <div v-if="picked.kind === 'wireless' && picked.interference > 0" class="stat">
                <span>Status</span
                ><b class="danger-text"
                  >Interfered — range &amp; speed cut ({{ picked.interference }}t left)</b
                >
              </div>
              <div v-if="picked.kind === 'cache'" class="stat">
                <span>Hit rate</span><b>{{ Math.round(cacheHitRate(picked) * 100) }}%</b>
              </div>
              <div v-if="picked.kind === 'cache'" class="stat">
                <span>Hits served</span><b>{{ picked.delivered }}</b>
              </div>
              <div
                v-if="['router', 'switch', 'wireless', 'firewall'].includes(picked.kind)"
                class="stat"
              >
                <span>Queue</span
                ><b :class="{ 'danger-text': queueDepth(picked.id) > 0 }"
                  >{{ queueDepth(picked.id) }} waiting</b
                >
              </div>
              <div v-if="FORWARDING_KINDS.includes(picked.kind)" class="device-upgrades">
                <button @click="setGame(cycleQosBoost(game!, picked!.id))">
                  QoS boost: {{ picked.qosBoost ?? 'none' }}
                </button>
              </div>
              <div v-if="picked.kind === 'firewall'" class="device-upgrades">
                <fieldset class="firewall-rules">
                  <legend>Block traffic from</legend>
                  <label v-for="option in FIREWALL_BLOCK_TYPES" :key="option.kind">
                    <input
                      type="checkbox"
                      :checked="picked.firewallRules.includes(option.kind)"
                      @change="setGame(toggleFirewallRule(game!, picked!.id, option.kind))"
                    />
                    {{ option.label }}
                  </label>
                </fieldset>
              </div>
              <div v-if="['router', 'switch'].includes(picked.kind)" class="device-upgrades">
                <button
                  :disabled="game.budget < 50"
                  @click="setGame(upgradeDevicePorts(game!, picked!.id))"
                >
                  +2 Ports <b :class="{ 'danger-text': game.budget < 50 }">$50</b></button
                ><button
                  :disabled="game.budget < FORWARDING_SPEED_COSTS[picked.kind]!"
                  @click="setGame(upgradeDeviceSpeed(game!, picked!.id))"
                >
                  Throughput +{{ FORWARDING_SPEED_GAIN[picked.kind] }} pkt/tick
                  <b :class="{ 'danger-text': game.budget < FORWARDING_SPEED_COSTS[picked.kind]! }"
                    >${{ FORWARDING_SPEED_COSTS[picked.kind] }}</b
                  >
                </button>
              </div>
              <div v-if="picked.kind === 'wireless'" class="device-upgrades">
                <button
                  :disabled="wifiInfo(picked)!.cost >= 999 || game.budget < wifiInfo(picked)!.cost"
                  @click="setGame(upgradeWifi(game!, picked!.id))"
                >
                  Upgrade Wi-Fi
                  <b
                    :class="{
                      'danger-text':
                        wifiInfo(picked)!.cost < 999 && game.budget < wifiInfo(picked)!.cost,
                    }"
                    >{{ wifiInfo(picked)!.cost >= 999 ? 'MAX' : '$' + wifiInfo(picked)!.cost }}</b
                  >
                </button>
                <button
                  :disabled="game.budget < FORWARDING_SPEED_COSTS[picked.kind]!"
                  @click="setGame(upgradeDeviceSpeed(game!, picked!.id))"
                >
                  Throughput +{{ FORWARDING_SPEED_GAIN[picked.kind] }} pkt/tick
                  <b :class="{ 'danger-text': game.budget < FORWARDING_SPEED_COSTS[picked.kind]! }"
                    >${{ FORWARDING_SPEED_COSTS[picked.kind] }}</b
                  >
                </button>
              </div>
              <div v-if="picked.kind === 'loadBalancer'" class="device-upgrades">
                <button
                  :disabled="game.budget < FORWARDING_SPEED_COSTS[picked.kind]!"
                  @click="setGame(upgradeDeviceSpeed(game!, picked!.id))"
                >
                  Throughput +{{ FORWARDING_SPEED_GAIN[picked.kind] }} pkt/tick
                  <b :class="{ 'danger-text': game.budget < FORWARDING_SPEED_COSTS[picked.kind]! }"
                    >${{ FORWARDING_SPEED_COSTS[picked.kind] }}</b
                  >
                </button>
              </div>
              <div v-if="picked.kind === 'cache'" class="device-upgrades">
                <button
                  :disabled="
                    cacheHitRate(picked) >= CACHE_HIT_RATE_MAX || game.budget < CACHE_HIT_RATE_COST
                  "
                  @click="setGame(upgradeCacheHitRate(game!, picked!.id))"
                >
                  Hit rate +10%
                  <b
                    :class="{
                      'danger-text':
                        cacheHitRate(picked) < CACHE_HIT_RATE_MAX &&
                        game.budget < CACHE_HIT_RATE_COST,
                    }"
                    >{{
                      cacheHitRate(picked) >= CACHE_HIT_RATE_MAX ? 'MAX' : `$${CACHE_HIT_RATE_COST}`
                    }}</b
                  >
                </button>
              </div>
              <div v-if="UPS_ELIGIBLE_KINDS.includes(picked.kind)" class="device-upgrades">
                <button v-if="picked.ups" disabled class="ups-active"><Zap /> UPS installed</button>
                <button
                  v-else
                  :disabled="game.budget < UPS_COST"
                  @click="setGame(upgradeUps(game!, picked!.id))"
                >
                  <Zap /> Install UPS · outage-proof
                  <b :class="{ 'danger-text': game.budget < UPS_COST }">${{ UPS_COST }}</b>
                </button>
              </div>
              <button
                v-if="picked.health < 100"
                class="wide"
                :disabled="game.budget < 40"
                @click="setGame(repairDevice(game!, picked!.id))"
              >
                <Wrench /> Field repair ·
                <span :class="{ 'danger-text': game.budget < 40 }">$40</span></button
              ><button
                v-if="!['cloud', 'phone', 'tablet'].includes(picked.kind)"
                class="primary wide"
                @click="beginCable(picked.id)"
              >
                <CableIcon />{{ cableStart === picked.id ? 'Choose destination…' : 'Begin cable' }}
              </button>
              <button
                v-if="cableStart === picked.id"
                class="wide"
                @click="cableStyle = cableStyle === 'rightAngle' ? 'diagonal' : 'rightAngle'"
              >
                Style ·
                <b>{{ cableStyle === 'rightAngle' ? 'Right-angle' : 'Diagonal' }}</b>
              </button>
              <button
                v-if="deviceRemovalRefund(picked) > 0"
                class="wide danger-action"
                @click="removeSelectedDevice"
              >
                <Trash2 /> Remove equipment · +${{ deviceRemovalRefund(picked) }}
              </button>
              <p class="hint">
                Drag this device to rearrange the diagram. Wireless-only clients join automatically
                inside a Wi-Fi zone.
              </p></template
            ><template v-else-if="pickedCable"
              ><h2>
                {{ game.devices.find((d) => d.id === pickedCable!.from)?.label }} ↔
                {{ game.devices.find((d) => d.id === pickedCable!.to)?.label }}
              </h2>
              <div class="stat">
                <span>Tier</span><b>{{ cableTierLabel(pickedCable.tier) }}</b>
              </div>
              <div class="stat">
                <span>Traffic</span><b>{{ pickedCable.load }} / {{ pickedCable.capacity }} pkt</b>
              </div>
              <div class="stat">
                <span>Status</span><b>{{ pickedCable.status }}</b>
              </div>
              <div class="stat">
                <span>Age</span><b>{{ pickedCable.age }} ticks</b>
              </div>
              <div class="stat">
                <span>Style</span
                ><b>{{ pickedCable.style === 'diagonal' ? 'Diagonal' : 'Right-angle' }}</b>
              </div>
              <button class="wide" @click="setGame(cycleCableVlan(game!, pickedCable!.id))">
                VLAN · {{ pickedCable.vlan ?? 'Untagged' }}
              </button>
              <button
                v-if="
                  CABLE_TIERS.findIndex((t) => t.name === pickedCable!.tier) <
                  CABLE_TIERS.length - 1
                "
                class="primary wide"
                :disabled="game.budget < cableUpgradeCost"
                @click="setGame(upgradeCable(game!, pickedCable!.id))"
              >
                <Zap /> Upgrade ·
                <span :class="{ 'danger-text': game.budget < cableUpgradeCost }"
                  >${{ cableUpgradeCost }}</span
                ></button
              ><button
                class="wide"
                :class="{ primary: reroutingCable?.movingFromEnd === true }"
                @click="startReroute(true)"
              >
                <span class="icon-badge"><CableIcon /><i>A</i></span
                >{{
                  reroutingCable?.movingFromEnd === true
                    ? 'Choose new start…'
                    : `Reroute start (${game.devices.find((d) => d.id === pickedCable!.from)?.label})`
                }}</button
              ><button
                class="wide"
                :class="{ primary: reroutingCable?.movingFromEnd === false }"
                @click="startReroute(false)"
              >
                <span class="icon-badge"><CableIcon /><i>Z</i></span
                >{{
                  reroutingCable?.movingFromEnd === false
                    ? 'Choose new end…'
                    : `Reroute end (${game.devices.find((d) => d.id === pickedCable!.to)?.label})`
                }}</button
              ><button class="wide danger-action" @click="deleteSelectedCable">
                <Trash2 /> Delete · salvage ${{ cableSalvageValue }}
              </button></template
            >
          </div>
        </aside>
        <div class="events">
          <div><Activity /> LIVE EVENTS</div>
          <p v-for="(e, i) in game.events.slice(0, 3)" :key="i">
            <span>{{ String(e.tick).padStart(3, '0') }}</span
            >{{ e.text }}
          </p>
        </div>
        <div class="legend">
          <span><i class="ok" />Active</span><span><i />Idle</span
          ><span><i class="warn" />Congested</span>
        </div>
      </div>
      <footer>
        <span
          ><i :class="{ 'warn-dot': game.failure > 30 }" /> NET:
          {{ game.failure > 70 ? 'CRITICAL' : game.failure > 30 ? 'STRESSED' : 'HEALTHY' }}</span
        ><span
          >Tick {{ game.tick }} · Load {{ game.rate.toFixed(2) }}× ·
          {{ game.devices.length }} devices</span
        ><button @click="cycleSpeed">{{ game.speed }}× SPEED</button
        ><button @click="modal = 'stats'">RUN STATS</button>
      </footer>
    </div>
    <ScenarioBriefing
      v-if="briefingActive && activeScenario"
      :scenario="activeScenario"
      @dismiss="dismissBriefing"
    />
    <GameOverModal
      v-if="game?.phase === 'gameover'"
      :game="game"
      @try-again="start"
      @continue-unscored="continueUnscored"
      @open-leaderboard="modal = 'leaderboard'"
      @main-menu="screen = 'menu'"
    />
    <div v-if="modal" class="modal-backdrop" @mousedown.self="modal = null">
      <div class="modal">
        <div class="modal-titlebar">
          <span>{{ modalTitle }}</span
          ><button class="close" @click="modal = null"><X /></button>
        </div>
        <div class="modal-body">
          <template v-if="modal === 'help'"
            ><p class="overline">HOW TO PLAY</p>
            <h1>Route every packet.</h1>
            <a class="full-howto-link" href="/howtoplay.html" target="_blank" rel="noopener">
              Full HOWTO Play guide ↗
            </a>
            <div class="help-tabs">
              <button
                v-for="section in HELP_SECTIONS"
                :key="section"
                :class="{ primary: helpSection === section }"
                @click="helpSection = section"
              >
                {{ section }}
              </button>
            </div>
            <div v-if="helpSection === 'Basics'">
              <ol>
                <li>
                  Pick equipment from the <b>BUILD</b> panel to arm it, then click the canvas to
                  place it — the tool stays armed for placing several; click it again or press
                  <b>Esc</b> to put it away.
                </li>
                <li>Select equipment and choose <b>Begin cable</b>, then tap its destination.</li>
                <li>
                  Toggle <b>Style</b> (Right-angle / Diagonal) before choosing a destination if the
                  auto-router gets crowded.
                </li>
                <li>
                  Select an existing cable and use <b>Reroute start/end</b> to move an endpoint
                  without losing its tier, VLAN, or upgrades.
                </li>
                <li>Drag any device to reposition it — useful for shifting Wi-Fi coverage.</li>
                <li>
                  Pan by dragging empty canvas; zoom with a scroll wheel, pinch gesture, or the +/−
                  buttons.
                </li>
                <li>
                  Only the <b>router</b> may connect to the Cloud Edge, and two end devices can
                  never link directly — equipment must sit between them.
                </li>
              </ol>
            </div>
            <div v-else-if="helpSection === 'Devices & Wi-Fi'">
              <ol>
                <li>
                  Phones and tablets are <b>Wi-Fi only</b>. PCs, TVs, and consoles keep a wired port
                  but can also join Wi-Fi coverage as a backup route.
                </li>
                <li>
                  A client in range of two overlapping access points prefers whichever has fewer
                  clients right now, not just the nearest one.
                </li>
                <li>
                  Access points have one wired uplink port, plus two independent upgrades: Wi-Fi
                  generation (range + base speed) and Faster forwarding (+2 pkt/tick, stacks on
                  top).
                </li>
                <li>
                  Forwarding devices admit realtime traffic first, then stream, then bulk — a
                  congested router drops bulk packets before it touches a phone's.
                </li>
                <li>
                  Wi-Fi interference can randomly cut an access point's range and speed for 8–18
                  ticks; it clears on its own.
                </li>
                <li>
                  Equipment can wear down and fail outright in harder scenarios — an offline device
                  blinks on the canvas. Field repair ($40) restores health but not wear.
                </li>
                <li>
                  A <b>Honeypot</b> ($70) does nothing until a DDoS attack starts, then lures a
                  share of the junk traffic away from its real target and absorbs it.
                </li>
                <li>
                  A UPS ($45) makes eligible infrastructure immune to power-outage events — install
                  it from that device's inspector.
                </li>
                <li>
                  A <b>Cache</b> ($130) serves bulk/stream traffic on its own subnet locally instead
                  of round-tripping to the Cloud Edge — a 35% base hit chance, upgradeable to 55%.
                  Realtime traffic and other subnets are unaffected.
                </li>
                <li>
                  A <b>Repeater</b> ($50) must sit inside a live access point's coverage; it then
                  extends that hub's Wi-Fi zone with a second one of its own, at the cost of a small
                  extra queue delay for clients it serves.
                </li>
                <li>
                  Any router, switch, wireless access point, firewall, or load balancer can set a
                  free <b>QoS boost</b> from its inspector: cycle none → realtime → stream → bulk →
                  none. A boosted class sorts above everything else on arrival at that device, at
                  the cost of 10% less effective throughput while a boost is set.
                </li>
              </ol>
            </div>
            <div v-else-if="helpSection === 'Scoring & economy'">
              <ol>
                <li>
                  Delivering a packet scores <b>10 × score multiplier × combo</b>; the multiplier
                  rises every 90 ticks.
                </li>
                <li>
                  5 clean ticks in a row (no drops) raises your combo up to 5×; 3+ drops in one tick
                  resets it.
                </li>
                <li>
                  A delivery with a genuine second independent route to its destination scores +5
                  bonus — redundancy pays.
                </li>
                <li>
                  Delivery milestones and a game-over network-health bonus (surviving devices ×
                  lifetime delivery ratio) add extra score/budget on top.
                </li>
                <li>
                  Removing equipment or a cable refunds 90% of what you spent on it, including
                  upgrades.
                </li>
                <li>
                  <b>Site Upgrades</b> (top bar) bulk-upgrade cable tiers, ports, or throughput
                  across the whole network for 15% less than one at a time.
                </li>
                <li>
                  ISP Hub and Data Center pay <b>metered income</b> instead of a flat allocation:
                  every 15 ticks you're paid per packet delivered in that window (realtime pays
                  most, then stream, then bulk), capped at 3× the flat rate it replaces.
                </li>
                <li>
                  Starting once challenge events do, an <b>SLA contract</b> is offered every 120
                  ticks (top bar chip, one at a time): accept within 10 ticks or it auto-declines. A
                  latency contract pays out if you hold below its target for the full 50-tick
                  window, but fails immediately after 5 consecutive over-target ticks. A delivery
                  contract pays out as soon as you hit its packet count. Either way, failure costs
                  score (2× the reward), not budget — a real stake either direction.
                </li>
              </ol>
            </div>
            <div v-else>
              <ol>
                <li>
                  Orange links are over capacity — upgrade the cable or add a parallel route before
                  it fails.
                </li>
                <li>
                  Failure pressure is the share of packets dropped across the last 20 ticks; the run
                  ends once it's sustained above 30 drops past the scenario's early grace period.
                </li>
                <li>
                  Challenge events roll periodically: traffic spikes, budget bonuses, device surges,
                  and — in harder scenarios — outright equipment failure, DDoS attacks, and power
                  outages (the latter two only once a run has settled in).
                </li>
                <li>
                  A <b>DDoS attack</b> floods a target switch's subnet with junk traffic for several
                  ticks — it congests links and can displace real packets, but the junk itself never
                  scores or drops against you. Any firewall along the way absorbs junk
                  automatically; a Honeypot lures some of it away entirely.
                </li>
                <li>
                  A <b>power outage</b> knocks every unprotected device in a zone offline for a
                  while — a UPS-equipped device rides it out unaffected.
                </li>
                <li>
                  Demand follows a slow "peak hours" cycle on top of the traffic ramp — expect a
                  gentle daily swing between busier and quieter stretches once warmup ends.
                </li>
                <li>
                  At game over you can <b>Try again</b> or <b>Continue unscored</b> to keep playing
                  without further leaderboard scoring.
                </li>
                <li>
                  <b>Sandbox mode</b> (menu checkbox) removes budget limits and game over entirely
                  for free-form topology experimentation — sandbox runs are unscored and never touch
                  your leaderboard or personal best.
                </li>
                <li>
                  Watch <b>Jackie</b> (bottom of the canvas) — it always surfaces the single most
                  urgent thing to fix right now.
                </li>
                <li>Every completed run is saved to your local Leaderboard, win or lose.</li>
                <li>
                  <b>Run Stats</b> (bottom bar) includes a score/failure-pressure/latency history
                  chart for the current run, also shown on the game-over screen.
                </li>
              </ol>
            </div></template
          ><template v-else-if="modal === 'upgrades'"
            ><p class="overline">SITE UPGRADES</p>
            <h1>Upgrade the whole network.</h1>
            <p>Bulk upgrades cost less per component and apply instantly.</p>
            <div class="upgrade-list">
              <div class="upgrade-picker">
                <label for="cable-upgrade-target"><CableIcon /> Connection rollout target</label>
                <select id="cable-upgrade-target" v-model="cableUpgradeTarget">
                  <option v-for="tier in CABLE_TIERS.slice(1)" :key="tier.name" :value="tier.name">
                    {{ tier.name }} · {{ TIER_SPEED_LABEL[tier.name] }}
                  </option>
                </select>
              </div>
              <button
                :disabled="game.budget < siteCableCost"
                @click="setGame(upgradeAllCables(game!, cableUpgradeTarget))"
              >
                <span
                  ><CableIcon /><b>Upgrade to {{ cableUpgradeTarget }}</b
                  ><small>
                    {{ siteCableUpgradeTargets(game!, cableUpgradeTarget).length }} link(s) below
                    {{ TIER_SPEED_LABEL[cableUpgradeTarget] }}</small
                  ></span
                ><strong :class="{ 'danger-text': game.budget < siteCableCost }"
                  >${{ siteCableCost }}</strong
                >
              </button>
              <button
                :disabled="game.budget < sitePortCost"
                @click="setGame(upgradeAllPorts(game!))"
              >
                <span
                  ><Network /><b>Port expansion</b
                  ><small>Add 2 ports to every router and switch</small></span
                ><strong :class="{ 'danger-text': game.budget < sitePortCost }"
                  >${{ sitePortCost }}</strong
                >
              </button>
              <button
                :disabled="game.budget < siteSwitchSpeedCost"
                @click="setGame(upgradeAllSwitchSpeed(game!))"
              >
                <span
                  ><Zap /><b>Switch throughput</b><small>+4 pkt/tick on every switch</small></span
                ><strong :class="{ 'danger-text': game.budget < siteSwitchSpeedCost }"
                  >${{ siteSwitchSpeedCost }}</strong
                >
              </button>
            </div></template
          ><template v-else-if="modal === 'stats'"
            ><p class="overline">RUN TELEMETRY</p>
            <h1>{{ game?.delivered }} packets delivered</h1>
            <div class="stat">
              <span>Score / multiplier</span
              ><b>{{ game?.score.toLocaleString() }} · {{ game?.multiplier }}×</b>
            </div>
            <div class="stat">
              <span>Delivered / dropped</span><b>{{ game?.delivered }} / {{ game?.dropped }}</b>
            </div>
            <div class="stat">
              <span>Clean combo</span><b>{{ game?.combo }}×</b>
            </div>
            <div class="stat">
              <span>Recent drop window</span
              ><b>{{ game?.recentDrops.reduce((a, b) => a + b, 0) }} / 30</b>
            </div>
            <div class="stat">
              <span>Traffic ramp</span><b>{{ game?.rate.toFixed(2) }}×</b>
            </div>
            <div class="stat">
              <span>Avg. delivery latency</span
              ><b>{{ game?.recentLatencyTicks.toFixed(1) }} ticks</b>
            </div>
            <div class="stat">
              <span>Avg. queue delay</span><b>{{ game?.recentQueueDelayTicks.toFixed(1) }} ticks</b>
            </div>
            <RunHistoryChart v-if="game && game.history.length > 1" :history="game.history" />
            <button class="wide" @click="modal = 'leaderboard'">View leaderboard</button></template
          ><template v-else-if="modal === 'leaderboard'"
            ><p class="overline">PERSONAL LEADERBOARD</p>
            <h1>Top {{ LEADERBOARD_SIZE }} runs</h1>
            <p v-if="!leaderboard.length" class="hint">
              No completed runs yet. Finish a network to set your first score.
            </p>
            <ol v-else class="leaderboard-list">
              <li v-for="(entry, i) in leaderboard" :key="entry.id">
                <span class="rank">#{{ i + 1 }}</span>
                <span class="leaderboard-meta">
                  <b>{{ entry.score.toLocaleString() }}</b>
                  <small
                    >{{ SCENARIOS.find((s) => s.id === entry.scenario)?.name ?? entry.scenario }} ·
                    {{ entry.delivered }} delivered · {{ entry.tick }} ticks ·
                    {{ new Date(entry.completedAt).toLocaleDateString() }}</small
                  >
                </span>
              </li>
            </ol></template
          >
        </div>
      </div>
    </div>
  </main>
</template>
