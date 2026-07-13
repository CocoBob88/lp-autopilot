const Q32 = 1n << 32n;
export const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

function mulShift(value: bigint, multiplier: bigint) {
  return (value * multiplier) >> 128n;
}

export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError("Tick is outside the Uniswap V3 domain");
  }
  const absTick = BigInt(tick < 0 ? -tick : tick);
  let ratio =
    (absTick & 1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  const constants = [
    0xfff97272373d413259a46990580e213an,
    0xfff2e50f5f656932ef12357cf3c7fdccn,
    0xffe5caca7e10e4e61c3624eaa0941cd0n,
    0xffcb9843d60f6159c9db58835c926644n,
    0xff973b41fa98c081472e6896dfb254c0n,
    0xff2ea16466c96a3843ec78b326b52861n,
    0xfe5dee046a99a2a811c461f1969c3053n,
    0xfcbe86c7900a88aedcffc83b479aa3a4n,
    0xf987a7253ac413176f2b074cf7815e54n,
    0xf3392b0822b70005940c7a398e4b70f3n,
    0xe7159475a2c29b7443b29c7fa6e889d9n,
    0xd097f3bdfd2022b8845ad8f792aa5825n,
    0xa9f746462d870fdf8a65dc1f90e061e5n,
    0x70d869a156d2a1b890bb3df62baf32f7n,
    0x31be135f97d08fd981231505542fcfa6n,
    0x9aa508b5b7a84e1c677de54f3e99bc9n,
    0x5d6af8dedb81196699c329225ee604n,
    0x2216e584f5fa1ea926041bedfe98n,
    0x48a170391f7dc42444e8fa2n,
  ];
  for (let i = 0; i < constants.length; i += 1) {
    if ((absTick & (1n << BigInt(i + 1))) !== 0n)
      ratio = mulShift(ratio, constants[i]);
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  const quotient = ratio >> 32n;
  return quotient + (ratio % Q32 === 0n ? 0n : 1n);
}

export function amountsForLiquidity(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
) {
  if (tickLower >= tickUpper || liquidity < 0n)
    throw new RangeError("Invalid liquidity range");
  const sqrtA = sqrtRatioAtTick(tickLower);
  const sqrtB = sqrtRatioAtTick(tickUpper);
  if (sqrtPriceX96 <= sqrtA) {
    return {
      amount0: (liquidity * (sqrtB - sqrtA) * Q96) / (sqrtA * sqrtB),
      amount1: 0n,
    };
  }
  if (sqrtPriceX96 < sqrtB) {
    return {
      amount0:
        (liquidity * (sqrtB - sqrtPriceX96) * Q96) / (sqrtPriceX96 * sqrtB),
      amount1: (liquidity * (sqrtPriceX96 - sqrtA)) / Q96,
    };
  }
  return { amount0: 0n, amount1: (liquidity * (sqrtB - sqrtA)) / Q96 };
}

export function priceAtTick(
  tick: number,
  decimals0: number,
  decimals1: number,
) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

export function rangeState(
  tick: number,
  lower: number,
  upper: number,
  thresholdBps = 500,
) {
  if (tick < lower || tick >= upper) return "OUT_OF_RANGE" as const;
  const width = upper - lower;
  const distance = Math.min(tick - lower, upper - tick);
  return distance * 10_000 <= width * thresholdBps
    ? ("NEAR_BOUNDARY" as const)
    : ("IN_RANGE" as const);
}

export function applySlippage(amount: bigint, slippageBps: number) {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 5_000
  ) {
    throw new RangeError("Slippage must be between 0 and 5000 bps");
  }
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function alignTick(
  tick: number,
  spacing: number,
  direction: "down" | "up",
) {
  if (spacing <= 0) throw new RangeError("Tick spacing must be positive");
  const quotient = Math.floor(tick / spacing);
  const down = quotient * spacing;
  return direction === "down" || down === tick ? down : down + spacing;
}
