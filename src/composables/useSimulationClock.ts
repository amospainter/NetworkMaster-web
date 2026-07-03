import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { simulate } from '../game'
import type { GameState } from '../types'

/**
 * Drives the simulation tick — 800ms at 1x, scaled by `game.speed` (0.5x-3x)
 * — and the requestAnimationFrame clock used to smoothly interpolate packet
 * positions between discrete ticks. Owns its own timers; call once from the
 * root component's setup so `onMounted`/`onBeforeUnmount` register correctly.
 *
 * @param game - Reactive current game state.
 * @param screen - Reactive application screen.
 * @returns Clock state, interval calculation, and packet interpolation helper.
 */
export function useSimulationClock(game: Ref<GameState | null>, screen: Ref<'menu' | 'game'>) {
  let simulationTimer: number | undefined
  let animationFrame: number | undefined
  const animationTime = ref(performance.now())
  const lastSimulationTickTime = ref(performance.now())

  /**
   * Returns the current wall-clock duration of one simulation tick.
   *
   * @returns Tick duration in milliseconds at the selected simulation speed.
   */
  const simulationInterval = () => 800 / (game.value?.speed ?? 1)

  /**
   * Keeps the browser timer synchronized with pause and speed controls.
   *
   * @returns Nothing; the active interval is replaced or cleared.
   */
  const synchronizeSimulationTimer = () => {
    clearInterval(simulationTimer)
    lastSimulationTickTime.value = performance.now()
    if (game.value && screen.value === 'game' && game.value.phase === 'playing') {
      simulationTimer = window.setInterval(() => {
        if (game.value) {
          lastSimulationTickTime.value = performance.now()
          game.value = simulate(game.value)
        }
      }, simulationInterval())
    }
  }
  watch([() => game.value?.phase, () => game.value?.speed, screen], synchronizeSimulationTimer, {
    immediate: true,
  })

  /**
   * Smoothly advances visual packet progress between discrete simulation ticks.
   *
   * @param simulationProgress - Packet progress stored by the simulation.
   * @returns Interpolated progress capped below the next hop boundary.
   */
  function packetVisualProgress(simulationProgress: number): number {
    if (game.value?.phase !== 'playing') return simulationProgress
    const elapsed = animationTime.value - lastSimulationTickTime.value
    const tickFraction = Math.max(0, Math.min(1, elapsed / simulationInterval()))
    return Math.min(0.999, simulationProgress + tickFraction * 0.5)
  }

  onMounted(() => {
    /**
     * Refreshes the interpolation clock and schedules the next animation frame.
     *
     * @param timestamp - Animation-frame timestamp in milliseconds.
     * @returns Nothing; animation clock state is updated.
     */
    const updateAnimationClock = (timestamp: number) => {
      animationTime.value = timestamp
      animationFrame = requestAnimationFrame(updateAnimationClock)
    }
    animationFrame = requestAnimationFrame(updateAnimationClock)
  })

  onBeforeUnmount(() => {
    clearInterval(simulationTimer)
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
  })

  return { animationTime, lastSimulationTickTime, simulationInterval, packetVisualProgress }
}
