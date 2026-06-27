import * as vscode from "vscode";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Buffer } from "node:buffer";
import type { ExecEvent } from "./types";

const execFileAsync = promisify(execFile);

/** Configured path to the `smolvm` binary. */
function cliPath(): string {
  return vscode.workspace
    .getConfiguration("smolvm")
    .get<string>("cliPath", "smolvm");
}

/** Run a `smolvm` subcommand to completion and return its stdout. */
export async function run(
  args: string[],
  timeoutMs = 60_000,
  cwd?: string,
): Promise<string> {
  const { stdout } = await execFileAsync(cliPath(), args, { timeout: timeoutMs, cwd });
  return stdout;
}

/**
 * Spawn a `smolvm` subcommand and yield its stdout/stderr chunks as they
 * arrive, followed by a terminal exit/error event. Calling `.return()` on the
 * generator kills the child (cancellation).
 */
export async function* stream(args: string[]): AsyncGenerator<ExecEvent> {
  const child = spawn(cliPath(), args);

  const queue: ExecEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const push = (e: ExecEvent): void => {
    queue.push(e);
    wake?.();
    wake = null;
  };

  child.stdout.on("data", (d: Buffer) => push({ kind: "stdout", data: d.toString() }));
  child.stderr.on("data", (d: Buffer) => push({ kind: "stderr", data: d.toString() }));
  child.on("error", (err) => {
    push({ kind: "error", message: err.message });
    done = true;
  });
  child.on("close", (code) => {
    push({ kind: "exit", exitCode: code ?? 0 });
    done = true;
  });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) {
        return;
      }
      await new Promise<void>((resolve) => (wake = resolve));
    }
  } finally {
    if (!child.killed) {
      child.kill();
    }
  }
}
