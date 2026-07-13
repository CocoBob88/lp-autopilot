# Strategy execution runbook

## Activation

Sync and validate the current position; backfill its pool; verify indexer lag; configure a reviewed 30-minute TWAP; choose alert-only first; set raw-token fee thresholds, range distance/width, cooldown, execution count, gas/day, slippage/impact, liquidity, quote age, lag, confirmation, allowed assets, and expiration. New strategies start paused.

Autopilot additionally requires a dedicated signer, secure backup/KMS custody, minimal funding, `AUTOPILOT_ENABLED`, global/network live gates, explicit wallet activation, and a successful one-cycle canary. A browser wallet is never promoted to unattended signing. Unattended execution is intentionally restricted to the single-phase Profit Harvest action; compound, recenter, range, and exit strategies remain alert-only or approval-required because they depend on confirmed intermediate state or change asset exposure.

## Evaluation

The worker validates chain, manifest, owner, pool, position, code, cursor lag, pool liquidity, TWAP availability, spot/TWAP deviation, cooldown/count, and gas budgets. Any stale/inconsistent/missing evidence creates an alert and takes no action. Range Guard, Recenter, and One-Sided Exit remain approval paths when they change exposure or require a post-withdrawal quote.

## Execution

Build a deterministic plan, simulate exact sender/target/calldata/value, acquire the nonce lease, submit, persist the hash before waiting, confirm canonically, reconcile final state, and only then update strategy execution. Compound collection and the final increase are separate confirmed-state phases. Never hide a swap in compound or rebalance.

## Stop and incident response

Pause a strategy for normal control. Use Emergency Stop for suspected compromise, code/proxy change, RPC disagreement, indexer lag breach, price deviation, nonce deadlock, budget anomaly, or repeated failure. Preserve withdrawal/recovery. Reset only after evidence review and root-cause remediation.
