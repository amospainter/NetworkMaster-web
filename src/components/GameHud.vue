<script setup lang="ts">
import {
  CirclePause,
  CirclePlay,
  HelpCircle,
  Menu,
  Moon,
  Network,
  Sun,
  X,
  Zap,
} from 'lucide-vue-next'
import { ref } from 'vue'
import { SCENARIOS } from '../game'
import type { GameState } from '../types'

defineProps<{
  game: GameState
}>()
const dark = defineModel<boolean>('dark', { required: true })
const mobileMenuOpen = ref(false)

const emit = defineEmits<{
  openUpgrades: []
  openHelp: []
  exitToMenu: []
  togglePause: []
  openLeaderboard: []
  acceptSla: []
  declineSla: []
}>()

/**
 * Opens a desktop-equivalent destination, then dismisses the mobile overflow menu.
 *
 * @param panel - Destination panel to request from the parent component.
 * @returns Nothing; an event is emitted and local menu state is updated.
 */
function openMobilePanel(panel: 'upgrades' | 'help' | 'leaderboard') {
  if (panel === 'upgrades') emit('openUpgrades')
  if (panel === 'help') emit('openHelp')
  if (panel === 'leaderboard') emit('openLeaderboard')
  mobileMenuOpen.value = false
}
</script>

<template>
  <div class="menu-bar">
    <button @click="emit('exitToMenu')">File</button><button @click="dark = !dark">View</button
    ><button @click="emit('openUpgrades')">Network</button
    ><button @click="emit('openLeaderboard')">Scores</button
    ><button @click="emit('openHelp')">Help</button>
  </div>
  <header class="topbar">
    <div class="brand small">
      <Network /><span>NETWORK<span>MASTER</span></span>
    </div>
    <div class="scenario-tag">{{ SCENARIOS.find((s) => s.id === game.scenario)?.name }}</div>
    <div v-if="game.mode === 'sandbox'" class="scenario-tag sandbox-tag">SANDBOX · UNSCORED</div>
    <div v-if="game.slaContract" class="sla-chip" :class="{ pending: !game.slaContract.accepted }">
      <span
        >SLA ·
        {{
          game.slaContract.kind === 'latency'
            ? `latency < ${game.slaContract.target}t`
            : `deliver ${game.slaContract.target} pkt`
        }}
        · ${{ game.slaContract.reward }} · {{ game.slaContract.ticksRemaining }}t</span
      >
      <template v-if="!game.slaContract.accepted">
        <button class="sla-accept" @click="emit('acceptSla')">Accept</button>
        <button class="sla-decline" @click="emit('declineSla')">Decline</button>
      </template>
    </div>
    <div class="top-actions">
      <button class="upgrade-nav" @click="emit('openUpgrades')"><Zap /> Site Upgrades</button
      ><button @click="emit('openHelp')"><HelpCircle /> Help</button
      ><button @click="dark = !dark"><Sun v-if="dark" /><Moon v-else /></button
      ><button @click="emit('exitToMenu')">Exit</button>
    </div>
  </header>
  <header class="mobile-topbar">
    <div class="brand small">
      <Network /><span>NETWORK<span>MASTER</span></span>
    </div>
    <div class="mobile-top-actions">
      <button class="mobile-budget" aria-label="Current budget">${{ game.budget }}</button>
      <button
        :aria-label="mobileMenuOpen ? 'Close menu' : 'Open menu'"
        :aria-expanded="mobileMenuOpen"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <X v-if="mobileMenuOpen" /><Menu v-else />
      </button>
    </div>
    <div v-if="mobileMenuOpen" class="mobile-overflow-menu">
      <div
        v-if="game.slaContract"
        class="sla-chip mobile-sla"
        :class="{ pending: !game.slaContract.accepted }"
      >
        <span
          >SLA ·
          {{
            game.slaContract.kind === 'latency'
              ? `latency < ${game.slaContract.target}t`
              : `deliver ${game.slaContract.target} pkt`
          }}
          · ${{ game.slaContract.reward }} · {{ game.slaContract.ticksRemaining }}t</span
        >
        <template v-if="!game.slaContract.accepted">
          <button class="sla-accept" @click="emit('acceptSla')">Accept</button>
          <button class="sla-decline" @click="emit('declineSla')">Decline</button>
        </template>
      </div>
      <button @click="openMobilePanel('upgrades')"><Zap /> Site upgrades</button>
      <button @click="openMobilePanel('help')"><HelpCircle /> Help</button>
      <button @click="openMobilePanel('leaderboard')">Scores</button>
      <button @click="dark = !dark"><Sun v-if="dark" /><Moon v-else /> Theme</button>
      <button @click="emit('exitToMenu')">Exit to menu</button>
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
      <div>
        <i
          :class="{ warn: game.failure >= 50 && game.failure < 85, over: game.failure >= 85 }"
          :style="{ width: game.failure + '%' }"
        />
      </div>
    </div>
    <button class="pause" @click="emit('togglePause')">
      <CirclePause v-if="game.phase === 'playing'" /><CirclePlay v-else />{{
        game.phase === 'playing' ? 'Pause' : 'Resume'
      }}
    </button>
  </section>
</template>

<style scoped>
.sandbox-tag {
  color: var(--warn, #d9a441);
  border-color: var(--warn, #d9a441);
}
.sla-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 700 10px var(--font-ui);
  padding: 3px 8px;
  border: 1px solid var(--lime);
  border-radius: 4px;
  color: var(--lime);
  white-space: nowrap;
}
.sla-chip.pending {
  color: var(--warn);
  border-color: var(--warn);
}
.sla-chip button {
  font: 700 10px var(--font-ui);
  padding: 2px 6px;
  border-radius: 3px;
}
.sla-accept {
  background: var(--warn);
  color: var(--accent-ink);
}
.sla-decline {
  background: transparent;
  border: 1px solid currentColor;
}
.mobile-sla {
  flex-wrap: wrap;
  width: 100%;
  box-sizing: border-box;
}
</style>
