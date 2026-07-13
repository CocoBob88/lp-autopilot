"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./wallet-provider";
import type { PositionData } from "./types";

export function usePositions() {
  const wallet = useWallet();
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!wallet.address) {
      setPositions([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/positions?owner=${wallet.address}&chainId=${wallet.chainId}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        positions?: PositionData[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Position discovery failed");
      setPositions(body.positions ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Position discovery failed",
      );
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [wallet.address, wallet.chainId]);
  useEffect(() => {
    void refresh();
  }, [refresh, wallet.health?.blockNumber]);
  return { ...wallet, positions, loading, error, refresh };
}
