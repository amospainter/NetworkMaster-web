import { computed, ref, type Ref } from 'vue'
import type { DeviceKind } from '../types'

const ZOOM_MIN = 0.6
const ZOOM_MAX = 2.5

/**
 * Wheel-to-zoom / drag-to-pan state for the topology canvas. Pan is ignored
 * while a cable is being drawn/rerouted or a build tool is armed, since those
 * interactions repurpose pointer drags for a different purpose.
 *
 * @param cableStart - Reactive identifier of a cable's pending start device.
 * @param reroutingCable - Reactive description of an active endpoint reroute.
 * @param placingKind - Reactive device kind currently armed for placement.
 * @returns Reactive transform state and canvas gesture handlers.
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
  const activePointers = new Map<number, { x: number; y: number }>()
  let pinchStart: {
    distance: number
    zoom: number
    panX: number
    panY: number
    midpointX: number
    midpointY: number
  } | null = null

  /**
   * Starts a background pan or records the second pointer of a pinch.
   *
   * @param event - Canvas pointer-down event.
   * @returns Nothing; gesture state and pointer capture are updated.
   */
  function startCanvasPan(event: PointerEvent) {
    if (cableStart.value || reroutingCable.value || placingKind.value) return
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointers.size === 2) {
      const [first, second] = [...activePointers.values()]
      pinchStart = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: zoom.value,
        panX: panX.value,
        panY: panY.value,
        midpointX: (first.x + second.x) / 2,
        midpointY: (first.y + second.y) / 2,
      }
      activePan = null
    } else {
      activePan = {
        startX: event.clientX,
        startY: event.clientY,
        originX: panX.value,
        originY: panY.value,
      }
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  /**
   * Updates either a one-pointer pan or a two-pointer, midpoint-anchored pinch.
   *
   * @param event - Canvas pointer-move event.
   * @returns Nothing; reactive pan or zoom state is updated.
   */
  function moveCanvasPan(event: PointerEvent) {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pinchStart && activePointers.size >= 2) {
      const [first, second] = [...activePointers.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const nextZoom = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, pinchStart.zoom * (distance / pinchStart.distance)),
      )
      const scaleChange = nextZoom / pinchStart.zoom
      const canvasBounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const canvasCenterX = canvasBounds.left + canvasBounds.width / 2
      const canvasCenterY = canvasBounds.top + canvasBounds.height / 2
      zoom.value = nextZoom
      // The stage scales around its center. Offset pan by the inverse scale
      // delta so the content beneath the gesture midpoint stays stationary.
      panX.value =
        pinchStart.panX +
        (pinchStart.midpointX - canvasCenterX - pinchStart.panX) * (1 - scaleChange)
      panY.value =
        pinchStart.panY +
        (pinchStart.midpointY - canvasCenterY - pinchStart.panY) * (1 - scaleChange)
      return
    }
    if (!activePan) return
    panX.value = activePan.originX + (event.clientX - activePan.startX)
    panY.value = activePan.originY + (event.clientY - activePan.startY)
  }
  /**
   * Releases pointer gesture state.
   *
   * @param event - Optional pointer event identifying the pointer to release.
   * @returns Nothing; active gesture state is cleared.
   */
  function endCanvasPan(event?: PointerEvent) {
    if (event) activePointers.delete(event.pointerId)
    if (activePointers.size < 2) pinchStart = null
    activePan = null
  }
  /**
   * Applies a bounded zoom increment used by desktop and mobile controls.
   *
   * @param delta - Signed zoom increment.
   * @returns Nothing; the reactive zoom value is updated.
   */
  function zoomBy(delta: number) {
    zoom.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom.value + delta))
  }
  /**
   * Converts a wheel gesture into center-anchored zoom.
   *
   * @param event - Canvas wheel event.
   * @returns Nothing; default scrolling is prevented and zoom is updated.
   */
  function handleCanvasWheel(event: WheelEvent) {
    event.preventDefault()
    zoomBy(event.deltaY > 0 ? -0.15 : 0.15)
  }
  /**
   * Restores the topology stage to its unscaled, centered transform.
   *
   * @returns Nothing; reactive pan and zoom values are reset.
   */
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
