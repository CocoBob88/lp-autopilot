-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WalletMode" AS ENUM ('WATCH_ONLY', 'ASSISTED', 'AUTOPILOT');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('CREATED', 'PLANNED', 'SIMULATED', 'AWAITING_AUTHORIZATION', 'SUBMITTING', 'SUBMITTED', 'CONFIRMING', 'RECONCILIATION_REQUIRED', 'COMPLETED', 'REVERTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StrategyMode" AS ENUM ('ALERT_ONLY', 'APPROVAL_REQUIRED', 'AUTOPILOT');

-- CreateEnum
CREATE TYPE "StrategyKind" AS ENUM ('RANGE_GUARD', 'AUTO_COMPOUND', 'SCHEDULED_COMPOUND', 'RECENTER', 'ONE_SIDED_EXIT', 'PROFIT_HARVEST');

-- CreateEnum
CREATE TYPE "BreakerScope" AS ENUM ('GLOBAL', 'WALLET', 'POSITION');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "primaryAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "mode" "WalletMode" NOT NULL,
    "encryptedPrivateKey" TEXT,
    "encryptionVersion" INTEGER,
    "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "executionDisabled" BOOLEAN NOT NULL DEFAULT false,
    "maxGasPerExecutionWei" DECIMAL(78,0),
    "maxDailyGasWei" DECIMAL(78,0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "codeHash" TEXT,
    "behavior" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "factory" TEXT NOT NULL,
    "token0Id" TEXT NOT NULL,
    "token1Id" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "tickSpacing" INTEGER NOT NULL,
    "codeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "managerAddress" TEXT NOT NULL,
    "tokenId" DECIMAL(78,0) NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "operator" TEXT,
    "walletId" TEXT,
    "poolId" TEXT NOT NULL,
    "token0Id" TEXT NOT NULL,
    "token1Id" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "tickLower" INTEGER NOT NULL,
    "tickUpper" INTEGER NOT NULL,
    "liquidity" DECIMAL(78,0) NOT NULL,
    "tokensOwed0" DECIMAL(78,0) NOT NULL,
    "tokensOwed1" DECIMAL(78,0) NOT NULL,
    "openedAtBlock" DECIMAL(78,0),
    "openedAt" TIMESTAMP(3),
    "lastValidatedBlock" DECIMAL(78,0),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" DECIMAL(78,0) NOT NULL,
    "blockHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "tick" INTEGER NOT NULL,
    "sqrtPriceX96" DECIMAL(78,0) NOT NULL,
    "poolLiquidity" DECIMAL(78,0) NOT NULL,
    "liquidity" DECIMAL(78,0) NOT NULL,
    "amount0" DECIMAL(78,0) NOT NULL,
    "amount1" DECIMAL(78,0) NOT NULL,
    "fees0" DECIMAL(78,0) NOT NULL,
    "fees1" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "PositionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionEvent" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" DECIMAL(78,0) NOT NULL,
    "blockHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "amount0" DECIMAL(78,0),
    "amount1" DECIMAL(78,0),
    "liquidityDelta" DECIMAL(78,0),
    "gasCostWei" DECIMAL(78,0),
    "rawLog" JSONB NOT NULL,
    "decoderVersion" INTEGER NOT NULL DEFAULT 1,
    "timestamp" TIMESTAMP(3),

    CONSTRAINT "PositionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapEvent" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" DECIMAL(78,0) NOT NULL,
    "blockHash" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount0" DECIMAL(78,0) NOT NULL,
    "amount1" DECIMAL(78,0) NOT NULL,
    "sqrtPriceX96" DECIMAL(78,0) NOT NULL,
    "liquidity" DECIMAL(78,0) NOT NULL,
    "tick" INTEGER NOT NULL,
    "rawLog" JSONB NOT NULL,
    "decoderVersion" INTEGER NOT NULL DEFAULT 1,
    "timestamp" TIMESTAMP(3),

    CONSTRAINT "SwapEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kind" "StrategyKind" NOT NULL,
    "mode" "StrategyMode" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minFeeThreshold0" DECIMAL(78,0),
    "minFeeThreshold1" DECIMAL(78,0),
    "rangeWidthBps" INTEGER,
    "triggerDistanceBps" INTEGER,
    "cooldownSeconds" INTEGER NOT NULL,
    "maxExecutionsPerDay" INTEGER NOT NULL,
    "maxGasPerExecutionWei" DECIMAL(78,0) NOT NULL,
    "maxDailyGasWei" DECIMAL(78,0) NOT NULL,
    "maxSlippageBps" INTEGER NOT NULL,
    "maxPriceImpactBps" INTEGER NOT NULL,
    "minPoolLiquidity" DECIMAL(78,0) NOT NULL,
    "maxQuoteAgeSeconds" INTEGER NOT NULL,
    "maxBlockLag" INTEGER NOT NULL,
    "minConfirmations" INTEGER NOT NULL,
    "allowedOutputAssets" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastExecutedAt" TIMESTAMP(3),
    "nextExecutionAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyExecution" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "workflowId" TEXT,
    "triggerBlock" DECIMAL(78,0) NOT NULL,
    "triggerEvidence" JSONB NOT NULL,
    "decision" TEXT NOT NULL,
    "gasCostWei" DECIMAL(78,0),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "StrategyExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "positionId" TEXT,
    "strategyId" TEXT,
    "chainId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'CREATED',
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "quoteBlock" DECIMAL(78,0),
    "quoteTimestamp" TIMESTAMP(3),
    "plan" JSONB,
    "policy" JSONB,
    "expectedDeltas" JSONB,
    "actualDeltas" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'CREATED',
    "requestHash" TEXT NOT NULL,
    "target" TEXT,
    "method" TEXT,
    "calldata" TEXT,
    "valueWei" DECIMAL(78,0),
    "simulation" JSONB,
    "expectedDelta" JSONB,
    "actualDelta" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSubmission" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepId" TEXT,
    "chainId" INTEGER NOT NULL,
    "signerAddress" TEXT NOT NULL,
    "nonce" DECIMAL(78,0) NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "replacementForId" TEXT,
    "status" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receipt" JSONB,
    "confirmedBlock" DECIMAL(78,0),
    "blockHash" TEXT,
    "gasUsed" DECIMAL(78,0),
    "effectiveGasPrice" DECIMAL(78,0),

    CONSTRAINT "TransactionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonceLease" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" DECIMAL(78,0) NOT NULL,
    "ownerToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NonceLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircuitBreaker" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "scope" "BreakerScope" NOT NULL,
    "walletId" TEXT,
    "positionId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "threshold" INTEGER NOT NULL DEFAULT 3,
    "reasonCode" TEXT,
    "activatedAt" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3),
    "resetByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CircuitBreaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "positionId" TEXT,
    "strategyId" TEXT,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveryErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCursor" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "stream" TEXT NOT NULL,
    "contractAddress" TEXT,
    "nextBlock" DECIMAL(78,0) NOT NULL,
    "lastFinalizedBlock" DECIMAL(78,0) NOT NULL,
    "lastFinalizedBlockHash" TEXT NOT NULL,
    "overlapBlocks" INTEGER NOT NULL DEFAULT 20,
    "decoderVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractManifest" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "version" TEXT,
    "deploymentSource" TEXT NOT NULL,
    "explorerUrl" TEXT NOT NULL,
    "expectedCodeHash" TEXT,
    "expectedInterfaces" TEXT[],
    "proxyKind" TEXT,
    "implementationAddress" TEXT,
    "adminAddress" TEXT,
    "reviewedAtBlock" DECIMAL(78,0),
    "reviewedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractCodeObservation" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "blockNumber" DECIMAL(78,0) NOT NULL,
    "blockHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "implementationAddress" TEXT,
    "adminAddress" TEXT,
    "matches" BOOLEAN NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractCodeObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonceHash_key" ON "AuthNonce"("nonceHash");

