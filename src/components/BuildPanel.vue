<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { BUILD_OPTIONS, deviceIcons } from '../deviceIcons'
import type { DeviceKind } from '../types'

defineProps<{
  budget: number
  activeKind: DeviceKind | null
}>()

const emit = defineEmits<{
  select: [kind: DeviceKind]
}>()

const coreOptions = BUILD_OPTIONS.filter(([, , , , group]) => group === 'core')
const specialistOptions = BUILD_OPTIONS.filter(([, , , , group]) => group === 'specialist')
</script>

<template>
  <aside class="build-panel">
    <div class="panel-title"><Plus /> BUILD</div>
    <div class="build-group-title">Core</div>
    <button
      v-for="[kind, label, cost, description] in coreOptions"
      :key="kind"
      :disabled="budget < cost"
      class="build-tooltip"
      :class="{ active: activeKind === kind }"
      :data-tooltip="description"
      :aria-label="`${label}, $${cost}. ${description}`"
      @click="emit('select', kind)"
    >
      <component :is="deviceIcons[kind]" /><span
        >{{ label }}<small :class="{ 'danger-text': budget < cost }">${{ cost }}</small></span
      >
    </button>
    <div class="build-group-title">Specialist</div>
    <button
      v-for="[kind, label, cost, description] in specialistOptions"
      :key="kind"
      :disabled="budget < cost"
      class="build-tooltip"
      :class="{ active: activeKind === kind }"
      :data-tooltip="description"
      :aria-label="`${label}, $${cost}. ${description}`"
      @click="emit('select', kind)"
    >
      <component :is="deviceIcons[kind]" /><span
        >{{ label }}<small :class="{ 'danger-text': budget < cost }">${{ cost }}</small></span
      >
    </button>
  </aside>
</template>
