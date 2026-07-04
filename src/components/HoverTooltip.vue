<script setup lang="ts">
defineProps<{
  x: number
  y: number
  title: string
  rows: { label: string; value: string }[]
}>()
</script>

<template>
  <div class="hover-tooltip" :style="{ left: x + 'px', top: y + 'px' }">
    <b class="hover-tooltip-title">{{ title }}</b>
    <div v-for="row in rows" :key="row.label" class="hover-tooltip-row">
      <span>{{ row.label }}</span
      ><b>{{ row.value }}</b>
    </div>
  </div>
</template>
