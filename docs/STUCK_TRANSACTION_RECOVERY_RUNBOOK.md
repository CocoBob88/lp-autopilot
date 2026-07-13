# Stuck transaction and recovery runbook

1. Locate the workflow and its persisted hash/nonce. If a hash exists, never create a new intent or reuse the nonce until reconciliation proves its state.
2. Query the transaction and receipt through the primary and independent fallback. Compare chain ID, block hash, canonical block, sender, target, nonce, calldata/value hash, and status.
3. Pending/unknown: keep `SUBMITTED`, check signer pending nonce and mempool visibility, and do not mark failed on timeout.
4. Replacement: create an explicit same-nonce replacement relationship, preserve both hashes, enforce fee/gas policy, and broadcast only after operator authorization. Do not change intent/calldata while presenting it as a fee replacement.
5. Reverted: record the canonical receipt/reason, refresh all state, trip failure policy as appropriate, and build a new request/workflow key. Never replay reverted stale calldata.
6. Confirmed but database incomplete: mark `RECONCILIATION_REQUIRED`; reconstruct decoded events, NFT owner/liquidity/owed amounts, balances, allowances, and gas from the receipt/current state.
7. Compound/rebalance partial completion: reconcile `Collect`/`DecreaseLiquidity` amounts, then create a fresh continuation workflow from actual wallet balances. Quote any balancing swap separately. Never rerun the confirmed withdrawal/collect.
8. Reorg: remove finality, roll event cursors back by overlap to a canonical ancestor, replay/deduplicate raw logs, and rerun workflow reconciliation.
9. Close only when receipt, ownership, liquidity, balances, allowances, and expected/actual deltas agree. Preserve sanitized evidence.
