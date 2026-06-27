import * as vscode from "vscode";
import * as path from "node:path";
import { run, stream } from "./cli";
import type {
  ExecEvent,
  InstanceInfo,
  MachineConfig,
  MachineState,
  MountSpec,
  PortSpec,
  ResourceSpec,
} from "./types";

/**
 * Owns the set of SmolVM machines for the workspace.
 *
 * Everything goes through the `smolvm` CLI: the list is sourced from
 * `machine ls --json` (refreshed at startup and periodically) and cached in
 * memory; lifecycle actions shell out to the matching `machine` subcommand.
 */
export class MachineManager {
  private snapshot: InstanceInfo[] = [];

  /** The latest cached snapshot from the CLI. */
  list(): InstanceInfo[] {
    return this.snapshot;
  }

  has(name: string): boolean {
    return this.snapshot.some((i) => i.name === name);
  }

  /** Re-query `smolvm machine ls --json` and update the cached snapshot. */
  async refresh(): Promise<InstanceInfo[]> {
    const stdout = await run(["machine", "ls", "--json"], 15_000);
    this.snapshot = parseMachines(stdout);
    return this.snapshot;
  }

  /** Create a new persistent machine (left stopped; started on first use). */
  async create(name: string, overrides: MachineConfig = {}): Promise<void> {
    if (this.has(name)) {
      throw new Error(`A machine named "${name}" already exists.`);
    }
    await run(createArgs(this.buildConfig(name, overrides)), 300_000);
    await this.refresh();
  }

  /**
   * Create a machine from a Smolfile:
   * `machine create --name <name> --smolfile <smolfile>`.
   * The CLI is run from the Smolfile's own directory, passing just its filename,
   * so any relative paths the Smolfile references resolve against that folder.
   */
  async createFromSmolfile(name: string, smolfilePath: string): Promise<void> {
    if (this.has(name)) {
      throw new Error(`A machine named "${name}" already exists.`);
    }
    await run(
      ["machine", "create", "--name", name, "--smolfile", path.basename(smolfilePath)],
      300_000,
      path.dirname(smolfilePath),
    );
    await this.refresh();
  }

  /**
   * Build the {@link MachineConfig}, layering `overrides` over the configured
   * `smolvm.*` defaults. Optional fields are only included when set.
   */
  private buildConfig(name: string, overrides: MachineConfig): MachineConfig {
    const cfg = vscode.workspace.getConfiguration("smolvm");
    const res = overrides.resources ?? {};

    const resources: ResourceSpec = {
      cpus: res.cpus ?? cfg.get<number>("resources.cpus", 2),
      memoryMb: res.memoryMb ?? cfg.get<number>("resources.memoryMb", 1024),
      network: res.network ?? cfg.get<boolean>("resources.network", true),
    };
    const storageGb =
      res.storageGb ?? cfg.get<number | null>("resources.storageGb", null);
    if (storageGb != null) {
      resources.storageGb = storageGb;
    }
    const overlayGb =
      res.overlayGb ?? cfg.get<number | null>("resources.overlayGb", null);
    if (overlayGb != null) {
      resources.overlayGb = overlayGb;
    }

    const config: MachineConfig = { name, resources };

    const image = (overrides.image ?? cfg.get<string>("image", "")).trim();
    if (image) {
      config.image = image;
    }

    const ports = overrides.ports ?? cfg.get<PortSpec[]>("ports", []);
    if (Array.isArray(ports) && ports.length > 0) {
      config.ports = ports;
    }

    const mounts = overrides.mounts ?? this.defaultMounts(cfg);
    if (mounts.length > 0) {
      config.mounts = mounts;
    }
    return config;
  }

  /** The default bind-mount from settings ("" target/source disables it). */
  private defaultMounts(cfg: vscode.WorkspaceConfiguration): MountSpec[] {
    const target = cfg.get<string>("workspaceMount", "/workspace").trim();
    const source =
      cfg.get<string>("mountSource", "").trim() ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!source || !target) {
      return [];
    }
    return [{ source, target, readonly: false }];
  }

  /** Start (boot) a stopped machine. */
  async start(name: string): Promise<void> {
    await run(["machine", "start", "--name", name], 300_000);
    await this.refresh();
  }

  async stop(name: string): Promise<void> {
    await run(["machine", "stop", "--name", name]);
    await this.refresh();
  }

  async delete(name: string): Promise<void> {
    await run(["machine", "delete", "--name", name, "--force"]);
    await this.refresh();
  }

  /**
   * Execute a command in a machine via `machine exec --stream`, yielding
   * stdout/stderr chunks as they arrive and a terminal exit/error event.
   * Calling `.return()` on the generator kills the child (cancellation).
   */
  execStream(name: string, command: string[]): AsyncGenerator<ExecEvent> {
    return stream(["machine", "exec", "--name", name, "--stream", "--", ...command]);
  }
}

/** Translate a {@link MachineConfig} into `machine create` CLI arguments. */
function createArgs(config: MachineConfig): string[] {
  const args = ["machine", "create", "--name", config.name!];
  if (config.image) {
    args.push("--image", config.image);
  }
  const r = config.resources ?? {};
  if (r.cpus != null) {
    args.push("--cpus", String(r.cpus));
  }
  if (r.memoryMb != null) {
    args.push("--mem", String(r.memoryMb));
  }
  if (r.storageGb != null) {
    args.push("--storage", String(r.storageGb));
  }
  if (r.overlayGb != null) {
    args.push("--overlay", String(r.overlayGb));
  }
  if (r.network) {
    args.push("--net");
  }
  for (const p of config.ports ?? []) {
    args.push("--port", `${p.host}:${p.guest}`);
  }
  for (const m of config.mounts ?? []) {
    args.push("--volume", `${m.source}:${m.target}${m.readonly ? ":ro" : ""}`);
  }
  return args;
}

/** Parse the JSON array printed by `smolvm machine ls --json`. */
function parseMachines(stdout: string): InstanceInfo[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  const machines: InstanceInfo[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== "string" || name.length === 0) {
      continue;
    }
    machines.push({ name, status: normalizeStatus(record.state ?? record.status) });
  }
  return machines;
}

function normalizeStatus(value: unknown): MachineState {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "running" || normalized === "stopped" || normalized === "created") {
    return normalized;
  }
  return "stopped";
}
