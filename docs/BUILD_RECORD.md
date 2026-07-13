# Build and acceptance record

```yaml
utility:
  name: LP Autopilot
  purpose: noncustodial Uniswap V3 liquidity management for Robinhood Chain
  users: [liquidity providers, operators]
  assets_at_risk:
    [LP NFTs, ERC20 balances and allowances, ETH gas, automation signer funds]
  maximum_value_at_risk: user-configured; autopilot bounded per execution and day
  networks: [robinhood_testnet, robinhood_mainnet]
  onchain_components:
    [
      Uniswap V3 Factory,
      Position Manager,
      pools,
      QuoterV2,
      SwapRouter02,
      Permit2,
      Universal Router,
      WETH,
      USDG,
    ]
  offchain_components:
    [
      Next.js app,
      PostgreSQL,
      indexer worker,
      strategy worker,
      notification adapters,
    ]
  external_protocols: [Robinhood Chain, Uniswap V3, Blockscout]
  privileged_roles:
    [authenticated owner, dedicated automation signer, breaker reset operator]
  upgradeability: none
  custody_model: noncustodial assisted; dedicated encrypted/KMS autopilot optional
  automation: true
  required_data_sources: [Robinhood RPC, Blockscout, pool TWAP, PostgreSQL]
  failure_recovery_owner: authenticated operator
  legal_or_compliance_review_required: depends on jurisdiction, assets, and deployment
```

Mainnet validation on 2026-07-13 observed chain 4663 at block 8,761,913; every manifest address had bytecode and its code hash was recorded; WETH was WETH/18; USDG was USDG/6; fee tiers 500/3000/10000 returned tick spacings 10/60/200; writes were disabled; broadcasts: zero.

Executed locally: Prisma schema validation/client generation/migration SQL generation, ESLint, TypeScript, formatting, 20 unit/property tests (including 3,000 fuzz/property cases and range-simulation invariants), two opt-in read-only mainnet integration checks covering contract validation, active-farm discovery, and exact mint-plan construction, live mainnet manifest validation, the Next.js production build, and the Sites compatibility build under Node.js 24. The public scanner returned 36 factory-verified active pools and its full-chain WETH contract search returned 33 pools. The full dependency audit reported zero vulnerabilities. Database integration is conditional on `TEST_DATABASE_URL`; testnet/fork execution requires user-provided RPC/archive infrastructure and verified testnet dependencies. No test enables live writes or broadcasts a transaction.
