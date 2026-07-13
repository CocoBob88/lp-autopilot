# Deployment

Deploy the web application and both workers as three independently supervised processes against one managed PostgreSQL database. Workers must not run inside serverless request handlers.

## Required services

- Node.js 22.15+ web service (Node.js 24 LTS recommended): `npm run db:migrate` during controlled release, then `npm run start`.
- Indexer worker: `npm run worker:indexer` with one active logical consumer per configured stream.
- Strategy worker: `npm run worker:strategy` with process supervision and restricted execution environment.
- PostgreSQL 15+ with TLS, automated backups, point-in-time recovery, least-privilege roles, and migration controls.
- Authenticated Robinhood HTTP RPC, independent fallback, WebSocket for latency, and archive access for backfill/fork tests.
- Optional SMTP/webhook/Discord/Telegram credentials.
- KMS/HSM or reviewed smart-account signer for production automation. Do not use a plaintext environment key.

## Release sequence

Build an immutable artifact; scan dependencies/secrets; back up the database; apply the reviewed migration; deploy web with live gates false; deploy indexer and verify lag/reorg metrics; deploy strategy worker paused; run `/api/health` and read-only validation; exercise authentication, preview, Emergency Stop, and reconciliation; then enable only separately authorized capabilities.

Use HTTPS, secure cookies, same-origin routing, a secrets manager, restricted database/network roles, log redaction, and monitoring for RPC latency/errors, head/indexer lag, simulations/reverts, pending age, nonce contention, replacements, breakers, gas, quote age, price deviation, code/admin changes, and alert delivery.

The bundled `.openai/hosting.json` remains storage-neutral because LP Autopilot requires PostgreSQL and separate workers. A static/read-only Sites preview is not a production deployment of the complete system.
