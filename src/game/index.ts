/**
 * Public API barrel for the gameplay engine. Kept intentionally explicit
 * (rather than `export *`) so this file documents exactly what App.vue and
 * the test suite may depend on; internals stay in their owning module.
 */

/** Scenario catalogs and shared upgrade constants consumed by the application shell. */
export {
  CABLE_TIERS,
  CACHE_HIT_CHANCE,
  CACHE_HIT_RATE_COST,
  CACHE_HIT_RATE_MAX,
  CACHE_HIT_RATE_STEP,
  FORWARDING_KINDS,
  FORWARDING_SPEED_COSTS,
  FORWARDING_SPEED_GAIN,
  OUTAGE_RADIUS,
  PEAK_PERIOD_TICKS,
  QOS_BOOST_CYCLE,
  QOS_OVERHEAD,
  REPEATER_RANGE,
  SALVAGE_RATE,
  SCENARIOS,
  SLA_DECISION_TICKS,
  SLA_GRACE,
  UPS_COST,
  UPS_ELIGIBLE_KINDS,
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
  isServedViaRepeater,
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
  cycleQosBoost,
  deleteCable,
  deviceRemovalRefund,
  moveDevice,
  removeDevice,
  rerouteCable,
  toggleFirewallRule,
} from './topology'

/** Individual and site-wide equipment upgrade operations. */
export {
  acceptSlaContract,
  declineSlaContract,
  repairDevice,
  siteCableUpgradeFullCost,
  siteCableUpgradeTargets,
  upgradeAllCables,
  upgradeAllPorts,
  upgradeAllSwitchSpeed,
  upgradeCable,
  upgradeCacheHitRate,
  upgradeDevicePorts,
  upgradeDeviceSpeed,
  upgradeUps,
  upgradeWifi,
} from './upgrades'
