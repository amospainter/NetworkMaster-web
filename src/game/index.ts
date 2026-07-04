/**
 * Public API barrel for the gameplay engine. Kept intentionally explicit
 * (rather than `export *`) so this file documents exactly what App.vue and
 * the test suite may depend on; internals stay in their owning module.
 */

/** Scenario catalogs and shared upgrade constants consumed by the application shell. */
export {
  CABLE_TIERS,
  FORWARDING_SPEED_COSTS,
  FORWARDING_SPEED_GAIN,
  SALVAGE_RATE,
  SCENARIOS,
  WIRELESS_CAPABLE_KINDS,
} from './constants'

/** Run creation, score finalization, and persisted-save migration. */
export { migrateSavedGame, networkHealthBonus, newGame } from './persistence'

/** Starting-topology construction, used by `newGame` and the menu's per-scenario preview diagrams. */
export { createScenarioTopology } from './factories'

/** Effective wireless capabilities and client-to-access-point resolution. */
export {
  buildWirelessAssociations,
  deviceCapacity,
  hubPps,
  hubRange,
  servingWirelessHub,
  wifiInfo,
} from './wireless'

/** Operational pathfinding and redundancy inspection. */
export { findRoute, independentPathCount } from './routing'

/** Pure one-tick simulation reducer. */
export { simulate } from './simulate'

/** Player topology mutations and their validation/economy rules. */
export {
  addCable,
  buildDevice,
  cycleCableVlan,
  deleteCable,
  deviceRemovalRefund,
  moveDevice,
  removeDevice,
  rerouteCable,
  toggleFirewallRule,
} from './topology'

/** Individual and site-wide equipment upgrade operations. */
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
