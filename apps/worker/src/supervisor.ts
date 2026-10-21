// The container command since M114: `node apps/worker/dist/supervisor.js <mode>` runs
// `index.js <mode>` as its child and restarts the container when that child freezes. See
// process-supervisor.ts. The healthcheck keeps calling index.js directly.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { runSupervisor } from "./process-supervisor.js";

const args = process.argv.slice(2);
const mode = args[0] === "playout" || args[0] === "uplink" ? args[0] : "worker";

runSupervisor({
  childScript: path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js"),
  args: args.length > 0 ? args : ["worker"],
  mode,
  onExit: (code) => process.exit(code)
});
