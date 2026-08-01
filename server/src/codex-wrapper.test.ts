import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { test } from "node:test";

const WRAPPER_PATH = fileURLToPath(
  new URL("../scripts/codex-ephemeral-wrapper.mjs", import.meta.url),
);

function waitForFile(path: string, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (existsSync(path)) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error(`Timed out waiting for ${path}`));
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (isProcessRunning(pid)) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for process ${pid} to exit`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function killIfRunning(pid: number | undefined): void {
  if (pid === undefined || !isProcessRunning(pid)) return;
  process.kill(pid, "SIGKILL");
}

test("Codex wrapper forces ephemeral execution without user config or rules", async () => {
  const directory = mkdtempSync(join(tmpdir(), "erd-codex-wrapper-test-"));
  const fakeCodex = join(directory, "fake-codex.mjs");
  const argsOutput = join(directory, "args.json");
  const envOutput = join(directory, "env.json");
  try {
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.ARGS_OUTPUT, JSON.stringify(process.argv.slice(2)));\nwriteFileSync(process.env.ENV_OUTPUT, JSON.stringify({ killGrace: process.env.ERD_CODEX_KILL_GRACE_MS, realPath: process.env.ERD_CODEX_REAL_PATH }));\n`,
      { mode: 0o700 },
    );

    const child = spawn(process.execPath, [WRAPPER_PATH, "exec", "--experimental-json"], {
      env: {
        ...process.env,
        ARGS_OUTPUT: argsOutput,
        ENV_OUTPUT: envOutput,
        ERD_CODEX_KILL_GRACE_MS: "50",
        ERD_CODEX_REAL_PATH: fakeCodex,
      },
      stdio: "ignore",
    });
    const [code] = await once(child, "exit");

    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(readFileSync(argsOutput, "utf8")), [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--strict-config",
      "--experimental-json",
    ]);
    assert.deepEqual(JSON.parse(readFileSync(envOutput, "utf8")), {});
    assert.notEqual(statSync(WRAPPER_PATH).mode & 0o111, 0, "wrapper must be executable for the SDK");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Codex wrapper forwards SIGTERM to the entire Codex process group", async () => {
  const directory = mkdtempSync(join(tmpdir(), "erd-codex-wrapper-signal-test-"));
  const fakeCodex = join(directory, "fake-codex.mjs");
  const grandchildScript = join(directory, "grandchild.mjs");
  const grandchildPidFile = join(directory, "grandchild.pid");
  const grandchildReadyFile = join(directory, "grandchild.ready");
  const grandchildSignalFile = join(directory, "grandchild.signal");
  const parentSignalFile = join(directory, "parent.signal");
  let grandchildPid: number | undefined;
  try {
    writeFileSync(
      grandchildScript,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.GRANDCHILD_READY_FILE, "ready");\nprocess.on("SIGTERM", () => { writeFileSync(process.env.GRANDCHILD_SIGNAL_FILE, "SIGTERM"); process.exit(0); });\nsetInterval(() => {}, 1000);\n`,
    );
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node\nimport { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nconst grandchild = spawn(process.execPath, [process.env.GRANDCHILD_SCRIPT], { env: process.env, stdio: "ignore" });\nwriteFileSync(process.env.GRANDCHILD_PID_FILE, String(grandchild.pid));\nprocess.on("SIGTERM", () => { writeFileSync(process.env.PARENT_SIGNAL_FILE, "SIGTERM"); setTimeout(() => process.exit(0), 25); });\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );

    const wrapper = spawn(process.execPath, [WRAPPER_PATH, "exec", "--experimental-json"], {
      env: {
        ...process.env,
        ERD_CODEX_REAL_PATH: fakeCodex,
        GRANDCHILD_PID_FILE: grandchildPidFile,
        GRANDCHILD_READY_FILE: grandchildReadyFile,
        GRANDCHILD_SCRIPT: grandchildScript,
        GRANDCHILD_SIGNAL_FILE: grandchildSignalFile,
        PARENT_SIGNAL_FILE: parentSignalFile,
      },
      stdio: "ignore",
    });
    await waitForFile(grandchildReadyFile);
    grandchildPid = Number(readFileSync(grandchildPidFile, "utf8"));
    wrapper.kill("SIGTERM");
    await once(wrapper, "exit");
    await waitForProcessExit(grandchildPid);

    assert.equal(readFileSync(parentSignalFile, "utf8"), "SIGTERM");
    assert.equal(readFileSync(grandchildSignalFile, "utf8"), "SIGTERM");
  } finally {
    killIfRunning(grandchildPid);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Codex wrapper forwards a SIGTERM received before the child is spawned", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "erd-codex-wrapper-pending-signal-test-"));
  const fakeCodex = join(directory, "fake-codex.mjs");
  const preload = join(directory, "delay-spawn.mjs");
  const spawnStartedFile = join(directory, "spawn.started");
  const childPidFile = join(directory, "child.pid");
  let childPid: number | undefined;
  try {
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );
    writeFileSync(
      preload,
      `import childProcess from "node:child_process";\nimport { writeFileSync } from "node:fs";\nimport { syncBuiltinESMExports } from "node:module";\nconst realSpawn = childProcess.spawn;\nchildProcess.spawn = (...args) => {\n  writeFileSync(process.env.SPAWN_STARTED_FILE, "started");\n  const releaseAt = Date.now() + 200;\n  while (Date.now() < releaseAt) {}\n  const child = realSpawn(...args);\n  writeFileSync(process.env.CHILD_PID_FILE, String(child.pid));\n  return child;\n};\nsyncBuiltinESMExports();\n`,
    );

    const wrapper = spawn(
      process.execPath,
      ["--import", preload, WRAPPER_PATH, "exec", "--experimental-json"],
      {
        env: {
          ...process.env,
          CHILD_PID_FILE: childPidFile,
          ERD_CODEX_REAL_PATH: fakeCodex,
          SPAWN_STARTED_FILE: spawnStartedFile,
        },
        stdio: "ignore",
      },
    );
    await waitForFile(spawnStartedFile);
    wrapper.kill("SIGTERM");
    const [code, signal] = await once(wrapper, "exit");
    await waitForFile(childPidFile);
    childPid = Number(readFileSync(childPidFile, "utf8"));
    await waitForProcessExit(childPid);

    assert.equal(code, 143);
    assert.equal(signal, null);
  } finally {
    killIfRunning(childPid);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Codex wrapper keeps the grace timer when only a descendant ignores SIGTERM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "erd-codex-wrapper-descendant-test-"));
  const fakeCodex = join(directory, "fake-codex.mjs");
  const grandchildScript = join(directory, "grandchild.mjs");
  const grandchildPidFile = join(directory, "grandchild.pid");
  const grandchildReadyFile = join(directory, "grandchild.ready");
  let grandchildPid: number | undefined;
  try {
    writeFileSync(
      grandchildScript,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.GRANDCHILD_READY_FILE, "ready");\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`,
    );
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node\nimport { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nconst grandchild = spawn(process.execPath, [process.env.GRANDCHILD_SCRIPT], { env: process.env, stdio: "ignore" });\nwriteFileSync(process.env.GRANDCHILD_PID_FILE, String(grandchild.pid));\nprocess.on("SIGTERM", () => process.exit(0));\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );

    const wrapper = spawn(process.execPath, [WRAPPER_PATH, "exec", "--experimental-json"], {
      env: {
        ...process.env,
        ERD_CODEX_KILL_GRACE_MS: "120",
        ERD_CODEX_REAL_PATH: fakeCodex,
        GRANDCHILD_PID_FILE: grandchildPidFile,
        GRANDCHILD_READY_FILE: grandchildReadyFile,
        GRANDCHILD_SCRIPT: grandchildScript,
      },
      stdio: "ignore",
    });
    await waitForFile(grandchildReadyFile);
    grandchildPid = Number(readFileSync(grandchildPidFile, "utf8"));
    const startedAt = Date.now();
    wrapper.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(wrapper.exitCode, null, "wrapper exited while a descendant was still alive");
    assert.equal(isProcessRunning(grandchildPid), true);

    const safetyTimer = setTimeout(() => wrapper.kill("SIGKILL"), 1_500);
    await once(wrapper, "exit");
    clearTimeout(safetyTimer);
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs >= 100, "descendant was killed before the grace period");
    assert.ok(elapsedMs < 1_000, "descendant was not killed after the grace period");
    await waitForProcessExit(grandchildPid);
  } finally {
    killIfRunning(grandchildPid);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Codex wrapper escalates to SIGKILL when the child ignores SIGTERM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "erd-codex-wrapper-kill-test-"));
  const fakeCodex = join(directory, "fake-codex.mjs");
  const grandchildScript = join(directory, "grandchild.mjs");
  const grandchildPidFile = join(directory, "grandchild.pid");
  const grandchildReadyFile = join(directory, "grandchild.ready");
  const parentPidFile = join(directory, "parent.pid");
  const parentReadyFile = join(directory, "parent.ready");
  let grandchildPid: number | undefined;
  let parentPid: number | undefined;
  try {
    writeFileSync(
      grandchildScript,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.GRANDCHILD_READY_FILE, "ready");\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`,
    );
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node\nimport { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nconst grandchild = spawn(process.execPath, [process.env.GRANDCHILD_SCRIPT], { env: process.env, stdio: "ignore" });\nwriteFileSync(process.env.GRANDCHILD_PID_FILE, String(grandchild.pid));\nwriteFileSync(process.env.PARENT_PID_FILE, String(process.pid));\nwriteFileSync(process.env.PARENT_READY_FILE, "ready");\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );

    const wrapper = spawn(process.execPath, [WRAPPER_PATH, "exec", "--experimental-json"], {
      env: {
        ...process.env,
        ERD_CODEX_KILL_GRACE_MS: "120",
        ERD_CODEX_REAL_PATH: fakeCodex,
        GRANDCHILD_PID_FILE: grandchildPidFile,
        GRANDCHILD_READY_FILE: grandchildReadyFile,
        GRANDCHILD_SCRIPT: grandchildScript,
        PARENT_PID_FILE: parentPidFile,
        PARENT_READY_FILE: parentReadyFile,
      },
      stdio: "ignore",
    });
    await Promise.all([waitForFile(parentReadyFile), waitForFile(grandchildReadyFile)]);
    grandchildPid = Number(readFileSync(grandchildPidFile, "utf8"));
    parentPid = Number(readFileSync(parentPidFile, "utf8"));
    const startedAt = Date.now();
    wrapper.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(wrapper.exitCode, null, "wrapper exited before the configured grace period");
    assert.equal(isProcessRunning(parentPid), true);
    assert.equal(isProcessRunning(grandchildPid), true);

    const safetyTimer = setTimeout(() => wrapper.kill("SIGKILL"), 1_500);
    await once(wrapper, "exit");
    clearTimeout(safetyTimer);

    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs >= 100, "wrapper escalated before the configured grace period");
    assert.ok(elapsedMs < 1_000, "wrapper did not escalate after the grace period");
    await Promise.all([
      waitForProcessExit(parentPid),
      waitForProcessExit(grandchildPid),
    ]);
  } finally {
    killIfRunning(parentPid);
    killIfRunning(grandchildPid);
    rmSync(directory, { force: true, recursive: true });
  }
});
