<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { Scenario } from '../types'

defineProps<{
  scenario: Scenario
}>()

const emit = defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="emit('dismiss')">
    <div class="modal">
      <div class="modal-titlebar">
        <span>{{ scenario.name }}</span
        ><button class="close" @click="emit('dismiss')"><X /></button>
      </div>
      <div class="modal-body">
        <p class="overline">{{ scenario.eyebrow }}</p>
        <h1>{{ scenario.objective }}</h1>
        <p class="overline">First steps</p>
        <ol>
          <li v-for="step in scenario.firstSteps" :key="step">{{ step }}</li>
        </ol>
        <button class="primary wide" @click="emit('dismiss')">Let's build</button>
      </div>
    </div>
  </div>
</template>
