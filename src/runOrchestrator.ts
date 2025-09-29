#!/usr/bin/env bun
import { main } from "./lib/orchestrator";
import packageJson from "../package.json" assert { type: "json" };

const VERSION = packageJson.version ?? "0.0.0";
const DESCRIPTION = typeof packageJson.description === "string" ? packageJson.description : undefined;

(async () => {
  try {
    await main({ version: VERSION, description: DESCRIPTION });
  } catch (error) {
    console.error("Orchestrator failed", error);
    process.exitCode = 1;
  }
})();
