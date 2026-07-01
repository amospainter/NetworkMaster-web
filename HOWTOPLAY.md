# How to Play NetworkMaster

NetworkMaster is an endless network-building survival game. Design a topology,
keep packets flowing, and hold off rising traffic and equipment failure for as
long as you can. Everything runs in your browser — there's no account and no
server; your run and personal best are saved to local storage only.

This guide covers every rule the simulation actually enforces, not just the
basics. If a number here ever looks wrong, `src/game.ts` is the source of
truth — this document is generated from it.

## 1. The objective

Every tick, your **source devices** (PCs, TVs, consoles, phones, tablets)
generate packets that need a path to the **Cloud Edge**. Deliver packets to
score points. If your network drops too many packets in too short a window,
it fails and the run ends. The game has no fixed win condition — the goal is
to survive and score as long as possible against ever-increasing traffic.

## 2. Controls

- **Select** a device or cable — tap/click it. Its inspector opens on the
  right with live stats and available actions.
- **Build** — pick equipment from the BUILD panel on the left (Switch,
  Router, Wireless, Firewall, Server) and pay its cost from your budget. New
  equipment drops in unconnected; drag it into position.
- **Connect devices** — select a device, choose **Begin cable**, then tap the
  destination device. Before confirming, you can toggle the cable's **Style**
  between _Right-angle_ (auto-routed around other equipment) and _Diagonal_
  (a direct line, useful when the auto-router gets crowded).
- **Reroute a cable** — select an existing cable, then **Reroute start** or
  **Reroute end**, then tap the new device. Tier, VLAN, style, and upgrade
  spend are preserved; only the endpoint moves.
- **Drag** any device to reposition it — this can move a wireless client in
  or out of an access point's coverage circle, or shift a hub's zone over new
  devices.
- **Delete** a cable, or **Remove equipment**, from its inspector. You get a
  90% salvage refund on removal (see §7).
- **Pause / Resume** and **1×/2× speed** are in the HUD.
- **Pan** by dragging empty canvas space; **zoom** with the scroll wheel or
  the +/−/Reset buttons docked on the minimap panel.
- **Site Upgrades** (top bar) applies a bulk upgrade to every eligible piece
  of equipment or cable at once, at a 15% discount vs. upgrading one at a
  time (see §7).

## 3. Devices

### End-user (source) devices

| Device  | Wired ports | Traffic priority | Base packet rate/tick | Wi-Fi capable  |
| ------- | ----------- | ---------------- | --------------------- | -------------- |
| PC      | 1           | Bulk             | 1                     | Yes (backup)   |
| TV      | 1           | Stream           | 2                     | Yes (backup)   |
| Console | 1           | Realtime         | 1                     | Yes (backup)   |
| Phone   | 0           | Realtime         | 1                     | **Wi-Fi only** |
| Tablet  | 0           | Stream           | 2                     | **Wi-Fi only** |

- Phones and tablets have no wired ports — they can _only_ connect through an
  access point's coverage circle. Every other end device keeps its wired port
  and can _additionally_ join Wi-Fi coverage: a cabled PC sitting inside an
  access point's range gets a genuine second, independent route to the
  network (useful for the redundancy score bonus, §6).
- A source device with no path — no cable _and_ no in-range access point —
  can't send its generated traffic anywhere; that traffic is simply lost for
  the tick (see §5 for how drops are counted).
- Rate is scaled up over time by the scenario's traffic ramp (§8) and by
  chance events like a traffic spike (§9).

### Infrastructure devices

| Device        | Cost | Wired ports | Base throughput (pkt/tick)    | Notes                                |
| ------------- | ---- | ----------- | ----------------------------- | ------------------------------------ |
| Switch        | $80  | 4           | 8                             | +2 ports / +4 pkt-tick upgrades      |
| Router        | $140 | 8           | 20                            | Only device that may reach the Cloud |
| Wireless (AP) | $90  | 1           | 4 (base, by Wi-Fi generation) | Single uplink port; see §4           |
| Firewall      | $110 | 4           | 12                            | Can block one device kind's traffic  |
| Server        | $120 | 2           | Unlimited                     | A cross-subnet traffic destination   |
| Cloud Edge    | —    | 2           | Unlimited                     | Fixed, present from the start        |

- **Only the router may connect to the Cloud Edge.** Every packet's final
  destination is the cloud (or, for cross-subnet traffic, another device —
  see §5), and the only door to the cloud is through a router.
- **No direct end-device-to-end-device links.** Two source devices always
  need a piece of network equipment between them.
