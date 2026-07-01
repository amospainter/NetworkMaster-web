<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { BUILD_OPTIONS, deviceIcons } from '../deviceIcons'
import type { DeviceKind } from '../types'

defineProps<{
  budget: number
}>()

const emit = defineEmits<{
  place: [kind: DeviceKind]
}>()
</script>

<template>
  <aside class="build-panel">
    <div class="panel-title"><Plus /> BUILD</div>
    <button
      v-for="[kind, label, cost] in BUILD_OPTIONS"
      :key="kind"
      :disabled="budget < cost"
      @click="emit('place', kind)"
    >
      <component :is="deviceIcons[kind]" /><span
        >{{ label }}<small>${{ cost }}</small></span
      >
    </button>
  </aside>
</template>
