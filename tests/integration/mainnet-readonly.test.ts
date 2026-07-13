import { describe, expect, it } from "vitest";
import { validateManifest } from "@/src/operations/manifest";
import { getFarmScanner } from "@/src/operations/farms";
import { buildMintPlan } from "@/src/operations/mint-plan";
import { mainnetManifest } from "@/src/chains/robinhood";

describe.skipIf(process.env.RUN_MAINNET_READ_TESTS !== "true")(
  "Robinhood mainnet read-only",
  () => {
    it("validates chain identity and reviewed bytecode without a signer", async () => {
      const result = await validateManifest(4663, true);
      expect(result.chainId).toBe(4663);
      expect(result.healthy).toBe(true);
      expect(result.writesAllowed).toBe(false);
    }, 60_000);

    it("discovers active farms and builds a wallet mint plan without broadcasting", async () => {
      const scanner = await getFarmScanner();
      const farm = scanner.farms.find((candidate) => {
        const tokens = [
          candidate.token0.address.toLowerCase(),
          candidate.token1.address.toLowerCase(),
        ];
        return (
          tokens.includes(mainnetManifest.weth.toLowerCase()) &&
          tokens.includes(mainnetManifest.usdg.toLowerCase())
        );
      });
      expect(farm).toBeDefined();
      const tickLower =
        Math.floor((farm!.tick - 600) / farm!.tickSpacing) * farm!.tickSpacing;
      const tickUpper =
        Math.ceil((farm!.tick + 600) / farm!.tickSpacing) * farm!.tickSpacing;
      const plan = await buildMintPlan({
        owner: farm!.poolAddress,
        poolAddress: farm!.poolAddress,
        tickLower,
        tickUpper,
        amount0: "0.000001",
        amount1: "0.01",
        slippageBps: 100,
      });
      expect(scanner.farms.length).toBeGreaterThan(10);
      expect(plan.executionReady).toBe(true);
      expect(plan.steps.at(-1)?.method).toBe("mint");
      expect(plan.requestHash).toMatch(/^0x[0-9a-f]{64}$/);
    }, 180_000);
  },
);
