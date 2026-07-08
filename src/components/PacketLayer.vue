<script setup lang="ts">
import { computed } from 'vue'
import { pointAlongRoute, type CableRoute } from '../cableGeometry'
import type { Cable, Device, Packet } from '../types'

const props = defineProps<{
  packets: Packet[]
  devices: Device[]
  cables: Cable[]
  cableRoutes: Map<string, CableRoute>
  /** Smooths a packet's stored progress toward its next hop between simulation ticks. */
  packetVisualProgress: (progress: number) => number
}>()

/** Endpoint-pair lookup rebuilt only when the cable list changes, not per packet per frame. */
const cableByEndpointPair = computed(() => {
  const map = new Map<string, Cable>()
  for (const cable of props.cables) {
    map.set(`${cable.from}|${cable.to}`, cable)
    map.set(`${cable.to}|${cable.from}`, cable)
  }
  return map
})
const deviceById = computed(() => new Map(props.devices.map((device) => [device.id, device])))

/**
 * Maps a packet's stored hop/progress onto the routed geometry of its current
 * cable, falling back to a straight line when no cable is found (e.g. a
 * wireless hop, which has no routed polyline of its own).
 *
 * @param activePacket - Packet to position.
 * @returns Interpolated normalized canvas position.
 */
function packetPosition(activePacket: Packet): { x: number; y: number } {
  const currentDeviceId = activePacket.path[activePacket.hop]
  const nextDeviceId = activePacket.path[activePacket.hop + 1]
  const progress = props.packetVisualProgress(activePacket.progress)
  const networkCable = cableByEndpointPair.value.get(`${currentDeviceId}|${nextDeviceId}`)
  if (!networkCable) {
    const currentDevice = deviceById.value.get(currentDeviceId)
    const nextDevice = deviceById.value.get(nextDeviceId)
    if (!currentDevice || !nextDevice) return { x: 0, y: 0 }
    return {
      x: currentDevice.x + (nextDevice.x - currentDevice.x) * progress,
      y: currentDevice.y + (nextDevice.y - currentDevice.y) * progress,
    }
  }
  const route = props.cableRoutes.get(networkCable.id)
  if (!route) return { x: 0, y: 0 }
  const points = networkCable.from === currentDeviceId ? route.points : [...route.points].reverse()
  return pointAlongRoute(points, progress)
}

/**
 * Recomputed every animation frame via `packetVisualProgress`'s dependency on
 * the shared clock ref. Isolating that dependency inside this leaf component
 * keeps the rest of the canvas (devices, cables, inspector) from re-rendering
 * at 60fps along with it.
 */
const renderedPackets = computed(() =>
  props.packets.map((activePacket) => ({
    packet: activePacket,
    pos: packetPosition(activePacket),
  })),
)
</script>

<template>
  <i
    v-for="{ packet, pos } in renderedPackets"
    :key="packet.id"
    class="packet"
    :class="[packet.priority, { 'firewall-drop': packet.droppingAtFirewall, junk: packet.junk }]"
    :style="{ left: pos.x + '%', top: pos.y + '%' }"
  />
</template>
