<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Activity,
  Cable as CableIcon,
  CirclePause,
  CirclePlay,
  Cloud,
  EthernetPort,
  Gamepad2,
  HelpCircle,
  Monitor,
  Moon,
  Network,
  Plus,
  Radio,
  RotateCcw,
  Server,
  Shield,
  Smartphone,
  Sun,
  Tablet,
  Trash2,
  Tv,
  Unplug,
  Wifi,
  Wrench,
  X,
  Zap,
} from 'lucide-vue-next'
import { computeCableRoutes, pointAlongRoute, routeToSvgPath } from './cableGeometry'
import {
  addCable,
  buildDevice,
  CABLE_TIERS,
  cycleCableVlan,
  cycleFirewallRule,
  deleteCable,
  deviceCapacity,
  deviceRemovalRefund,
  hubRange,
  independentPathCount,
  migrateSavedGame,
  moveDevice,
  newGame,
  repairDevice,
  removeDevice,
  rerouteCable,
  SCENARIOS,
  servingWirelessHub,
  simulate,
  siteCableUpgradeFullCost,
  siteCableUpgradeTargets,
  upgradeAllCables,
  upgradeAllPorts,
  upgradeAllSwitchSpeed,
  upgradeCable,
  upgradeDevicePorts,
  upgradeDeviceSpeed,
  upgradeWifi,
  wifiInfo,
  WIRELESS_CAPABLE_KINDS,
} from './game'
import type { Device, DeviceKind, GameState, LeaderboardEntry } from './types'

const ACTIVE_RUN_STORAGE_KEY = 'networkmaster.active-run.v1'
const HIGH_SCORE_STORAGE_KEY = 'networkmaster.best.v1'
const LEADERBOARD_STORAGE_KEY = 'networkmaster.leaderboard.v1'
const TUTORIAL_SEEN_KEY = 'networkmaster.tutorial-seen.v1'
const LEADERBOARD_SIZE = 10

const deviceIcons = {
  cloud: Cloud,
  router: Radio,
  switch: Network,
  pc: Monitor,
  tv: Tv,
  console: Gamepad2,
  phone: Smartphone,
  tablet: Tablet,
  server: Server,
  firewall: Shield,
  wireless: Wifi,
}
const BUILD_OPTIONS: [DeviceKind, string, number][] = [
  ['switch', 'Switch', 80],
  ['router', 'Router', 140],
  ['wireless', 'Wireless', 90],
  ['firewall', 'Firewall', 110],
  ['server', 'Server', 120],
]
/** Loads only the current save schema; incompatible prototypes start cleanly. */
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
/** Loads the personal leaderboard; malformed or missing storage starts empty. */
const loadLeaderboard = (): LeaderboardEntry[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(LEADERBOARD_STORAGE_KEY) || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}
const screen = ref<'menu' | 'game'>('menu')
const game = ref<GameState | null>(loadSavedGame())
const selected = ref<string | null>(null)
const cableStart = ref<string | null>(null)
const cableStyle = ref<'rightAngle' | 'diagonal'>('rightAngle')
/** Set while rerouting an existing cable's endpoint; cleared once a target device is chosen. */
const reroutingCable = ref<{ cableId: string; movingFromEnd: boolean } | null>(null)
const modal = ref<'help' | 'stats' | 'upgrades' | 'leaderboard' | null>(null)
const dark = ref(true)
const chosen = ref('home')
const best = ref(Number(localStorage.getItem(HIGH_SCORE_STORAGE_KEY) || 0))
const leaderboard = ref<LeaderboardEntry[]>(loadLeaderboard())
const picked = computed(() => game.value?.devices.find((device) => device.id === selected.value))
const pickedCable = computed(() =>
  game.value?.cables.find((networkCable) => networkCable.id === selected.value),
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

function wirelessHubLabel(deviceId: string): string | null {
  return game.value ? (servingWirelessHub(game.value, deviceId)?.label ?? null) : null
}
/** Coverage circle diameter as a canvas percentage, shrunk while interfered. */
function wifiZoneDiameter(hub: Device): number {
  return hubRange(hub) * 2
}

/** Packets currently waiting in a forwarding device's strict-priority queue. */
function queueDepth(deviceId: string): number {
  if (!game.value) return 0
  return game.value.packets.filter((p) => p.queuedTicks > 0 && p.path[p.hop + 1] === deviceId)
    .length
}

const THROUGHPUT_KINDS: DeviceKind[] = ['router', 'switch', 'wireless', 'firewall']

/** Current packets-per-tick flowing over a forwarding device's attached cables. */
function deviceThroughputUsed(device: Device): number {
  if (!game.value) return 0
  return game.value.cables
    .filter((c) => c.from === device.id || c.to === device.id)
    .reduce((total, c) => total + c.load, 0)
}

/** Throughput fill ratio (0-1, can exceed 1 when over capacity) for the canvas/inspector bar. */
function throughputRatio(device: Device): number {
  return deviceThroughputUsed(device) / deviceCapacity(device)
}

const ZOOM_MIN = 0.6
const ZOOM_MAX = 2.5
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const canvasTransform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
)
let activePan: { startX: number; startY: number; originX: number; originY: number } | null = null

