import {
  Cloud,
  DatabaseZap,
  Gamepad2,
  Magnet,
  Monitor,
  Network,
  RadioTower,
  Radio,
  Scale,
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
  loadBalancer: Scale,
  honeypot: Magnet,
  cache: DatabaseZap,
  repeater: RadioTower,
}

/** Buildable equipment kinds, their button label, base cost, gameplay purpose, and panel group. */
export const BUILD_OPTIONS: [DeviceKind, string, number, string, 'core' | 'specialist'][] = [
  [
    'switch',
    'Switch',
    80,
    'Connects wired devices on the same network. Use it to add ports and expand your local network.',
    'core',
  ],
  [
    'router',
    'Router',
    140,
    'Routes traffic between networks. Use it to connect network segments and create alternate paths.',
    'core',
  ],
  [
    'wireless',
    'Wireless',
    90,
    'Provides Wi-Fi access for wireless devices. Use it to connect phones, tablets, and other mobile clients.',
    'core',
  ],
  [
    'firewall',
    'Firewall',
    110,
    'Filters malicious network traffic. Use it to protect devices and reduce security threats.',
    'core',
  ],
  [
    'server',
    'Server',
    120,
    'Provides services to network clients. Use it to handle demand and generate revenue.',
    'core',
  ],
  [
    'loadBalancer',
    'Load Balancer',
    150,
    'Distributes traffic across available paths. Use it to prevent overload and improve reliability.',
    'specialist',
  ],
  [
    'honeypot',
    'Honeypot',
    70,
    'Lures and absorbs DDoS junk traffic away from your real devices during an attack. Inert otherwise.',
    'specialist',
  ],
  [
    'cache',
    'Cache',
    130,
    'Serves bulk/stream traffic on its own subnet locally instead of round-tripping to the Cloud Edge.',
    'specialist',
  ],
  [
    'repeater',
    'Repeater',
    50,
    "Extends a nearby access point's Wi-Fi coverage into a second zone, at a small latency cost.",
    'specialist',
  ],
]
