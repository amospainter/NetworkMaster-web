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
</script>

<template>
  <aside class="build-panel">
    <div class="panel-title"><Plus /> BUILD</div>
    <button
      v-for="[kind, label, cost] in BUILD_OPTIONS"
      :key="kind"
      :disabled="budget < cost"
      :class="{ active: activeKind === kind }"
      @click="emit('select', kind)"
    >
      <component :is="deviceIcons[kind]" /><span
        >{{ label }}<small :class="{ 'danger-text': budget < cost }">${{ cost }}</small></span
      >
    </button>
  </aside>
</template>