/** Starts a background drag-to-pan; ignored while drawing/rerouting a cable. */
function startCanvasPan(event: PointerEvent) {
  if (cableStart.value || reroutingCable.value) return
  activePan = {
    startX: event.clientX,
    startY: event.clientY,
    originX: panX.value,
    originY: panY.value,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveCanvasPan(event: PointerEvent) {
  if (!activePan) return
  panX.value = activePan.originX + (event.clientX - activePan.startX)
  panY.value = activePan.originY + (event.clientY - activePan.startY)
}
function endCanvasPan() {
  activePan = null
}
function zoomBy(delta: number) {
  zoom.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom.value + delta))
}
/** Wheel-to-zoom, centered visually since the stage transform scales from its center. */
function handleCanvasWheel(event: WheelEvent) {
  event.preventDefault()
  zoomBy(event.deltaY > 0 ? -0.15 : 0.15)
}
function resetView() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

const TUTORIAL_STEPS = [
  'Pick a scenario and start a run — every network begins on a clean slate.',
  'Select a device, choose "Begin cable", then tap its destination to wire them together.',
  'Phones and tablets only join through Wi-Fi coverage; other end devices can use either a cable or Wi-Fi.',
  'Watch the canvas: packets animate along your cables. Orange links are over capacity — upgrade the link or add another route.',
  'Open Site Upgrades for discounted bulk upgrades, and check Run Stats for live delivery telemetry.',
]
const tutorialStep = ref(0)
const tutorialActive = ref(localStorage.getItem(TUTORIAL_SEEN_KEY) === null)
function dismissTutorial() {
  tutorialActive.value = false
  localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
}
function advanceTutorial() {
  if (tutorialStep.value >= TUTORIAL_STEPS.length - 1) {
    dismissTutorial()
    return
  }
  tutorialStep.value++
}

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
  return 'Network looks steady. Keep an eye on capacity as traffic ramps up.'
})

let simulationTimer: number | undefined
let animationFrame: number | undefined
const animationTime = ref(performance.now())
const lastSimulationTickTime = ref(performance.now())

const simulationInterval = () => 800 / (game.value?.speed ?? 1)

/** Keeps the browser timer synchronized with pause and speed controls. */
const synchronizeSimulationTimer = () => {
  clearInterval(simulationTimer)
  lastSimulationTickTime.value = performance.now()
  if (game.value && screen.value === 'game' && game.value.phase === 'playing') {
    simulationTimer = window.setInterval(() => {
      if (game.value) {
        lastSimulationTickTime.value = performance.now()
        game.value = simulate(game.value)
      }
    }, simulationInterval())
  }
}
watch([() => game.value?.phase, () => game.value?.speed, screen], synchronizeSimulationTimer, {
  immediate: true,
})
watch(
  game,
  (currentGame) => {
    if (!currentGame) return
    localStorage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(currentGame))
    if (currentGame.score > best.value) {
      best.value = currentGame.score
      localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(currentGame.score))
    }
  },
  { deep: true },
)
/** Appends a leaderboard entry exactly once, on the transition into game over. */
watch(
  () => game.value?.phase,
  (phase, previousPhase) => {
    if (phase !== 'gameover' || previousPhase === 'gameover' || !game.value) return
    recordLeaderboardEntry(game.value)
  },
)
onMounted(() => {
  const updateAnimationClock = (timestamp: number) => {
    animationTime.value = timestamp
    animationFrame = requestAnimationFrame(updateAnimationClock)
  }
  animationFrame = requestAnimationFrame(updateAnimationClock)
})

