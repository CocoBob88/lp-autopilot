# Mainnet safety runbook

1. Keep `ALL_LIVE_TRANSACTIONS_ENABLED=false` and `ROBINHOOD_MAINNET_WRITES_ENABLED=false` during installation, tests, migrations, index backfill, and UI review.
2. Run lint, typecheck, unit/property tests, database tests, read-only validation, and a latest-state Anvil fork. Record block, manifest/code hashes, RPC providers, commit, and zero upstream broadcasts.
3. Configure authenticated primary, independent fallback, and archive RPCs. Require provider agreement for high-value actions.
4. Review Position Manager, Factory, routers, WETH/USDG, supported fees, proxy/admin/code observations, and pool immutables at the intended block.
5. Verify PostgreSQL backups, worker singleton/lease behavior, alert delivery, dashboards, Emergency Stop, and authenticated breaker reset.
6. For automation, use a dedicated minimally funded signer, explicit strategy permissions, strict allowed assets, execution/day gas caps, quote age, TWAP, slippage/impact, liquidity, lag, and confirmation limits.
7. Perform an independently authorized latest-state fork rehearsal of the exact plan. Passing it does not enable mainnet.
8. Obtain fresh explicit authorization for one smallest-safe canary. Enable both environment gates only for the controlled window. Confirm the visible wallet, chain, targets, methods, amounts, approvals, deadline, gas ceiling, and recovery path.
9. Submit once, checkpoint the hash, wait for configured canonical confirmations, reconcile events/ownership/liquidity/balances/allowances, archive evidence, then disable the gates.
10. On any mismatch, stale quote, code change, provider disagreement, timeout, unexpected allowance/balance, or repeated simulation failure: stop. Do not replay or raise slippage blindly. Activate the relevant breaker and follow recovery.

Emergency Stop must disable new execution and automation without disabling reads, reconciliation, or safe withdrawal planning.