-- CreateIndex
CREATE INDEX "AuthNonce_chainId_address_expiresAt_idx" ON "AuthNonce"("chainId", "address", "expiresAt");

-- CreateIndex
CREATE INDEX "Wallet_chainId_address_idx" ON "Wallet"("chainId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_chainId_address_key" ON "Wallet"("userId", "chainId", "address");

-- CreateIndex
CREATE INDEX "WalletPermission_chainId_address_idx" ON "WalletPermission"("chainId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "WalletPermission_userId_walletId_permission_key" ON "WalletPermission"("userId", "walletId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "Token_chainId_address_key" ON "Token"("chainId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_chainId_address_key" ON "Pool"("chainId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_chainId_token0Id_token1Id_fee_key" ON "Pool"("chainId", "token0Id", "token1Id", "fee");

-- CreateIndex
CREATE INDEX "Position_chainId_ownerAddress_idx" ON "Position"("chainId", "ownerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Position_chainId_managerAddress_tokenId_key" ON "Position"("chainId", "managerAddress", "tokenId");

-- CreateIndex
CREATE INDEX "PositionSnapshot_chainId_blockNumber_idx" ON "PositionSnapshot"("chainId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PositionSnapshot_positionId_blockNumber_key" ON "PositionSnapshot"("positionId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PositionEvent_chainId_transactionHash_logIndex_key" ON "PositionEvent"("chainId", "transactionHash", "logIndex");

-- CreateIndex
CREATE INDEX "SwapEvent_poolId_blockNumber_idx" ON "SwapEvent"("poolId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SwapEvent_chainId_transactionHash_logIndex_key" ON "SwapEvent"("chainId", "transactionHash", "logIndex");

-- CreateIndex
CREATE INDEX "Strategy_chainId_enabled_nextExecutionAt_idx" ON "Strategy"("chainId", "enabled", "nextExecutionAt");

-- CreateIndex
CREATE INDEX "StrategyExecution_strategyId_startedAt_idx" ON "StrategyExecution"("strategyId", "startedAt");

-- CreateIndex
CREATE INDEX "Workflow_chainId_status_updatedAt_idx" ON "Workflow"("chainId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_userId_chainId_workflowKey_key" ON "Workflow"("userId", "chainId", "workflowKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStep_workflowId_ordinal_key" ON "WorkflowStep"("workflowId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSubmission_chainId_transactionHash_key" ON "TransactionSubmission"("chainId", "transactionHash");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSubmission_chainId_signerAddress_nonce_transacti_key" ON "TransactionSubmission"("chainId", "signerAddress", "nonce", "transactionHash");

-- CreateIndex
CREATE UNIQUE INDEX "NonceLease_ownerToken_key" ON "NonceLease"("ownerToken");

-- CreateIndex
CREATE INDEX "NonceLease_chainId_address_expiresAt_idx" ON "NonceLease"("chainId", "address", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "NonceLease_chainId_address_nonce_key" ON "NonceLease"("chainId", "address", "nonce");

-- CreateIndex
CREATE INDEX "CircuitBreaker_chainId_scope_active_idx" ON "CircuitBreaker"("chainId", "scope", "active");

-- CreateIndex
CREATE INDEX "Alert_userId_acknowledgedAt_createdAt_idx" ON "Alert"("userId", "acknowledgedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventCursor_chainId_stream_contractAddress_key" ON "EventCursor"("chainId", "stream", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ContractManifest_chainId_name_key" ON "ContractManifest"("chainId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ContractManifest_chainId_address_key" ON "ContractManifest"("chainId", "address");

-- CreateIndex
CREATE INDEX "ContractCodeObservation_chainId_address_observedAt_idx" ON "ContractCodeObservation"("chainId", "address", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractCodeObservation_manifestId_blockNumber_key" ON "ContractCodeObservation"("manifestId", "blockNumber");

-- AddForeignKey
ALTER TABLE "AuthNonce" ADD CONSTRAINT "AuthNonce_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletPermission" ADD CONSTRAINT "WalletPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletPermission" ADD CONSTRAINT "WalletPermission_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_token0Id_fkey" FOREIGN KEY ("token0Id") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_token1Id_fkey" FOREIGN KEY ("token1Id") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_token0Id_fkey" FOREIGN KEY ("token0Id") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_token1Id_fkey" FOREIGN KEY ("token1Id") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSnapshot" ADD CONSTRAINT "PositionSnapshot_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionEvent" ADD CONSTRAINT "PositionEvent_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapEvent" ADD CONSTRAINT "SwapEvent_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExecution" ADD CONSTRAINT "StrategyExecution_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExecution" ADD CONSTRAINT "StrategyExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSubmission" ADD CONSTRAINT "TransactionSubmission_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSubmission" ADD CONSTRAINT "TransactionSubmission_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "WorkflowStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSubmission" ADD CONSTRAINT "TransactionSubmission_replacementForId_fkey" FOREIGN KEY ("replacementForId") REFERENCES "TransactionSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonceLease" ADD CONSTRAINT "NonceLease_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircuitBreaker" ADD CONSTRAINT "CircuitBreaker_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircuitBreaker" ADD CONSTRAINT "CircuitBreaker_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractCodeObservation" ADD CONSTRAINT "ContractCodeObservation_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "ContractManifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
