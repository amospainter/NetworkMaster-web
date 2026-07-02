<script setup lang="ts">
import { CirclePlay, Moon, Network, Sun } from 'lucide-vue-next'
import { SCENARIOS } from '../game'
import type { GameState } from '../types'

defineProps<{
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
      <div class="hero-actions">
        <button class="primary" @click="emit('start', chosen)"><CirclePlay /> Start new run</button
        ><button v-if="game" @click="emit('continueGame')">
          Continue · score {{ game.score }}
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
      <span>NO ACCOUNT · NO CLOUD · YOUR NETWORK STAYS YOURS</span>
    </footer>
    <footer class="menu-footer legal-footer">
      <span
        >©
        {{ new Date().getFullYear() }}
        <a href="https://typewrittencode.com/privacy" target="_blank" rel="noopener"
          >Typewritten Code</a
        >. Built with intention.</span
      ><a href="https://typewrittencode.com/privacy" target="_blank" rel="noopener">Privacy</a>
    </footer>
  </div>
</template>
