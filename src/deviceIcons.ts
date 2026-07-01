import {
  Cloud,
  Gamepad2,
  Monitor,
  Network,
  Radio,
  Server,
  Shield,
  Smartphone,
  Tablet,
  Tv,
  Wifi,
} from 'lucide-vue-next'
import type { DeviceKind } from './types'

/** Icon component for each device kind, shared by the canvas, inspector, and build panel. */
export const deviceIcons = {
  cloud: Cloud,
  router: Radio,
  switch: Network,
  pc: Monitor,
  tv: Tv,
  console: Gamepad2,
  phone: Smartphone,
  tablet: Tablet,
  server: Server,
  firewall: Shield,
  wireless: Wifi,
}

/** Buildable equipment kinds, their button label, and their base cost. */
export const BUILD_OPTIONS: [DeviceKind, string, number][] = [
  ['switch', 'Switch', 80],
  ['router', 'Router', 140],
  ['wireless', 'Wireless', 90],
  ['firewall', 'Firewall', 110],
  ['server', 'Server', 120],
]
