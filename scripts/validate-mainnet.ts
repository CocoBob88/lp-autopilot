import { validateManifest } from "../src/operations/manifest";
import { jsonSafe, sanitizeError } from "../src/lib/serialize";

validateManifest(4663, true)
  .then((result) => {
    console.log(
      JSON.stringify(
        jsonSafe({ ...result, mode: "read-only", broadcastCount: 0 }),
        null,
        2,
      ),
    );
    if (!result.healthy) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(sanitizeError(error));
    process.exitCode = 1;
  });