onBeforeUnmount(() => {
  clearInterval(simulationTimer)
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
})

/** Starts a fresh run and clears transient canvas selection. */
function start(scenarioId: string) {
  game.value = newGame(scenarioId)
  screen.value = 'game'
  selected.value = null
  canvasInteractionCount.value = 0
}
const CANVAS_HINT_ACTIONS = 4
/** Counts canvas interactions so the idle "select a device" hint can fade out. */
const canvasInteractionCount = ref(0)
const canvasHintVisible = computed(() => canvasInteractionCount.value < CANVAS_HINT_ACTIONS)

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
/** Starts drawing a new cable from a device, canceling any pending reroute. */
function beginCable(deviceId: string) {
  reroutingCable.value = null
  cableStart.value = deviceId
}
/** Begins rerouting one end of the selected cable to a new device on next pick. */
function startReroute(movingFromEnd: boolean) {
  if (!pickedCable.value) return
  cableStart.value = null
  reroutingCable.value = { cableId: pickedCable.value.id, movingFromEnd }
}
/** Closes the inspector and cancels any in-progress cable reroute. */
function closeInspector() {
  selected.value = null
  reroutingCable.value = null
}
function setGame(next: GameState) {
  game.value = next
}
/** Places a build-panel device and counts it as a canvas interaction. */
function placeDevice(kind: DeviceKind) {
  if (!game.value) return
  canvasInteractionCount.value++
  game.value = buildDevice(game.value, kind)
}

/** Removes the selected cable and closes its inspector. */
function deleteSelectedCable() {
  if (!game.value || !pickedCable.value) return
  game.value = deleteCable(game.value, pickedCable.value.id)
  selected.value = null
  reroutingCable.value = null
}

/** Removes selected infrastructure and closes its inspector. */
function removeSelectedDevice() {
  if (!game.value || !picked.value) return
  game.value = removeDevice(game.value, picked.value.id)
  selected.value = null
  reroutingCable.value = null
}

const siteDiscountedCost = (fullPrice: number) => Math.floor(fullPrice * 0.85)

/** Creates an entry id in modern browsers and a non-secure-context fallback elsewhere. */
const createEntryId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

/** Appends a finished run to the local leaderboard, keeping the top scores. */
function recordLeaderboardEntry(finishedGame: GameState) {
  leaderboard.value = [
    ...leaderboard.value,
    {
      id: createEntryId(),
      scenario: finishedGame.scenario,
      score: finishedGame.score,
      delivered: finishedGame.delivered,
      tick: finishedGame.tick,
      completedAt: Date.now(),
    },
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, LEADERBOARD_SIZE)
  localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(leaderboard.value))
}

/** Resumes a failed topology without allowing additional leaderboard scoring. */
function continueUnscored() {
  if (!game.value) return
  game.value.phase = 'playing'
  game.value.unscored = true
  game.value.failure = 0
  game.value.recentDrops = []
}
/** Returns the path selected by the orthogonal cable router. */
function cablePath(cableId: string): string {
  const route = cableRoutes.value.get(cableId)
  return route ? routeToSvgPath(route) : ''
}

/** Smoothly advances the visual half-hop between discrete simulation ticks. */
function packetVisualProgress(simulationProgress: number): number {
  if (game.value?.phase !== 'playing') return simulationProgress
  const elapsed = animationTime.value - lastSimulationTickTime.value
  const tickFraction = Math.max(0, Math.min(1, elapsed / simulationInterval()))
  return Math.min(0.999, simulationProgress + tickFraction * 0.5)
}

