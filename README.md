# LP Autopilot

Public Uniswap V3 farm discovery, range simulation, and wallet-assisted liquidity creation for Robinhood Chain. LP Autopilot is not affiliated with or endorsed by Robinhood.

The application discovers position NFTs from Blockscout inventory, then independently validates every candidate on-chain with `ownerOf`, `positions`, Factory `getPool`, pool immutables/state, bytecode, and token metadata. It never ships portfolio fixtures or fallback balances. A missing wallet, oracle, database, or indexed history appears as an explicit unavailable state.

## What is implemented

- A public, wallet-free farm scanner that identifies recently active pools, validates each pool against the reviewed V3 Factory, refreshes every 75 seconds, and supports symbol/name filtering plus full-chain token-contract search.
- Live pool and token metrics including fee tier, reserves, token price paths, TVL, rolling swap activity, projected 24-hour volume/fees, sample-derived pool APR, price movement, and explicit liquidity/activity/pricing risk signals.
- A configurable concentrated-range simulator for deposit value, lower/upper price bounds, aligned ticks, token split, projected liquidity share, observed in-range activity, capital efficiency, annual fees, and range-specific APR.
- A wallet-assisted creation flow that verifies the pool and balances, constructs exact bounded ERC-20 approvals and Position Manager `mint` calldata, simulates every currently executable step, and submits only after an explicit wallet confirmation.
- Watch-only public address inspection and EIP-1193 assisted wallet authentication using nonce-bound EIP-712 signatures.
- Runtime mainnet manifest validation for chain ID, bytecode, WETH/USDG identities, and the `500`, `3000`, and `10000` fee tiers.
- Accurate bigint V3 tick, price orientation, range-state, liquidity-amount, decimal, and slippage math.
- Static fee collection previews from the actual owner at the current validated block.
- Collect, increase, partial/full removal, compound, rebalance, and empty-NFT burn planners with exact calldata, bounded approvals, gas estimates, simulation, visible multi-step boundaries, stable workflow keys, and canonical request hashes.
- Browser-assisted submission checkpointing, canonical receipt/reorg checks, confirmation tracking, final position reconciliation, and confirmed-state continuation planning.
- PostgreSQL/Prisma schema and migration for users, wallets/permissions, tokens, pools, positions/snapshots/events, swaps, strategies/executions, workflows/steps/submissions, nonce leases, circuit breakers, alerts, cursors, manifests, and code observations.
- Separate reorg-safe indexer and strategy workers. The strategy worker requires a 30-minute V3 TWAP, indexer freshness, pool-liquidity, quote-age, execution-count, slippage/impact, gas, and daily-budget policies.
- Alert-only and approval-required strategies plus gated dedicated-wallet autopilot execution for single-phase profit harvest. Multi-phase compound/recenter and exposure-changing actions require review and approval. Local development custody uses AES-256-GCM; production should use KMS/HSM or a reviewed smart-account/session-key implementation.
- In-app, generic webhook, Discord, Telegram, and SMTP notification adapters.
- Global, wallet, and position circuit-breaker primitives and an authenticated Emergency Stop that leaves read/recovery/withdrawal planning available.

Automated and existing-position workflow writes remain disabled unless both `ALL_LIVE_TRANSACTIONS_ENABLED=true` and `ROBINHOOD_MAINNET_WRITES_ENABLED=true`. The public creation planner never broadcasts; a connected user may submit its visible approval/mint steps only through explicit wallet confirmations. Tests and read-only validation do not submit transactions.

## Quick start

1. Install Node.js 22.15+ (Node.js 24 LTS recommended). Docker is needed only for durable portfolio/strategy services.
2. Copy `.env.example` to `.env.local`, replace `SESSION_SECRET`, and keep live-write gates false.
3. Run `npm ci` and start the public scanner with `npm run dev`.
4. For saved portfolios and automations, start PostgreSQL with `docker compose up -d postgres`, then run `npm run db:generate` and `npm run db:migrate`.
5. Start the optional durable processes with `npm run worker:indexer` and `npm run worker:strategy`.

Production requires an authenticated primary RPC, an independent fallback/archive provider, managed PostgreSQL, durable worker processes, and notification/signer credentials for the adapters being enabled. Testnet execution additionally requires a separately reviewed chain-46630 contract manifest; mainnet addresses are never reused by default.

## Verification

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run validate:mainnet
```

`RUN_MAINNET_READ_TESTS=true` enables the read-only live manifest suite. `TEST_DATABASE_URL` enables database uniqueness tests. A Robinhood latest-state Anvil fork requires Foundry plus an authenticated archive RPC and is intentionally external to the default zero-broadcast suite.

## Architecture

```text
Browser wallet / watch address
        |
Next.js App Router + EIP-712 session + CSRF/rate policy
        |
Read -> validate -> deterministic plan -> exact simulation -> authorization
        |
checkpoint hash -> confirm canonical receipt -> reconcile final state
        |
Robinhood RPC / Blockscout / reviewed Uniswap V3 contracts

Parallel durable lanes: PostgreSQL workflow ledger, reorg-safe indexer,
strategy/TWAP worker, nonce leases, circuit breakers, notifications.
```

The planner never constructs dependent rebalance/compound calldata before the preceding transaction is confirmed and reconciled. A fresh continuation workflow is generated from actual `Collect` receipt amounts and current balances/allowances.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Mainnet safety runbook](docs/MAINNET_SAFETY_RUNBOOK.md)
- [Strategy execution runbook](docs/STRATEGY_EXECUTION_RUNBOOK.md)
- [Stuck transaction and recovery](docs/STUCK_TRANSACTION_RECOVERY_RUNBOOK.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Build and acceptance record](docs/BUILD_RECORD.md)

## Explicit boundaries

- No specific Robinhood testnet Uniswap deployment is assumed. Testnet position/write functionality fails closed until a manifest is reviewed.
- Fiat valuation, realized/unrealized P&L, impermanent loss, historical fee APR, and pool volume require sufficient canonical position/swap history and a reviewed price source. The UI does not infer or fabricate them.
- Email/webhook/Telegram/Discord delivery requires user-supplied credentials.
- Autopilot requires a deliberately created dedicated signer, funded gas, explicit wallet/strategy activation, server gates, budgets, and worker deployment. Creating a wallet never enables it.
- No mainnet broadcast has been authorized or performed by the included validation commands.
