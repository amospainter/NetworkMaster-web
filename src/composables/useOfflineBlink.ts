import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Drives the offline-device icon swap; data-driven (not CSS-animation-driven)
 * so only devices with `.offline === true` ever toggle between their normal
 * icon and the unplugged-cable icon. See CLAUDE.md for why this replaced an
 * earlier CSS `animation` approach.
 *
 * @returns Reactive visibility state for offline-device icons.
 */
export function useOfflineBlink() {
  const offlineBlinkOn = ref(true)
  let offlineBlinkTimer: number | undefined

  onMounted(() => {
    offlineBlinkTimer = window.setInterval(() => {
      offlineBlinkOn.value = !offlineBlinkOn.value
    }, 800)
  })

  onBeforeUnmount(() => {
    clearInterval(offlineBlinkTimer)
  })

  return { offlineBlinkOn }
}