/** Maps packet progress onto the routed geometry of its current cable. */
function packetPos(path: string[], hop: number, progress: number) {
  if (!game.value) return { x: 0, y: 0 }
  const currentDeviceId = path[hop]
  const nextDeviceId = path[hop + 1]
  const networkCable = game.value.cables.find(
    (candidate) =>
      (candidate.from === currentDeviceId && candidate.to === nextDeviceId) ||
      (candidate.to === currentDeviceId && candidate.from === nextDeviceId),
  )
  if (!networkCable) {
    const currentDevice = game.value.devices.find((device) => device.id === currentDeviceId)
    const nextDevice = game.value.devices.find((device) => device.id === nextDeviceId)
    if (!currentDevice || !nextDevice) return { x: 0, y: 0 }
    return {
      x: currentDevice.x + (nextDevice.x - currentDevice.x) * progress,
      y: currentDevice.y + (nextDevice.y - currentDevice.y) * progress,
    }
  }
  const route = cableRoutes.value.get(networkCable.id)
  if (!route) return { x: 0, y: 0 }
  const points = networkCable.from === currentDeviceId ? route.points : [...route.points].reverse()
  return pointAlongRoute(points, progress)
}
let activeDrag: { id: string; startX: number; startY: number; moved: boolean } | null = null
function startDeviceDrag(event: PointerEvent, device: Device) {
  if (cableStart.value) return
  event.stopPropagation() // don't also start a background canvas pan
  activeDrag = { id: device.id, startX: event.clientX, startY: event.clientY, moved: false }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
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
    <div v-if="screen === 'menu'" class="menu-page">
      <nav>
        <div class="brand">
          <Network /><span>NETWORK<span>MASTER</span></span>
        </div>
        <div>
          <button @click="dark = !dark"><Sun v-if="dark" /><Moon v-else /></button
          ><span class="local-pill">LOCAL SAVE</span>
        </div>
      </nav>
      <section class="hero">
        <p class="overline">SYSTEM ONLINE · CLIENT-SIDE SIMULATION</p>
        <h1>Build the network.<br /><em>Keep it alive.</em></h1>
        <p class="lede">
          Every packet needs a path. Every path has a limit. Design a resilient topology before
          demand overwhelms it.
        </p>
        <div class="hero-actions">
          <button class="primary" @click="start(chosen)"><CirclePlay /> Start new run</button
          ><button v-if="game" @click="screen = 'game'">Continue · score {{ game.score }}</button>
        </div>
        <div class="best">
          <span>PERSONAL BEST</span><b>{{ best.toLocaleString() }}</b
          ><button @click="modal = 'leaderboard'">Leaderboard</button>
        </div>
      </section>
      <section class="scenario-section">
        <div class="section-head">
          <div>
            <p class="overline">CHOOSE YOUR NETWORK</p>
            <h2>Scenarios</h2>
          </div>
          <p>Each topology brings a different kind of trouble.</p>
        </div>
        <div class="scenario-grid">
          <button
            v-for="(s, i) in SCENARIOS"
            :key="s.id"
            class="scenario-card"
            :class="{ selected: chosen === s.id }"
            @click="chosen = s.id"
          >
            <span class="num">0{{ i + 1 }}</span>
            <div class="topology-mini"><i /><i /><i /><i /></div>
            <p>{{ s.eyebrow }}</p>
            <h3>{{ s.name }}</h3>
            <span>{{ s.description }}</span>
            <div class="difficulty">
              DIFFICULTY <i v-for="n in 5" :key="n" :class="{ on: n <= s.difficulty }" />
            </div>
          </button>
        </div>
      </section>
      <footer class="menu-footer">
        <span>NO ACCOUNT · NO CLOUD · YOUR NETWORK STAYS YOURS</span><span>VUE 3 · v0.1.0</span>
      </footer>
    </div>
    <div v-else-if="game" class="game-shell">
      <header class="topbar">
        <div class="brand small">
          <Network /><span>NETWORK<span>MASTER</span></span>
        </div>
        <div class="scenario-tag">{{ SCENARIOS.find((s) => s.id === game!.scenario)?.name }}</div>
        <div class="top-actions">
          <button class="upgrade-nav" @click="modal = 'upgrades'"><Zap /> Site Upgrades</button
          ><button @click="modal = 'help'"><HelpCircle /> Help</button
          ><button @click="dark = !dark"><Sun v-if="dark" /><Moon v-else /></button
          ><button @click="screen = 'menu'">Exit</button>
        </div>
      </header>
      <section class="hud">
        <div class="metric accent">
          <span>Score · {{ game.multiplier }}×</span><b>{{ game.score.toLocaleString() }}</b>
        </div>
        <div class="metric">
          <span>Delivered</span><b>{{ game.delivered }}</b>
        </div>
        <div class="metric" :class="{ 'danger-text': game.dropped }">
          <span>Dropped</span><b>{{ game.dropped }}</b>
        </div>
        <div class="metric">
          <span>Combo</span><b>{{ game.combo }}×</b>
        </div>
        <div class="metric">
          <span>Budget</span><b>${{ game.budget }}</b>
        </div>
        <div class="pressure">
          <span
            >Failure pressure <b>{{ Math.round(game.failure) }}%</b></span
          >
          <div><i :style="{ width: game.failure + '%' }" /></div>
        </div>
        <button class="pause" @click="game.phase = game.phase === 'playing' ? 'paused' : 'playing'">
          <CirclePause v-if="game.phase === 'playing'" /><CirclePlay v-else />{{
            game.phase === 'playing' ? 'Pause' : 'Resume'
          }}
        </button>
      </section>
      <div class="workspace">
        <aside class="build-panel">
          <div class="panel-title"><Plus /> BUILD</div>
          <button
            v-for="[kind, label, cost] in BUILD_OPTIONS"
            :key="kind"
            :disabled="game.budget < cost"
            @click="placeDevice(kind)"
          >
            <component :is="deviceIcons[kind]" /><span
              >{{ label }}<small>${{ cost }}</small></span
            >
          </button>
        </aside>
        <div
          class="canvas"
          @wheel="handleCanvasWheel"
          @pointerdown="startCanvasPan"
          @pointermove="moveCanvasPan"
          @pointerup="endCanvasPan"
          @pointercancel="endCanvasPan"
        >
          <div class="canvas-stage" :style="{ transform: canvasTransform }">
            <svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none">
              <g v-for="c in game.cables" :key="c.id" @pointerdown.stop @click="selected = c.id">
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
              v-for="hub in game.devices.filter((d) => d.kind === 'wireless')"
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
              @click.prevent
            >
              <span
                ><component :is="deviceIcons[d.kind]" class="icon-primary" /><Unplug
                  v-if="d.offline"
                  class="icon-unplugged"
              /></span>
              <b>{{ d.label }}</b
              ><small
                v-if="WIRELESS_CAPABLE_KINDS.includes(d.kind) && d.ports === 0"
                class="wifi-badge"
                :class="{ 'out-of-range': !wirelessHubLabel(d.id) }"
              >
                {{ wirelessHubLabel(d.id) ? 'WI-FI · ' + wirelessHubLabel(d.id) : 'OUT OF RANGE' }}
              </small>
              <small v-else-if="d.kind !== 'cloud'">{{ d.ports }}/{{ d.maxPorts }} PORTS</small>
              <div
                v-if="THROUGHPUT_KINDS.includes(d.kind)"
                class="throughput-bar"
                :class="{ over: throughputRatio(d) > 1 }"
              >
                <i :style="{ width: Math.min(100, throughputRatio(d) * 100) + '%' }" />
              </div>
            </button>
            <i
              v-for="p in game.packets"
              :key="p.id"
              class="packet"
              :class="p.priority"
              :style="{
                left: packetPos(p.path, p.hop, packetVisualProgress(p.progress)).x + '%',
                top: packetPos(p.path, p.hop, packetVisualProgress(p.progress)).y + '%',
              }"
            />
          </div>
          <div v-if="cableStart || canvasHintVisible" class="canvas-note">
            <CableIcon />{{
              cableStart ? 'Choose a destination device' : 'Select a device to inspect or connect'
            }}
          </div>
          <div class="advisor-tip"><EthernetPort />Jackie: {{ advisorTip }}</div>
          <div class="minimap" @pointerdown.stop>
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
                v-for="hub in game.devices.filter((d) => d.kind === 'wireless')"
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
                :x1="game.devices.find((d) => d.id === c.from)?.x"
                :y1="game.devices.find((d) => d.id === c.from)?.y"
                :x2="game.devices.find((d) => d.id === c.to)?.x"
                :y2="game.devices.find((d) => d.id === c.to)?.y"
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
          <div v-if="tutorialActive" class="tutorial-card" @pointerdown.stop>
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
          <button class="close" @click="closeInspector"><X /></button
          ><template v-if="picked"
            ><p class="overline">DEVICE INSPECTOR</p>
            <div class="inspect-head">
              <span><component :is="deviceIcons[picked.kind]" /></span>
              <div>
                <h2>{{ picked.label }}</h2>
                <p>{{ picked.kind.toUpperCase() }} · SUBNET {{ picked.subnet }}</p>
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
              ><b>{{ picked.pps > 100 ? 'No limit' : picked.pps + ' pkt/tick' }}</b>
            </div>
            <div v-if="THROUGHPUT_KINDS.includes(picked.kind)" class="pressure inspector-pressure">
              <span
                >Current load
                <b
                  >{{ deviceThroughputUsed(picked) }} / {{ deviceCapacity(picked) }} pkt/tick</b
                ></span
              >
              <div>
                <i
                  :class="{ over: throughputRatio(picked) > 1 }"
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
            <div
              v-if="['router', 'switch', 'wireless', 'firewall'].includes(picked.kind)"
              class="stat"
            >
              <span>Queue</span
              ><b :class="{ 'danger-text': queueDepth(picked.id) > 0 }"
                >{{ queueDepth(picked.id) }} waiting</b
              >
            </div>
            <div v-if="picked.kind === 'firewall'" class="device-upgrades">
              <button @click="setGame(cycleFirewallRule(game!, picked!.id))">
                Block rule <b>{{ picked.firewallRule ?? 'None' }}</b>
              </button>
            </div>
            <div v-if="['router', 'switch'].includes(picked.kind)" class="device-upgrades">
              <button @click="setGame(upgradeDevicePorts(game!, picked!.id))">
                +2 Ports <b>$50</b></button
              ><button @click="setGame(upgradeDeviceSpeed(game!, picked!.id))">
                Faster forwarding <b>${{ picked.kind === 'router' ? 90 : 60 }}</b>
              </button>
            </div>
            <div v-if="picked.kind === 'wireless'" class="device-upgrades">
              <button @click="setGame(upgradeWifi(game!, picked!.id))">
                Upgrade Wi-Fi
                <b>{{ wifiInfo(picked)!.cost >= 999 ? 'MAX' : '$' + wifiInfo(picked)!.cost }}</b>
              </button>
            </div>
            <button
              v-if="picked.health < 100"
              class="wide"
              @click="setGame(repairDevice(game!, picked!.id))"
            >
              <Wrench /> Field repair · $40</button
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
            ><p class="overline">CONNECTION</p>
            <h2>
              {{ game.devices.find((d) => d.id === pickedCable!.from)?.label }} ↔
              {{ game.devices.find((d) => d.id === pickedCable!.to)?.label }}
            </h2>
            <div class="stat">
              <span>Tier</span><b>{{ pickedCable.tier }}</b>
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
                CABLE_TIERS.findIndex((t) => t.name === pickedCable!.tier) < CABLE_TIERS.length - 1
              "
              class="primary wide"
              @click="setGame(upgradeCable(game!, pickedCable!.id))"
            >
              <Zap /> Upgrade · ${{
                CABLE_TIERS[CABLE_TIERS.findIndex((t) => t.name === pickedCable!.tier)].cost
              }}</button
            ><button
              class="wide"
              :class="{ primary: reroutingCable?.movingFromEnd === true }"
              @click="startReroute(true)"
            >
              <CableIcon />{{
                reroutingCable?.movingFromEnd === true
                  ? 'Choose new start…'
                  : `Reroute start (${game.devices.find((d) => d.id === pickedCable!.from)?.label})`
              }}</button
            ><button
              class="wide"
              :class="{ primary: reroutingCable?.movingFromEnd === false }"
              @click="startReroute(false)"
            >
              <CableIcon />{{
                reroutingCable?.movingFromEnd === false
                  ? 'Choose new end…'
                  : `Reroute end (${game.devices.find((d) => d.id === pickedCable!.to)?.label})`
              }}</button
            ><button class="wide danger-action" @click="deleteSelectedCable">
              <Trash2 /> Delete · salvage 90%
            </button></template
          >
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
        ><button @click="game.speed = game.speed === 1 ? 2 : 1">{{ game.speed }}× SPEED</button
        ><button @click="modal = 'stats'">RUN STATS</button>
      </footer>
    </div>
    <div v-if="game?.phase === 'gameover'" class="modal-backdrop">
      <div class="modal">
        <p class="overline danger-text">NETWORK FAILURE</p>
        <h1>The network went dark.</h1>
        <p>
          Your topology delivered <b>{{ game.delivered }}</b> packets before the rolling loss window
          exceeded its threshold.
        </p>
        <div class="final-score">
          {{ game.score.toLocaleString()
          }}<small>FINAL SCORE · {{ game.tick }} TICKS · {{ game.dropped }} DROPPED</small>
        </div>
        <button class="primary" @click="start(game.scenario)"><RotateCcw /> Try again</button
        ><button @click="continueUnscored">Continue unscored</button
        ><button @click="modal = 'leaderboard'">Leaderboard</button
        ><button @click="screen = 'menu'">Main menu</button>
      </div>
    </div>
    <div v-if="modal" class="modal-backdrop" @mousedown.self="modal = null">
      <div class="modal">
        <button class="close" @click="modal = null"><X /></button
        ><template v-if="modal === 'help'"
          ><p class="overline">QUICK START</p>
          <h1>Route every packet.</h1>
          <ol>
            <li>Select equipment and choose <b>Begin cable</b>, then tap its destination.</li>
            <li>Phones and tablets require Wi-Fi coverage; they cannot use Ethernet.</li>
            <li>Orange links exceed capacity. Upgrade or create another path.</li>
            <li>Clean ticks build a score combo; redundant routes add bonus points.</li>
            <li>Failure occurs after more than 30 drops across a rolling 20-tick window.</li>
          </ol></template
        ><template v-else-if="modal === 'upgrades'"
          ><p class="overline">SITE UPGRADES</p>
          <h1>Upgrade the whole network.</h1>
          <p>Bulk upgrades cost less per component and apply instantly.</p>
          <div class="upgrade-list">
            <button @click="setGame(upgradeAllCables(game!, 'Fast Ethernet'))">
              <span
                ><CableIcon /><b>Fast Ethernet rollout</b
                ><small>
                  {{ siteCableUpgradeTargets(game!, 'Fast Ethernet').length }} link(s) below 100
                  Mbps</small
                ></span
              ><strong
                >${{ siteDiscountedCost(siteCableUpgradeFullCost(game!, 'Fast Ethernet')) }}</strong
              ></button
            ><button @click="setGame(upgradeAllCables(game!, 'Gigabit'))">
              <span
                ><CableIcon /><b>Gigabit rollout</b
                ><small>
                  {{ siteCableUpgradeTargets(game!, 'Gigabit').length }} link(s) below 1 Gbps</small
                ></span
              ><strong
                >${{ siteDiscountedCost(siteCableUpgradeFullCost(game!, 'Gigabit')) }}</strong
              ></button
            ><button @click="setGame(upgradeAllPorts(game!))">
              <span
                ><Network /><b>Port expansion</b
                ><small>Add 2 ports to every router and switch</small></span
              ><strong
                >${{
                  siteDiscountedCost(
                    game!.devices.filter((d) => ['router', 'switch'].includes(d.kind)).length * 50,
                  )
                }}</strong
              >
            </button>
            <button @click="setGame(upgradeAllSwitchSpeed(game!))">
              <span><Zap /><b>Switch throughput</b><small>+4 pkt/tick on every switch</small></span
              ><strong
                >${{
                  siteDiscountedCost(game!.devices.filter((d) => d.kind === 'switch').length * 60)
                }}</strong
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
            <span>Avg. delivery latency</span><b>{{ game?.recentLatencyTicks.toFixed(1) }} ticks</b>
          </div>
          <div class="stat">
            <span>Avg. queue delay</span><b>{{ game?.recentQueueDelayTicks.toFixed(1) }} ticks</b>
          </div>
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
  </main>
</template>
