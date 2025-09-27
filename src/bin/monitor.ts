#!/usr/bin/env bun
import { monitorCli } from "../lib/claudeMonitor";

const args = process.argv.slice(2);
let command: string | undefined;
let repo: string | undefined;
let issue: number | undefined;
let format: "text" | "json" | undefined;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  switch (arg) {
    case "status":
    case "history":
    case "monitor":
      command = arg;
      break;
    case "--repo":
      repo = args[i + 1];
      i += 1;
      break;
    case "--issue":
      issue = Number(args[i + 1]);
      i += 1;
      break;
    case "--format":
      format = args[i + 1] === "json" ? "json" : "text";
      i += 1;
      break;
    default:
      break;
  }
}

monitorCli({ command, repo, issue, format }).catch((error) => {
  console.error("Monitor failed", error);
  process.exitCode = 1;
});
