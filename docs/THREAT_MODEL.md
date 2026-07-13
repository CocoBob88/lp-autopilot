# Threat model

## Assets and privileged operations

LP NFTs, ERC-20 balances/allowances, native gas, automation keys, authenticated workflow authority, transaction nonces, and indexed accounting are in scope. Privileged operations are Position Manager collect/increase/decrease/mint/burn, bounded ERC-20 approvals, explicit router swaps, automation activation, breaker reset, and notification configuration.

## Principal threats and controls

| Threat                       | Control                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong chain or contract      | Exact chain assertion; reviewed per-chain manifest; current bytecode/token/Factory/pool immutable checks; testnet fail-closed.                                              |
| Malicious candidate NFT/pool | Blockscout is discovery only; `ownerOf`, `positions`, Factory `getPool`, pool bytecode and immutables are authoritative.                                                    |
| Approval drain               | Exact/bounded approvals, visible approval steps, reviewed spender, JIT simulation, allowance reconciliation.                                                                |
| Stale price/calldata         | Quote block/time, deadline, maximum age, TWAP/deviation policy; dependent steps rebuilt after confirmations.                                                                |
| Oracle/spot manipulation     | Value-moving strategy actions require reviewed TWAP and spot/TWAP deviation bounds; single-block spot never authorizes.                                                     |
| Duplicate execution          | User/chain-scoped stable key, canonical request hash, unique constraints, per-signer nonce lease, submitted-hash checkpoint.                                                |
| Receipt timeout/reorg        | Submitted remains submitted; reconcile by hash; canonical block-hash check; index rollback/replay.                                                                          |
| Bot runaway                  | Dedicated signer, explicit activation, selector/action scope, per-execution/day budgets, cooldown/count caps, wallet/position/global switches, consecutive-failure breaker. |
| Key theft                    | Browser keys never cross boundary; development keys encrypted with AES-256-GCM; production KMS/HSM recommended; secrets redacted.                                           |
| Signature replay             | EIP-712 chain/domain/URI/address/nonce/expiry binding; nonce stored hashed and consumed once.                                                                               |
| CSRF/session theft           | SameSite secure HTTP-only session cookie, separate matching CSRF token, 12-hour expiry, CSP and no unsafe HTML.                                                             |
| RPC equivocation/outage      | Authenticated primary plus independent fallback required for high-value production; health/lag signals; affected execution fails closed.                                    |
| Index corruption             | Raw logs, decoder versioning, unique event identity, cursor/hash overlap, deterministic replay.                                                                             |
| Token deviation              | Actual decimals always read; nonstandard behavior is a reviewed prerequisite; final balance/event reconciliation.                                                           |
| Metadata/XSS                 | No token HTML/SVG rendering; symbols/names render as React text; strict CSP.                                                                                                |

## Residual risk

Uniswap V3, Robinhood Chain, RPC/Blockscout, database, notification providers, the user wallet, token behavior, and any production key-management platform remain external trust dependencies. The software is not an audit of those systems. Rebalance and compound are non-atomic and may leave funds in the wallet after a partial workflow; durable recovery is the mitigation, not a claim of atomicity.
