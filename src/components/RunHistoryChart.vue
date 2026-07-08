<script setup lang="ts">
import { computed } from 'vue'
import type { HistorySample } from '../types'

const props = defineProps<{
  history: HistorySample[]
}>()

/**
 * Builds a normalized (0-1) SVG polyline points string for one series.
 *
 * @param values - Raw sample values in chart order.
 * @returns An SVG `points` attribute value, or an empty string with fewer than two samples.
 */
function seriesPoints(values: number[]): string {
  if (values.length < 2) return ''
  const max = Math.max(...values, 1)
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 100 - (value / max) * 100
      return `${x},${y}`
    })
    .join(' ')
}

const scorePoints = computed(() => seriesPoints(props.history.map((sample) => sample.s)))
const failurePoints = computed(() => seriesPoints(props.history.map((sample) => sample.f)))
const latencyPoints = computed(() => seriesPoints(props.history.map((sample) => sample.l)))
const finalScore = computed(() => props.history.at(-1)?.s ?? 0)
const peakFailure = computed(() => Math.max(0, ...props.history.map((sample) => sample.f)))
const peakLatency = computed(() => Math.max(0, ...props.history.map((sample) => sample.l)))
</script>

<template>
  <div class="run-history-chart">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-svg">
      <polyline class="series-score" :points="scorePoints" />
      <polyline class="series-failure" :points="failurePoints" />
      <polyline class="series-latency" :points="latencyPoints" />
    </svg>
    <div class="chart-legend">
      <span class="legend-item score">Score · final {{ finalScore.toLocaleString() }}</span>
      <span class="legend-item failure"
        >Failure pressure · peak {{ Math.round(peakFailure) }}%</span
      >
      <span class="legend-item latency">Latency · peak {{ peakLatency.toFixed(1) }} ticks</span>
    </div>
  </div>
</template>

<style scoped>
.run-history-chart {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.chart-svg {
  width: 100%;
  height: 140px;
  background: var(--panel, rgba(127, 127, 127, 0.08));
  border-radius: 8px;
}
.chart-svg polyline {
  fill: none;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.series-score {
  stroke: var(--accent, #4f8cff);
}
.series-failure {
  stroke: var(--danger, #e05555);
}
.series-latency {
  stroke: var(--warn, #d9a441);
}
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.8rem;
}
.legend-item::before {
  content: '';
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
  margin-right: 0.35rem;
}
.legend-item.score::before {
  background: var(--accent, #4f8cff);
}
.legend-item.failure::before {
  background: var(--danger, #e05555);
}
.legend-item.latency::before {
  background: var(--warn, #d9a441);
}
</style>
