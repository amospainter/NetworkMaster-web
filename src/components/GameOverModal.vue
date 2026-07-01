<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import type { GameState } from '../types'

defineProps<{
  game: GameState
}>()

const emit = defineEmits<{
  tryAgain: [scenarioId: string]
  continueUnscored: []
  openLeaderboard: []
  mainMenu: []
}>()
</script>

<template>
  <div class="modal-backdrop">
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
      <button class="primary" @click="emit('tryAgain', game.scenario)">
        <RotateCcw /> Try again</button
      ><button @click="emit('continueUnscored')">Continue unscored</button
      ><button @click="emit('openLeaderboard')">Leaderboard</button
      ><button @click="emit('mainMenu')">Main menu</button>
    </div>
  </div>
</template>
