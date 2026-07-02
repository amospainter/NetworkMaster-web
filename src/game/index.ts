/**
 * Public API barrel for the gameplay engine. Kept intentionally explicit
 * (rather than `export *`) so this file documents exactly what App.vue and
 * the test suite may depend on; internals stay in their owning module.
 */

export {
  CABLE_TIERS,
  FORWARDING_SPEED_COSTS,
  FORWARDING_SPEED_GAIN,
  SCENARIOS,
  WIRELESS_CAPABLE_KINDS,
} from './constants'

export { migrateSavedGame, networkHealthBonus, newGame } from './persistence'

export { deviceCapacity, hubPps, hubRange, servingWirelessHub, wifiInfo } from './wireless'

export { findRoute, independentPathCount } from './routing'

export { simulate } from './simulate'

export {
  addCable,
  buildDevice,
  cycleCableVlan,
  cycleFirewallRule,
  deleteCable,
  deviceRemovalRefund,
  moveDevice,
  removeDevice,
  rerouteCable,
} from './topology'

export {
  repairDevice,
  siteCableUpgradeFullCost,
  siteCableUpgradeTargets,
  upgradeAllCables,
  upgradeAllPorts,
  upgradeAllSwitchSpeed,
  upgradeCable,
  upgradeDevicePorts,
  upgradeDeviceSpeed,
  upgradeWifi,
} from './upgrades'
