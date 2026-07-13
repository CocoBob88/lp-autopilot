# Architecture

LP Autopilot is a Next.js App Router application with PostgreSQL/Prisma persistence and two independent durable workers. Route handlers validate HTTP inputs with Zod and delegate to chain/domain modules; React components do not define contract addresses or authoritative math.

## Trust boundaries

1. The browser owns assisted-wallet signing. The server never receives a browser private key.
2. EIP-712 login binds wallet, nonce, URI, expiry, chain, and the reviewed Position Manager domain. Nonces are hashed, expiring, and single-use; sessions use secure HTTP-only cookies and write routes require the matching CSRF token.
3. The runtime manifest is revalidated against current chain ID, bytecode, token identities, and Factory fee tiers. Testnet has no implicit manifest.
4. Blockscout is only a candidate inventory source. RPC `ownerOf`, position fields, Factory resolution, pool immutables/code/state, and token metadata decide whether a position is accepted.
5. PostgreSQL is the durable source for workflows, submissions, cursors, breakers, strategies, alerts, and indexed history. WebSocket or UI state is never durable truth.

## Write pipeline

`scope → chain/manifest → current position/pool/tokens → deterministic request hash → policy → exact simulation → explicit authorization → nonce lease → submit → immediate hash checkpoint → canonical confirmations → receipt/event/state reconciliation`

Compound and rebalance are recoverable multi-step workflows. The first transaction collects/withdraws. Only after the canonical receipt is reconciled does the system build approvals, an optional separately confirmed balancing swap, and `increaseLiquidity`/`mint`. Old calldata is never replayed after partial completion.

## Indexing

The indexer maintains a cursor per chain/stream/contract, queries bounded ranges, halves rejected ranges, stores raw logs and decoder version, deduplicates by `(chainId, transactionHash, logIndex)`, checks finalized block hashes, rolls back by overlap on reorg, and backfills over HTTP. Position Manager transfers drive candidate ownership refresh; known pools drive Swap history.

## Custody

- Watch-only: no signing.
- Assisted: EIP-1193 wallet confirms every transaction and approval.
- Autopilot: only an explicitly created dedicated wallet. Local AES-256-GCM is a development option. Production uses KMS/HSM or reviewed smart accounts/session keys.

There are no custom smart contracts in this project, so Foundry contract tests are not required. Latest-state fork execution is an external test tier requiring Foundry/Anvil and an archive RPC.
