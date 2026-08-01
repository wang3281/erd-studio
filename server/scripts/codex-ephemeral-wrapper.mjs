#!/usr/bin/env node

import { spawn } from "node:child_process";

const realCodexPath = process.env.ERD_CODEX_REAL_PATH;
if (!realCodexPath) {
  console.error("ERD_CODEX_REAL_PATH is required");
  process.exit(1);
}

const originalArgs = process.argv.slice(2);
if (originalArgs[0] !== "exec") {
  console.error("Codex wrapper only supports the exec command");
  process.exit(1);
}

const commandArgs = [
  "exec",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  ...originalArgs.slice(1),
];
const childEnvironment = { ...process.env };
delete childEnvironment.ERD_CODEX_REAL_PATH;
delete childEnvironment.ERD_CODEX_KILL_GRACE_MS;

const configuredGrace = Number.parseInt(process.env.ERD_CODEX_KILL_GRACE_MS ?? "", 10);
const killGraceMs = Number.isFinite(configuredGrace) && configuredGrace >= 0
  ? configuredGrace
  : 2_000;
const useProcessGroup = process.platform !== "win32";
let child;
let childResult;
let finalized = false;
let groupMonitor;
let killTimer;
let pendingSignal;
let processGroupId;
let terminationStarted = false;

const processGroupExists = () => {
  if (child === undefined) return false;
  if (processGroupId === undefined) {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
};

const signalProcessTree = (signal) => {
  if (child === undefined || (useProcessGroup && processGroupId === undefined)) return;
  try {
    if (processGroupId !== undefined) {
      process.kill(-processGroupId, signal);
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
};

const requestTermination = (signal) => {
  if (child === undefined || (useProcessGroup && processGroupId === undefined)) {
    if (pendingSignal === undefined) pendingSignal = signal;
    return;
  }
  beginTermination(signal);
};

const onSigterm = () => requestTermination("SIGTERM");
const onSigint = () => requestTermination("SIGINT");

const finalize = () => {
  if (finalized || childResult === undefined) return;
  finalized = true;
  if (groupMonitor !== undefined) clearInterval(groupMonitor);
  if (killTimer !== undefined) clearTimeout(killTimer);
  process.removeListener("SIGTERM", onSigterm);
  process.removeListener("SIGINT", onSigint);
  if (childResult.code !== null) {
    process.exitCode = childResult.code;
  } else {
    process.exitCode = childResult.signal === "SIGINT" ? 130 : 143;
  }
};

const monitorProcessGroup = () => {
  if (!processGroupExists()) {
    finalize();
    return;
  }
  if (groupMonitor !== undefined) return;
  groupMonitor = setInterval(() => {
    if (!processGroupExists()) finalize();
  }, 10);
};

function beginTermination(signal) {
  if (child === undefined || (useProcessGroup && processGroupId === undefined)) return;
  if (terminationStarted) return;
  terminationStarted = true;
  signalProcessTree(signal);
  killTimer = setTimeout(() => {
    signalProcessTree("SIGKILL");
    monitorProcessGroup();
  }, killGraceMs);
}

process.once("SIGTERM", onSigterm);
process.once("SIGINT", onSigint);

child = spawn(realCodexPath, commandArgs, {
  detached: useProcessGroup,
  env: childEnvironment,
  stdio: "inherit",
});
processGroupId = useProcessGroup ? child.pid : undefined;
if (pendingSignal !== undefined) beginTermination(pendingSignal);

child.once("error", (error) => {
  console.error(`Failed to start bundled Codex: ${error.message}`);
  childResult = { code: 1, signal: null };
  finalize();
});

child.once("exit", (code, signal) => {
  childResult = { code, signal };
  if (!terminationStarted || !useProcessGroup) {
    finalize();
    return;
  }
  monitorProcessGroup();
});
