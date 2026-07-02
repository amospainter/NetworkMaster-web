<script setup lang="ts">
import { CirclePause, CirclePlay, HelpCircle, Moon, Network, Sun, Zap } from 'lucide-vue-next'
import { SCENARIOS } from '../game'
import type { GameState } from '../types'

defineProps<{
  game: GameState
}>()
const dark = defineModel<boolean>('dark', { required: true })

const emit = defineEmits<{
  openUpgrades: []
  openHelp: []
  exitToMenu: []
  togglePause: []
  openLeaderboard: []
}>()
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
    <div class="top-actions">
      <button class="upgrade-nav" @click="emit('openUpgrades')"><Zap /> Site Upgrades</button
      ><button @click="emit('openHelp')"><HelpCircle /> Help</button
      ><button @click="dark = !dark"><Sun v-if="dark" /><Moon v-else /></button
      ><button @click="emit('exitToMenu')">Exit</button>
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
