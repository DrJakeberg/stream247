// The `relay-watchdog` service's command since the M114 follow-up: restarts the relay container of
// its own Compose project when the relay stops answering. See relay-restart.ts.

import { runRelayWatchdog } from "./relay-restart.js";

runRelayWatchdog();
