<script setup lang="ts">
import {
  Building,
  Building2,
  CirclePlay,
  Coffee,
  GitBranch,
  Globe,
  GraduationCap,
  House,
  Landmark,
  Moon,
  Network,
  PartyPopper,
  Rocket,
  Server,
  Sun,
  Zap,
} from 'lucide-vue-next'
import { computed } from 'vue'
import { SCENARIOS } from '../game'
import type { GameState } from '../types'

const props = defineProps<{
  game: GameState | null
  best: number
}>()
const chosen = defineModel<string>('chosen', { required: true })
const dark = defineModel<boolean>('dark', { required: true })

const emit = defineEmits<{
  start: [scenarioId: string]
  continueGame: []
  openLeaderboard: []
}>()

/**
 * Selects and immediately launches a scenario from its card's Play button,
 * without requiring a scroll back up to the hero's "Start new run" button.
 *
 * @param scenarioId - Scenario to select and start.
 * @returns Nothing; selection state is updated and a start event is emitted.
 */
function playScenario(scenarioId: string) {
  chosen.value = scenarioId
  emit('start', scenarioId)
}

/** Name of the currently selected scenario, shown above the hero's Start/Continue buttons. */
const chosenScenarioName = computed(() => SCENARIOS.find((s) => s.id === chosen.value)?.name)

/** Name of the scenario belonging to the saved run, which may differ from the current selection. */
const savedScenarioName = computed(
  () => SCENARIOS.find((scenario) => scenario.id === props.game?.scenario)?.name ?? 'Saved run',
)

/**
 * One distinctive icon per scenario, replacing the earlier topology-preview
 * mini-map — a glance at the grid should tell scenarios apart by theme
 * (coffee shop, rocket, city skyline) rather than by squinting at dots and
 * lines that mostly looked alike across similarly-shaped topologies.
 */
const SCENARIO_ICONS: Record<string, typeof House> = {
  home: House,
  cafe: Coffee,
  startup: Rocket,
  school: GraduationCap,
  corporate: Building2,
  metro: Landmark,
  branch: GitBranch,
  arena: PartyPopper,
  isp: Globe,
  datacenter: Server,
  edge: Zap,
  smartcity: Building,
}
</script>

<template>
  <div class="menu-page">
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
        Every packet needs a path. Every path has a limit. Design a resilient topology before demand
        overwhelms it.
      </p>
      <div class="scenario-tag hero-scenario-tag">
        <component :is="SCENARIO_ICONS[chosen]" />
        <span>Current scenario</span>
        <strong>{{ chosenScenarioName }}</strong>
      </div>
      <div class="hero-actions">
        <button
          class="primary menu-tooltip"
          :aria-label="`Start ${chosenScenarioName}`"
          :data-tooltip="`Start ${chosenScenarioName}`"
          @click="emit('start', chosen)"
        >
          <CirclePlay /> Start new run</button
        ><button v-if="game" @click="emit('continueGame')">
          Continue {{ savedScenarioName }} · score {{ game.score }}
        </button>
      </div>
      <div class="best">
        <span>PERSONAL BEST</span><b>{{ best.toLocaleString() }}</b
        ><button @click="emit('openLeaderboard')">Leaderboard</button>
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
        <div
          v-for="(s, i) in SCENARIOS"
          :key="s.id"
          class="scenario-card"
          :class="{ selected: chosen === s.id }"
          role="button"
          tabindex="0"
          @click="chosen = s.id"
          @keydown.enter="chosen = s.id"
          @keydown.space.prevent="chosen = s.id"
        >
          <span class="num">{{ String(i + 1).padStart(2, '0') }}</span>
          <button
            class="scenario-play menu-tooltip"
            :aria-label="`Start ${s.name} now`"
            :data-tooltip="`Start ${s.name}`"
            @click.stop="playScenario(s.id)"
          >
            <CirclePlay />
          </button>
          <div class="scenario-icon">
            <component :is="SCENARIO_ICONS[s.id]" />
          </div>
          <p>{{ s.eyebrow }}</p>
          <h3>{{ s.name }}</h3>
          <span>{{ s.description }}</span>
          <div class="difficulty">
            DIFFICULTY <i v-for="n in 5" :key="n" :class="{ on: n <= s.difficulty }" />
          </div>
        </div>
      </div>
    </section>
    <footer class="menu-footer">
      <div class="menu-footer-row">
        <span>NO ACCOUNT · NO CLOUD · YOUR NETWORK STAYS YOURS</span>
      </div>
      <div class="menu-footer-row">
        <span
          >©
          {{ new Date().getFullYear() }}
          <a href="https://typewrittencode.com/privacy" target="_blank" rel="noopener"
            >Typewritten Code</a
          >. Built with intention.</span
        ><a href="https://typewrittencode.com/privacy" target="_blank" rel="noopener">Privacy</a>
      </div>
    </footer>
  </div>
</template>
