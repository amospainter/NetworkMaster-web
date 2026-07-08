import {
  Cloud,
  Gamepad2,
  Magnet,
  Monitor,
  Network,
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
}

/** Buildable equipment kinds, their button label, base cost, and gameplay purpose. */
export const BUILD_OPTIONS: [DeviceKind, string, number, string][] = [
  [
    'switch',
    'Switch',
    80,
    'Connects wired devices on the same network. Use it to add ports and expand your local network.',
  ],
  [
    'router',
    'Router',
    140,
    'Routes traffic between networks. Use it to connect network segments and create alternate paths.',
  ],
  [
    'wireless',
    'Wireless',
    90,
    'Provides Wi-Fi access for wireless devices. Use it to connect phones, tablets, and other mobile clients.',
  ],
  [
    'firewall',
    'Firewall',
    110,
    'Filters malicious network traffic. Use it to protect devices and reduce security threats.',
  ],
  [
    'server',
    'Server',
    120,
    'Provides services to network clients. Use it to handle demand and generate revenue.',
  ],
  [
    'loadBalancer',
    'Load Balancer',
    150,
    'Distributes traffic across available paths. Use it to prevent overload and improve reliability.',
  ],
  [
    'honeypot',
    'Honeypot',
    70,
    'Lures and absorbs DDoS junk traffic away from your real devices during an attack. Inert otherwise.',
  ],
]
