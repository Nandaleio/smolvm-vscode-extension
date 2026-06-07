import * as vscode from "vscode";
import type {
  Machine,
  MachineConfig,
  MountSpec,
  PortSpec,
  ResourceSpec,
} from "smolmachines";

/** The `Machine` class itself (injected so the SDK is the single source of truth). */
export type MachineClass = typeof Machine;

export type InstanceStatus = "running" | "stopped";

export interface InstanceInfo {
  name: string;
  status: InstanceStatus;
}

/** Per-creation overrides: a partial of the SDK's own {@link MachineConfig}. */
export type CreateOverrides = Partial<MachineConfig>;

const STORAGE_KEY = "smolvm.machines";

/**
 * Owns the set of SmolVM machines for the workspace.
 *
 * The SDK has no "list machines" call, so the registry of names (and last-known
 * status) lives in workspace state. Live {@link Machine} handles are cached in
 * memory; after a reload we re-attach by name with `Machine.connect`, which
 * boots a persisted-but-stopped machine. Machines are created `persistent` so
 * they can be reconnected at all.
 */
export class MachineManager {
  private readonly live = new Map<string, Machine>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly Machine: MachineClass,
  ) {}

  list(): InstanceInfo[] {
    return this.context.workspaceState.get<InstanceInfo[]>(STORAGE_KEY, []);
  }

  has(name: string): boolean {
    return this.list().some((i) => i.name === name);
  }

  /** Create and start a new persistent machine. */
  async create(name: string, overrides: CreateOverrides = {}): Promise<void> {
    if (this.has(name)) {
      throw new Error(`A machine named "${name}" already exists.`);
    }
    const machine = await this.Machine.create(this.buildConfig(name, overrides));
    this.live.set(name, machine);
    await this.upsert({ name, status: "running" });
  }

  /**
   * Build the SDK {@link MachineConfig}, layering `overrides` (itself a
   * `Partial<MachineConfig>`) over the configured `smolvm.*` defaults. Every
   * `MachineConfig` attribute is exposed via settings; optional ones are only
   * included when set.
   */
  private buildConfig(name: string, overrides: CreateOverrides): MachineConfig {
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
    await this.setStatus(name, "running");
  }

  async stop(name: string): Promise<void> {
    const machine = await this.handle(name);
    await machine.stop();
    await this.setStatus(name, "stopped");
  }

  async delete(name: string): Promise<void> {
    const machine = await this.handle(name);
    await machine.delete();
    this.live.delete(name);
    await this.persist(this.list().filter((i) => i.name !== name));
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

  private async setStatus(name: string, status: InstanceStatus): Promise<void> {
    const infos = this.list();
    const target = infos.find((i) => i.name === name);
    if (target) {
      target.status = status;
      await this.persist(infos);
    }
  }

  private async upsert(info: InstanceInfo): Promise<void> {
    const infos = this.list().filter((i) => i.name !== info.name);
    infos.push(info);
    await this.persist(infos);
  }

  private async persist(infos: InstanceInfo[]): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, infos);
  }
}
