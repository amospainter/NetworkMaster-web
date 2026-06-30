<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Activity,
  Cable as CableIcon,
  CirclePause,
  CirclePlay,
  Cloud,
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
  deviceRemovalRefund,
  independentPathCount,
  moveDevice,
  newGame,
  repairDevice,
  removeDevice,
  SCENARIOS,
  servingWirelessHub,
  simulate,
  upgradeAllCopper,
  upgradeAllPorts,
  upgradeAllSwitchSpeed,
  upgradeCable,
  upgradeDevicePorts,
  upgradeDeviceSpeed,
  upgradeWifi,
  wifiInfo,
} from './game'
import type { Device, DeviceKind, GameState } from './types'

const ACTIVE_RUN_STORAGE_KEY = 'networkmaster.active-run.v1'
const HIGH_SCORE_STORAGE_KEY = 'networkmaster.best.v1'

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
    const savedGame = JSON.parse(
      localStorage.getItem(ACTIVE_RUN_STORAGE_KEY) || 'null',
    ) as GameState | null
    if (savedGame?.version !== 2) return null
    savedGame.devices.forEach((device) => {
      device.upgradeSpend ??= 0
      device.firewallRule ??= null
    })
    return savedGame
  } catch {
    return null
  }
}
const screen = ref<'menu' | 'game'>('menu')
const game = ref<GameState | null>(loadSavedGame())
const selected = ref<string | null>(null)
const cableStart = ref<string | null>(null)
const modal = ref<'help' | 'stats' | 'upgrades' | null>(null)
const dark = ref(true)
const chosen = ref('home')
const best = ref(Number(localStorage.getItem(HIGH_SCORE_STORAGE_KEY) || 0))
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
    .filter((device) => ['phone', 'tablet'].includes(device.kind))
    .map((device) => ({ device, hub: servingWirelessHub(game.value!, device.id) }))
    .filter((connection) => connection.hub !== null)
})

function wirelessHubLabel(deviceId: string): string | null {
  return game.value ? (servingWirelessHub(game.value, deviceId)?.label ?? null) : null
}

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
}
function selectDevice(device: Device) {
  if (!game.value) return
  if (cableStart.value && cableStart.value !== device.id) {
    game.value = addCable(game.value, cableStart.value, device.id)
    cableStart.value = null
  }
  selected.value = device.id
}
function setGame(next: GameState) {
  game.value = next
}

/** Removes the selected cable and closes its inspector. */
function deleteSelectedCable() {
  if (!game.value || !pickedCable.value) return
  game.value = deleteCable(game.value, pickedCable.value.id)
  selected.value = null
}

/** Removes selected infrastructure and closes its inspector. */
function removeSelectedDevice() {
  if (!game.value || !picked.value) return
  game.value = removeDevice(game.value, picked.value.id)
  selected.value = null
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
          <span>PERSONAL BEST</span><b>{{ best.toLocaleString() }}</b>
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
            @click="setGame(buildDevice(game!, kind))"
          >
            <component :is="deviceIcons[kind]" /><span
              >{{ label }}<small>${{ cost }}</small></span
            >
          </button>
        </aside>
        <div class="canvas">
          <svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none">
            <g v-for="c in game.cables" :key="c.id" @click="selected = c.id">
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
            :style="{
              left: hub.x + '%',
              top: hub.y + '%',
              width: wifiInfo(hub)!.range * 2 + '%',
              height: wifiInfo(hub)!.range * 2 + '%',
            }"
          >
            <span>{{ wifiInfo(hub)!.name }}</span>
          </div>
          <button
            v-for="d in game.devices"
            :key="d.id"
            class="device"
            :class="[d.kind, { selected: selected === d.id, cabling: cableStart === d.id }]"
            :style="{ left: d.x + '%', top: d.y + '%' }"
            :aria-label="`${d.label}, ${d.kind}, ${d.ports} of ${d.maxPorts} ports`"
            @pointerdown="startDeviceDrag($event, d)"
            @pointermove="moveDraggedDevice"
            @pointerup="finishDeviceDrag($event, d)"
            @click.prevent
          >
            <span><component :is="deviceIcons[d.kind]" /></span><b>{{ d.label }}</b
            ><small
              v-if="['phone', 'tablet'].includes(d.kind)"
              class="wifi-badge"
              :class="{ 'out-of-range': !wirelessHubLabel(d.id) }"
            >
              {{ wirelessHubLabel(d.id) ? 'WI-FI · ' + wirelessHubLabel(d.id) : 'OUT OF RANGE' }}
            </small>
            <small v-else-if="d.kind !== 'cloud'">{{ d.ports }}/{{ d.maxPorts }} PORTS</small>
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
          <div class="canvas-note">
            <CableIcon />{{
              cableStart ? 'Choose a destination device' : 'Select a device to inspect or connect'
            }}
          </div>
        </div>
        <aside v-if="picked || pickedCable" class="inspector">
          <button class="close" @click="selected = null"><X /></button
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
            <div
              v-if="['pc', 'tv', 'console', 'phone', 'tablet'].includes(picked.kind)"
              class="stat"
            >
              <span>Delivered</span><b>{{ picked.delivered }} / {{ picked.generated }}</b>
            </div>
            <div v-if="['phone', 'tablet'].includes(picked.kind)" class="stat">
              <span>Wireless link</span
              ><b :class="{ 'danger-text': !wirelessHubLabel(picked.id) }">
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
              @click="cableStart = picked.id"
            >
              <CableIcon />{{ cableStart === picked.id ? 'Choose destination…' : 'Begin cable' }}
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
            ><button class="wide danger-action" @click="deleteSelectedCable">
              <Trash2 /> Delete · salvage 90%
            </button></template
          >
        </aside>
        <div class="events">
          <div><Activity /> LIVE EVENTS</div>
          <p v-for="(e, i) in game.events.slice(0, 3)" :key="i">
            <span>{{ String(Math.max(0, game.tick - i)).padStart(3, '0') }}</span
            >{{ e }}
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
            <button @click="setGame(upgradeAllCopper(game!))">
              <span
                ><CableIcon /><b>Fast Ethernet rollout</b
                ><small>Upgrade every copper link</small></span
              ><strong
                >${{
                  siteDiscountedCost(game!.cables.filter((c) => c.tier === 'Copper').length * 50)
                }}</strong
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
        ><template v-else
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
          </div></template
        >
      </div>
    </div>
  </main>
</template>
