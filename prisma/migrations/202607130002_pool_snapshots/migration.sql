-- Store the latest scanner metrics with each catalogued pool so the public
-- scanner can render from Postgres without waiting for RPC aggregation.
ALTER TABLE "Pool"
ADD COLUMN "snapshot" JSONB,
ADD COLUMN "snapshotAt" TIMESTAMP(3);

CREATE INDEX "Pool_chainId_snapshotAt_idx" ON "Pool"("chainId", "snapshotAt");