- **Duplicate links are rejected** — you can't run two cables between the
  same pair of devices.
- **Port limits are enforced** on both ends of a link; a device with no free
  ports refuses a new cable.
- Every forwarding device (router, switch, wireless, firewall) admits only as
  many packets per tick as its current throughput allows, and does so in
  **strict priority order**: realtime traffic (phones, consoles) is served
  first, then stream (TVs, tablets), then bulk (PCs, routers/switches'
  onward hops). Packets that don't fit wait in a real queue at that device
  for up to 6 ticks before being dropped — you can see this queue depth live
  in that device's inspector.
- **Equipment wear and failure** (equipment-failure scenarios only, §8):
  overloaded devices accrue wear. Past 20 wear, health starts dropping;
  health hitting 0 takes the device offline. An offline device blinks
  between its normal icon and an unplugged-cable icon on the canvas so it's
  easy to spot, and is excluded from routing entirely. **Field repair** costs
  $40, restores health to 100%, and brings it back online — but accumulated
  wear is _not_ reset, so a repaired device fails faster next time unless you
  also upgrade or replace it.

## 4. Wi-Fi

- An access point's **range** and **base throughput** come from its Wi-Fi
  generation, upgraded independently of everything else:

  | Generation | Range | Base pkt/tick | Upgrade cost |
  | ---------- | ----- | ------------- | ------------ |
  | 802.11b    | 14    | 4             | $40          |
  | 802.11g    | 18    | 8             | $60          |
  | 802.11n    | 22    | 14            | $90          |
  | Wi-Fi 5    | 26    | 22            | $130         |
  | Wi-Fi 6    | 30    | 32            | $180         |
  | Wi-Fi 6E   | 34    | 44            | $240         |
  | Wi-Fi 7    | 40    | 60            | $999 (max)   |

- An access point _also_ has its own **Faster forwarding** upgrade (+2
  pkt/tick for $50, same button router/switch use) that stacks independently
  on top of its Wi-Fi generation — upgrading the generation later adds that
  generation's own jump without erasing the forwarding bonus.
- A wireless-capable device only counts as connected if it's physically
  inside a hub's coverage circle. Multiple hubs' zones can overlap; a client
  in overlapping range **prefers whichever hub currently has fewer
  wireless-capable clients in range** (load balancing), breaking ties by
  distance — not simply the nearest hub.
- Access points have exactly one wired port; they need one uplink cable back
  into your topology (to a switch or router) to actually reach the cloud.
