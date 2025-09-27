#!/usr/bin/env bun
import { main } from "./lib/orchestrator";

(async () => {
  try {
    await main();
  } catch (error) {
    console.error("Orchestrator failed", error);
    process.exitCode = 1;
  }
})();
