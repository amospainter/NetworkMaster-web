<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import MenuScreen from './components/MenuScreen.vue'
import { useCanvasPanZoom } from './composables/useCanvasPanZoom'
import { LEADERBOARD_SIZE, useLeaderboard } from './composables/useLeaderboard'
import { useOfflineBlink } from './composables/useOfflineBlink'
import { useSimulationClock } from './composables/useSimulationClock'
import { TUTORIAL_STEPS, useTutorial } from './composables/useTutorial'
import { deviceIcons } from './deviceIcons'
import {
  addCable,
  buildDevice,
  CABLE_TIERS,
  cycleCableVlan,
  cycleFirewallRule,
  deleteCable,
  deviceCapacity,
  deviceRemovalRefund,
  FORWARDING_SPEED_COSTS,
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
import type { CableTier, Device, DeviceKind, GameState } from './types'

const ACTIVE_RUN_STORAGE_KEY = 'networkmaster.active-run.v1'
const HIGH_SCORE_STORAGE_KEY = 'networkmaster.best.v1'

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
const screen = ref<'menu' | 'game'>('menu')
const game = ref<GameState | null>(loadSavedGame())
const selected = ref<string | null>(null)
const cableStart = ref<string | null>(null)
const cableStyle = ref<'rightAngle' | 'diagonal'>('rightAngle')
/** Set while rerouting an existing cable's endpoint; cleared once a target device is chosen. */
const reroutingCable = ref<{ cableId: string; movingFromEnd: boolean } | null>(null)
const modal = ref<'help' | 'stats' | 'upgrades' | 'leaderboard' | null>(null)
const HELP_SECTIONS = ['Basics', 'Devices & Wi-Fi', 'Scoring & economy', 'Survival'] as const
const helpSection = ref<(typeof HELP_SECTIONS)[number]>('Basics')
/** Target tier for the site-wide cable rollout picker; defaults to the cheapest upgrade. */
const cableUpgradeTarget = ref<CableTier>('Fast Ethernet')
const dark = ref(true)
const chosen = ref('home')
const best = ref(Number(localStorage.getItem(HIGH_SCORE_STORAGE_KEY) || 0))
const { leaderboard } = useLeaderboard(game)
const { tutorialStep, tutorialActive, dismissTutorial, advanceTutorial } = useTutorial()
const { offlineBlinkOn } = useOfflineBlink()
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

const {
  canvasTransform,
  startCanvasPan,
  moveCanvasPan,
  endCanvasPan,
  zoomBy,
  handleCanvasWheel,
  resetView,
} = useCanvasPanZoom(cableStart, reroutingCable)

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

const { packetVisualProgress } = useSimulationClock(game, screen)

/** Persists the active run and tracks the personal best on every change. */
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

/** Canvas position at the midpoint of a cable's routed path, for its bandwidth label. */
function cableLabelPos(cableId: string): { x: number; y: number } {
  const route = cableRoutes.value.get(cableId)
  if (!route) return { x: 0, y: 0 }
  return pointAlongRoute(route.points, 0.5)
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
    <MenuScreen
      v-if="screen === 'menu'"
      v-model:chosen="chosen"
      v-model:dark="dark"
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
        @toggle-pause="game.phase = game.phase === 'playing' ? 'paused' : 'playing'"
      />
      <div class="workspace">
        <BuildPanel :budget="game.budget" @place="placeDevice" />
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
              v-for="c in game.cables"
              :key="'bandwidth-' + c.id"
              class="cable-label"
              :class="c.status"
              :style="{ left: cableLabelPos(c.id).x + '%', top: cableLabelPos(c.id).y + '%' }"
            >
              <b>{{ c.tier }}</b
              ><span>{{ c.load }}/{{ c.capacity }} pkt</span>
            </div>
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
                ><component :is="deviceIcons[d.kind]" v-if="!d.offline || offlineBlinkOn" /><Unplug
                  v-else
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
                Faster forwarding <b>${{ FORWARDING_SPEED_COSTS[picked.kind] }}</b>
              </button>
            </div>
            <div v-if="picked.kind === 'wireless'" class="device-upgrades">
              <button @click="setGame(upgradeWifi(game!, picked!.id))">
                Upgrade Wi-Fi
                <b>{{ wifiInfo(picked)!.cost >= 999 ? 'MAX' : '$' + wifiInfo(picked)!.cost }}</b>
              </button>
              <button @click="setGame(upgradeDeviceSpeed(game!, picked!.id))">
                Faster forwarding <b>${{ FORWARDING_SPEED_COSTS[picked.kind] }}</b>
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
        <button class="close" @click="modal = null"><X /></button
        ><template v-if="modal === 'help'"
          ><p class="overline">HOW TO PLAY</p>
          <h1>Route every packet.</h1>
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
              <li>Pan by dragging empty canvas; zoom with the scroll wheel or the +/− buttons.</li>
              <li>
                Only the <b>router</b> may connect to the Cloud Edge, and two end devices can never
                link directly — equipment must sit between them.
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
                generation (range + base speed) and Faster forwarding (+2 pkt/tick, stacks on top).
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
                <b>Site Upgrades</b> (top bar) bulk-upgrade cable tiers, ports, or throughput across
                the whole network for 15% less than one at a time.
              </li>
            </ol>
          </div>
          <div v-else>
            <ol>
              <li>
                Orange links are over capacity — upgrade the cable or add a parallel route before it
                fails.
              </li>
              <li>
                Failure pressure is the share of packets dropped across the last 20 ticks; the run
                ends once it's sustained above 30 drops past the scenario's early grace period.
              </li>
              <li>
                Challenge events roll periodically: traffic spikes, budget bonuses, device surges,
                and — in harder scenarios — outright equipment failure.
              </li>
              <li>
                At game over you can <b>Try again</b> or <b>Continue unscored</b> to keep playing
                without further leaderboard scoring.
              </li>
              <li>
                Watch <b>Jackie</b> (bottom of the canvas) — it always surfaces the single most
                urgent thing to fix right now.
              </li>
              <li>Every completed run is saved to your local Leaderboard, win or lose.</li>
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
            <button @click="setGame(upgradeAllCables(game!, cableUpgradeTarget))">
              <span
                ><CableIcon /><b>Upgrade to {{ cableUpgradeTarget }}</b
                ><small>
                  {{ siteCableUpgradeTargets(game!, cableUpgradeTarget).length }} link(s) below
                  {{ TIER_SPEED_LABEL[cableUpgradeTarget] }}</small
                ></span
              ><strong
                >${{
                  siteDiscountedCost(siteCableUpgradeFullCost(game!, cableUpgradeTarget))
                }}</strong
              >
            </button>
            <button @click="setGame(upgradeAllPorts(game!))">
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