- **Wi-Fi interference** can randomly strike an access point (higher chance
  while it's actively serving clients): for 8–18 ticks its effective range
  drops to 60% and throughput to 50%. The coverage zone and the device
  inspector both flag this while it's active; it clears on its own.

## 5. Routing, VLANs, and firewalls

- Every tick, the simulation finds the shortest available path from each
  source device to the cloud (or a cross-subnet destination) via
  breadth-first search over live cables and in-range Wi-Fi links.
- **Offline devices and failed cables are excluded** from every route.
- **VLAN tags**: cycle a cable through untagged → VLAN 1 → 2 → 3 → 4 →
  untagged. A tagged cable only carries traffic whose source device's subnet
  matches the VLAN — anything else is blocked from crossing that link. This
  lets you segment traffic (e.g. isolate guest devices) at the cost of extra
  planning.
- **Firewall block rules**: a firewall can be set to block PC, TV, or Console
  traffic specifically (cycle through none → PC → TV → Console → none). A
  blocked device's traffic simply can't route across that firewall.
- **Cross-subnet traffic**: in every scenario except Home Network, about 30%
  of generated traffic targets another device on a different subnet (routed
  via the router) instead of the cloud — usually a server. This models
  internal traffic (e.g. desk-to-server) and rewards having more than one
  subnet reachable through your core.
- **Any topology edit** (delete a cable, remove equipment, reroute, retag a
  VLAN, change a firewall rule) immediately clears in-flight packets, since
  their precomputed route may no longer be valid. The next tick rebuilds
  routes from the new topology.

## 6. Scoring

- **Base delivery score**: `10 × score multiplier × combo` for every packet
  delivered.
- **Score multiplier** increases by 1 every 90 ticks, forever.
- **Clean-tick combo**: every 5 consecutive ticks with zero dropped packets
  raises your combo multiplier by 1, up to 5×. Dropping 3+ packets in a
  single tick resets the combo to 1× immediately.
- **Redundancy bonus**: +5 points on top of the base score for any delivered
  packet whose source has **two independent (edge-disjoint) routes** to its
  destination at that moment — i.e., a genuine backup path exists, not just
  the one that happened to be used.
- **Delivery milestones**: each scenario has three cumulative-delivery
  thresholds that pay a one-time budget bonus (not score) the first time you
  cross them — e.g. Home Network pays $50 at 25 deliveries, $100 at 75, $200
  at 150. Harder scenarios have higher thresholds and bigger payouts.
- **Network-health bonus** (paid once, at game over): `round(survivingRatio ×
deliveryRatio × 1000)`, where `survivingRatio` is (currently-connected
  source devices) ÷ (total source devices ever spawned), and `deliveryRatio`
  is (total delivered) ÷ (total generated) across every source device's
  lifetime. A network that stayed intact and kept up with demand scores much
  higher here than one that limped to the finish with half its devices dark.

## 7. Economy

- **Starting budget** and **difficulty** vary by scenario (§8).
- **Passive income**: every 15 ticks you receive `$25 + 5 × current score
multiplier` — income grows as the run goes on.
- **Budget bonus events** (§9) add a flat $75.
- **Delivery milestones** (§6) add a one-time budget award.
- **Removing equipment or a cable** refunds 90% of what you spent on it
  (build cost + every upgrade), rounded down.
- **Site Upgrades** (top bar) bulk-apply an upgrade to every eligible piece
  of equipment or cable at once, for 15% less than upgrading them
  individually:
  - **Cable rollout** — pick a target tier (Fast Ethernet through 100
    Gigabit); every cable below that tier (except the fixed cloud uplink)
    jumps straight to it, paying for every intervening tier per cable.
  - **Port expansion** — +2 ports on every router and switch, $50 each
    before discount.
  - **Switch/access-point throughput** — the same "Faster forwarding" bump
    applied to every switch (or every access point) at once.

## 8. Cable tiers

| Tier          | Capacity (pkt/tick) | Upgrade cost |
| ------------- | ------------------- | ------------ |
| Copper        | 2                   | $50 (base)   |
| Fast Ethernet | 5                   | $90          |
| Gigabit       | 10                  | $150         |
| 5 Gigabit     | 50                  | $220         |
| 10 Gigabit    | 100                 | $320         |
| 25 Gigabit    | 250                 | $460         |
| 50 Gigabit    | 500                 | $650         |
| 100 Gigabit   | 1000                | $999 (max)   |

- A cable's `load` is the number of packets crossing it this tick. Above
  capacity it turns **congested** (orange) and starts dropping the overflow;
  a link left congested long enough under an equipment-failure scenario can
  fail outright and needs 4 ticks to recover (rerouting traffic around it in
  the meantime).
- Every cable shows a live label at its midpoint: its tier/speed on top, and
  current `load/capacity` traffic underneath, colored by status (green
  active, orange congested, red failed).
- The link legend at the bottom of the canvas explains the colors: green =
  active, gray = idle, orange = congested.

## 9. Difficulty, pacing, and scenarios

Every simulation tick (800ms at 1× speed) does, in order:

1. Reset cable load; recover cables whose temporary fault has expired.
2. Advance and (if arrived) deliver in-flight packets, scoring and updating
   latency/queue-delay telemetry.
3. Tally traffic across every cable now carrying packets.
4. Generate new traffic from every source device and resolve routes.
5. Mark cables active/congested and apply forwarding-device capacity limits.
6. Update wear, rolling failure pressure, combo, and passive income; bump
   the score multiplier and traffic rate on their own schedules.
7. Spawn new devices, roll challenge events, apply Wi-Fi interference, check
   milestones, and evaluate game over.

Traffic doesn't start at full intensity — each scenario **eases demand in**
from a starting floor fraction up to 100% over its `warmupTicks`, so you have
a quiet opening window to build. After `rampStart`, the traffic rate climbs
4% every 90 ticks, capping at 2.25× the base rate.

**Challenge events** roll every 90 ticks once a scenario's `challengeStart`
tick is reached:

- **Traffic spike** (35% chance) — doubles one device's demand for 10 ticks.
  Devices with a lower base rate are weighted _more_ likely to be picked.
- **Equipment failure** (equipment-failure scenarios only, up to 35% chance)
  — instantly fails a random online router/switch/access point/firewall,
  weighted toward whichever has accrued the most wear.
- **Budget bonus** (up to 55% chance, or the equipment-failure slice's
  remainder in scenarios without equipment failure) — flat +$75.
- **Device surge** (remaining ~10% chance) — spawns two new source devices
  at once.

New source devices also spawn automatically once `spawnStart` is reached,
every 150 ticks, cycling PC → Phone → Console → Tablet → TV, up to 20 total
devices on the canvas.

**Game over** triggers once you're past the scenario's `gameOverCheck` tick
_and_ the rolling 20-tick drop window exceeds 30 total drops. Failure
pressure (shown in the HUD) is exactly that ratio: `(drops in the last 20
ticks ÷ 30) × 100%`. At game over you can **Try again**, or **Continue
unscored** — the run keeps going (failure pressure resets) but stops paying
into the leaderboard and no further game-over check occurs.

### The eight scenarios

| Scenario       | Difficulty | Budget | Equipment failure | Gist                                                |
| -------------- | :--------: | -----: | :---------------: | --------------------------------------------------- |
| Home Network   |   ★☆☆☆☆    |   $100 |        No         | Small household; learn the basics.                  |
| Startup Office |   ★★☆☆☆    |   $140 |        No         | Two teams share infrastructure.                     |
| Corporate HQ   |   ★★★☆☆    |   $180 |        Yes        | Three subnets, a firewall, aging gear.              |
| Metro Campus   |   ★★★☆☆    |   $200 |        Yes        | Distributed switches, long paths reward redundancy. |
| Branch Network |   ★★★★☆    |   $120 |        Yes        | Tight budget; every port counts.                    |
| ISP Hub        |   ★★★★☆    |   $220 |        Yes        | High-volume routing backbone.                       |
| Arena Night    |   ★★★★☆    |   $240 |        Yes        | Wireless crowd floods access points.                |
| Edge Exchange  |   ★★★★★    |   $260 |        Yes        | Realtime services compete with bulk at the edge.    |

## 10. Reading the HUD and inspectors

- **Score / multiplier**, **Delivered**, **Dropped**, **Combo**, **Budget**,
  and **Failure pressure** (with a live bar) sit across the top.
- **Run Stats** (footer button) adds delivered/dropped totals, clean combo,
  the rolling drop window, traffic ramp, and the two telemetry averages:
  **average delivery latency** (ticks from generation to arrival) and
  **average queue delay** (ticks spent waiting in a forwarding device's
  queue) — both rolling averages weighted 75% history / 25% latest tick.
- **Device inspector** shows status, ports, health/wear, throughput (with a
  live load bar for forwarding devices), delivered/generated, Wi-Fi link
  status, independent-path count, and — for wireless — current Wi-Fi
  generation and interference state.
- **Cable inspector** shows tier, live traffic, status, age, style, and VLAN,
  plus upgrade/reroute/delete actions.
- **Minimap** (canvas corner) gives a always-visible overview of every device
  and cable, plus each access point's coverage outline, regardless of how
  far you've zoomed or panned the main canvas.
- **Live Events** (bottom-left) is a short feed of what just happened,
  each entry timestamped with the tick it occurred on.
- **Jackie**, the advisor (bottom-center), surfaces one contextual tip at a
  time — whichever is most urgent: high failure pressure, a congested link,
  an out-of-range device, low budget, queue buildup, or (if nothing's wrong)
  a note on your current combo streak.

## 11. Personal leaderboard

Every completed run — win or lose — is recorded locally (10 highest scores
kept) with its scenario, score, delivered count, and tick count. Browse it
from the main menu, from Run Stats, or from the game-over screen. There's no
server-side leaderboard; scores never leave your browser.

## 12. Strategy tips

- **Build redundancy before you need it.** A second independent path to the
  cloud (through a different switch/router) both prevents a single failed
  link from taking down a device _and_ pays a small score bonus on every
  delivery that uses it.
- **Watch cable labels, not just colors.** The live `load/capacity` figure
  tells you exactly how much headroom is left before a link turns congested
  — upgrade before it does, not after.
- **Priority matters at every hop, not just the edge.** A congested
  router/switch drops _bulk_ traffic first under strict priority admission;
  if your realtime devices (consoles, phones) are still getting through but
  PCs are queuing, that's the forwarding device's capacity, not the cable.
- **Wi-Fi is now a backup for wired devices too.** Placing an access point
  so it also covers an already-cabled PC or TV gives that device a second
  route for free — no extra cable needed.
- **Don't let repaired equipment lull you.** Field repair resets health, not
  wear — a device you've repaired once will fail faster the next time it's
  overloaded, so pair a repair with an upgrade if you can afford it.
- **Site Upgrades save real money** once you have more than two or three of
  something — the 15% discount adds up fast on a big topology.
- **Read Jackie.** The advisor always tells you the single most urgent thing
  to fix; when in doubt, do what Jackie says next.
