import { computed, ref, type Ref } from 'vue'
import type { DeviceKind } from '../types'

const ZOOM_MIN = 0.6
const ZOOM_MAX = 2.5

/**
 * Wheel-to-zoom / drag-to-pan state for the topology canvas. Pan is ignored
 * while a cable is being drawn/rerouted or a build tool is armed, since those
 * interactions repurpose pointer drags for a different purpose.
 */
export function useCanvasPanZoom(
  cableStart: Ref<string | null>,
  reroutingCable: Ref<{ cableId: string; movingFromEnd: boolean } | null>,
  placingKind: Ref<DeviceKind | null>,
) {
  const zoom = ref(1)
  const panX = ref(0)
  const panY = ref(0)
  const canvasTransform = computed(
    () => `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
  )
  let activePan: { startX: number; startY: number; originX: number; originY: number } | null = null

  /** Starts a background drag-to-pan; ignored while drawing/rerouting a cable or placing equipment. */
  function startCanvasPan(event: PointerEvent) {
    if (cableStart.value || reroutingCable.value || placingKind.value) return
    activePan = {
      startX: event.clientX,
      startY: event.clientY,
      originX: panX.value,
      originY: panY.value,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function moveCanvasPan(event: PointerEvent) {
    if (!activePan) return
    panX.value = activePan.originX + (event.clientX - activePan.startX)
    panY.value = activePan.originY + (event.clientY - activePan.startY)
  }
  function endCanvasPan() {
    activePan = null
  }
  function zoomBy(delta: number) {
    zoom.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom.value + delta))
  }
  /** Wheel-to-zoom, centered visually since the stage transform scales from its center. */
  function handleCanvasWheel(event: WheelEvent) {
    event.preventDefault()
    zoomBy(event.deltaY > 0 ? -0.15 : 0.15)
  }
  function resetView() {
    zoom.value = 1
    panX.value = 0
    panY.value = 0
  }

  return {
    zoom,
    panX,
    panY,
    canvasTransform,
    startCanvasPan,
    moveCanvasPan,
    endCanvasPan,
    zoomBy,
    handleCanvasWheel,
    resetView,
  }
}
