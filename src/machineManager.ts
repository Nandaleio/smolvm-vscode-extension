import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Machine,
  MachineConfig,
  MountSpec,
  PortSpec,
  ResourceSpec,
  MachineState,
} from "smolmachines";

const execFileAsync = promisify(execFile);

/** The `Machine` class itself (injected so the SDK is the single source of truth). */
export type MachineClass = typeof Machine;

/** The vm instance class used for listing VMs  */
export interface InstanceInfo {
  name: string;
  status: MachineState;
}

/**
 * Owns the set of SmolVM machines for the workspace.
 *
 * The list is sourced from the `smolvm` CLI (`machine ls --json`), refreshed at
 * startup and periodically; the latest snapshot is cached in memory and exposed
 * via {@link list}. Lifecycle actions go through the embedded SDK; live
 * {@link Machine} handles are cached so we can stop/delete without reconnecting.
 */
export class MachineManager {
  private readonly live = new Map<string, Machine>();
  private snapshot: InstanceInfo[] = [];

  constructor(private readonly Machine: MachineClass) {}

  /** The latest cached snapshot from the CLI. */
  list(): InstanceInfo[] {
    return this.snapshot;
  }

  has(name: string): boolean {
    return this.snapshot.some((i) => i.name === name);
  }

  /** Re-query `smolvm machine ls --json` and update the cached snapshot. */
  async refresh(): Promise<InstanceInfo[]> {
    const cli = vscode.workspace
      .getConfiguration("smolvm")
      .get<string>("cliPath", "smolvm");
    const { stdout } = await execFileAsync(
      cli,
      ["machine", "ls", "--json"],
      { timeout: 15_000 },
    );
    this.snapshot = parseMachines(stdout);
    return this.snapshot;
  }

  /** Create and start a new persistent machine. */
  async create(name: string, overrides: MachineConfig = {}): Promise<void> {
    if (this.has(name)) {
      throw new Error(`A machine named "${name}" already exists.`);
    }
    const machine = await this.Machine.create(this.buildConfig(name, overrides));
    this.live.set(name, machine);
    await this.refresh();
  }

  /**
   * Build the SDK {@link MachineConfig}, layering `overrides` (itself a
   * `Partial<MachineConfig>`) over the configured `smolvm.*` defaults. Every
   * `MachineConfig` attribute is exposed via settings; optional ones are only
   * included when set.
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

    const config: MachineConfig = {
      name,
      persistent: overrides.persistent ?? cfg.get<boolean>("persistent", true),
      resources,
    };

    const image = (overrides.image ?? cfg.get<string>("image", "")).trim();
    if (image) {
      config.image = image;
    }

    const ports = overrides.ports ?? cfg.get<PortSpec[]>("ports", []);
    if (Array.isArray(ports) && ports.length > 0) {
      config.ports = ports;
    }

    const autoStopSeconds =
      overrides.autoStopSeconds ?? cfg.get<number | null>("autoStopSeconds", null);
    if (autoStopSeconds != null) {
      config.autoStopSeconds = autoStopSeconds;
    }
    const ttlSeconds =
      overrides.ttlSeconds ?? cfg.get<number | null>("ttlSeconds", null);
    if (ttlSeconds != null) {
      config.ttlSeconds = ttlSeconds;
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

  /** Start (boot) a stopped machine by reconnecting to it. */
  async start(name: string): Promise<void> {
    // The SDK has no instance `start()`; `connect` re-opens by name and boots it.
    this.live.delete(name);
    const machine = await this.Machine.connect(name);
    this.live.set(name, machine);
    await this.refresh();
  }

  async stop(name: string): Promise<void> {
    const machine = await this.handle(name);
    await machine.stop();
    await this.refresh();
  }

  async delete(name: string): Promise<void> {
    const machine = await this.handle(name);
    await machine.delete();
    this.live.delete(name);
    await this.refresh();
  }

  /** A live handle, reconnecting by name if we don't have one cached. */
  private async handle(name: string): Promise<Machine> {
    let machine = this.live.get(name);
    if (!machine) {
      machine = await this.Machine.connect(name);
      this.live.set(name, machine);
    }
    return machine;
  }
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
