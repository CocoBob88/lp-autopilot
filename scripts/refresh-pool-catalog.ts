import { simulateRange } from "@/src/domain/farms";
import { getFarmScanner } from "@/src/operations/farms";

const result = await getFarmScanner(undefined, true);
const farm = result.farms[0];
if (!farm) throw new Error("No qualifying pools were discovered");
const narrow = simulateRange(farm, 1_000, 5, 5);
const wide = simulateRange(farm, 1_000, 30, 30);

console.log(
  JSON.stringify({
    visiblePools: result.farms.length,
    catalogSize: result.catalogSize,
    databaseBacked: result.databaseBacked,
    narrowApr: narrow.estimatedApr,
    wideApr: wide.estimatedApr,
    narrowHigher: (narrow.estimatedApr ?? 0) > (wide.estimatedApr ?? 0),
    pool: farm.poolAddress,
  }),
);
