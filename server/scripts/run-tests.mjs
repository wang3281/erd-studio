import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }

  return files;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const testFiles = await collectTestFiles(join(scriptDirectory, "..", "src"));

if (testFiles.length === 0) {
  throw new Error("No server test files found");
}

console.log(`Running ${testFiles.length} server test files`);

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  { stdio: "inherit" },
);

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
