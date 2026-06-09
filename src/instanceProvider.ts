import * as vscode from "vscode";
import type { MachineConfig, MachineState, MountSpec, ResourceSpec } from "smolmachines";
import type { InstanceInfo, MachineManager } from "./machineManager";

/**
 * Backs the SmolVM "Instances" tree view. All machine operations are delegated
 * to {@link MachineManager}, which talks to the `smolmachines` SDK.
 */
export class InstanceProvider implements vscode.TreeDataProvider<InstanceItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    InstanceItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Live shell terminals keyed by machine name, so we can reuse them. */
  private readonly terminals = new Map<string, vscode.Terminal>();

  constructor(
    context: vscode.ExtensionContext,
    private readonly manager: MachineManager,
  ) {
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [name, terminal] of this.terminals) {
          if (terminal === closed) {
            this.terminals.delete(name);
          }
        }
      }),
    );
  }

  /** Re-render the tree from the manager's cached snapshot. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Re-query `smolvm machine ls` then re-render. */
  async reload(surfaceErrors = false): Promise<void> {
    try {
      await this.manager.refresh();
    } catch (err) {
      if (surfaceErrors) {
        this.reportError(err);
      } else {
        console.error("SmolVM: failed to list machines", err);
      }
    }
    this.refresh();
  }

  getTreeItem(element: InstanceItem): vscode.TreeItem {
    return element;
  }

  getChildren(): InstanceItem[] {
    return this.manager.list().map((info) => new InstanceItem(info));
  }

  async createInstance(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Name for the new SmolVM machine",
      placeHolder: "my-vm",
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return "Name cannot be empty";
        }
        if (this.manager.has(trimmed)) {
          return `A machine named "${trimmed}" already exists`;
        }
        return undefined;
      },
    });
    if (!name) {
      return;
    }
    const trimmedName = name.trim();

    const options = await this.promptCreateOptions();
    if (options === undefined) {
      return; // cancelled mid-flow
    }

    await this.withProgress(`Creating "${trimmedName}"`, () =>
      this.manager.create(trimmedName, options),
    );
  }

  /**
   * Create-time configuration. Each field is pre-filled with the configured
   * default (press Enter to accept it); blanking a field falls back to the
   * default, and pressing Escape returns `undefined` to cancel.
   */
  private async promptCreateOptions(): Promise<MachineConfig | undefined> {
    const cfg = vscode.workspace.getConfiguration("smolvm");

    const imageValue = await vscode.window.showInputBox({
      title: "Image (optional)",
      prompt: "Base OCI image, e.g. python:3.12 — blank for bar Alpine",
      value: cfg.get<string>("image", ""),
    });
    if (imageValue === undefined) {
      return undefined;
    }

    const cpus = await this.promptNumber(
      "vCPUs",
      "Number of vCPUs",
      cfg.get<number>("resources.cpus", 2),
    );
    if (cpus === null) {
      return undefined;
    }

    const memoryMb = await this.promptNumber(
      "Memory MB",
      "Memory in MB",
      cfg.get<number>("resources.memoryMb", 1024),
    );
    if (memoryMb === null) {
      return undefined;
    }

    const storageGb = await this.promptNumber(
      "Disk GB (optional)",
      "Storage disk size in GB",
      cfg.get<number | null>("resources.storageGb", null) ?? undefined,
    );
    if (storageGb === null) {
      return undefined;
    }

    // Outbound network access (TSI); default-first so Enter accepts the setting.
    const networkDefault = cfg.get<boolean>("resources.network", true);
    const enabled = {
      label: "$(globe) Enabled",
      description: "Outbound network access (TSI)",
      value: true,
    };
    const disabled = {
      label: "$(circle-slash) Disabled",
      description: "No outbound network access",
      value: false,
    };
    const networkPick = await vscode.window.showQuickPick(
      networkDefault ? [enabled, disabled] : [disabled, enabled],
      {
        title: "Network",
        placeHolder: `Outbound network access — default: ${
          networkDefault ? "enabled" : "disabled"
        }`,
      },
    );
    if (networkPick === undefined) {
      return undefined;
    }

    // Choose a host folder (from the explorer / filesystem) to bind.
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const sourcePick = await vscode.window.showQuickPick(
      [
        {
          label: "$(root-folder) Workspace root",
          description: root?.fsPath ?? "(no folder open)",
          value: "root",
        },
        { label: "$(folder-opened) Choose folder…", value: "choose" },
        { label: "$(circle-slash) Don't mount a folder", value: "none" },
      ],
      {
        title: "Folder to bind into the machine",
        placeHolder: "Bind-mount a host folder",
      },
    );
    if (sourcePick === undefined) {
      return undefined;
    }

    let source: string | undefined;
    if (sourcePick.value === "root") {
      source = root?.fsPath;
    } else if (sourcePick.value === "choose") {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        defaultUri: root,
        openLabel: "Bind folder",
        title: "Select a folder to bind into the machine",
      });
      if (!picked || picked.length === 0) {
        return undefined;
      }
      source = picked[0].fsPath;
    }

    // An empty `mounts` array explicitly means "no mount" (overrides defaults).
    const mounts: MountSpec[] = [];
    if (sourcePick.value !== "none") {
      const target = await vscode.window.showInputBox({
        title: "Mount folder at",
        prompt: "Absolute in-VM path to bind the folder at",
        value: cfg.get<string>("workspaceMount", "/workspace"),
        validateInput: (value) => {
          const t = value.trim();
          return t === "" || t.startsWith("/")
            ? undefined
            : "Enter an absolute path (e.g. /workspace)";
        },
      });
      if (target === undefined) {
        return undefined;
      }
      if (source && target.trim()) {
        mounts.push({ source, target: target.trim(), readonly: false });
      }
    }

    const resources: ResourceSpec = { network: networkPick.value };
    if (cpus.value !== undefined) {
      resources.cpus = cpus.value;
    }
    if (memoryMb.value !== undefined) {
      resources.memoryMb = memoryMb.value;
    }
    if (storageGb.value !== undefined) {
      resources.storageGb = storageGb.value;
    }

    const overrides: MachineConfig = { resources, mounts };
    const image = imageValue.trim();
    if (image) {
      overrides.image = image;
    }
    return overrides;
  }

  /**
   * Prompt for an optional positive integer, pre-filled with `def`.
   * Returns `null` if cancelled, otherwise `{ value }` where `value` is
   * `undefined` when left blank (meaning: use the configured default).
   */
  private async promptNumber(
    title: string,
    prompt: string,
    def?: number,
  ): Promise<{ value?: number } | null> {
    const raw = await vscode.window.showInputBox({
      title,
      prompt: `${prompt} — blank for default${def !== undefined ? ` (${def})` : ""}`,
      value: def !== undefined ? String(def) : "",
      validateInput: (value) => {
        const t = value.trim();
        if (t === "") {
          return undefined;
        }
        return /^\d+$/.test(t) && Number(t) > 0
          ? undefined
          : "Enter a positive integer, or leave blank";
      },
    });
    if (raw === undefined) {
      return null;
    }
    const t = raw.trim();
    return { value: t === "" ? undefined : Number(t) };
  }

  async startInstance(item: InstanceItem): Promise<void> {
    const name = item.instance.name;
    await this.withProgress(`Starting "${name}"`, () => this.manager.start(name));
  }

  async stopInstance(item: InstanceItem): Promise<void> {
    const name = item.instance.name;
    await this.withProgress(`Stopping "${name}"`, async () => {
      await this.manager.stop(name);
      this.disposeTerminal(name);
    });
  }

  async deleteInstance(item: InstanceItem): Promise<void> {
    const name = item.instance.name;
    const confirm = await vscode.window.showWarningMessage(
      `Delete SmolVM "${name}"? This destroys its storage.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }

    await this.withProgress(`Deleting "${name}"`, async () => {
      await this.manager.delete(name);
      this.disposeTerminal(name);
    });
  }

  async openShell(item: InstanceItem): Promise<void> {
    const name = item.instance.name;

    // Reuse an existing shell terminal for this machine if one is still open.
    const existing = this.terminals.get(name);
    if (existing) {
      existing.show();
      return;
    }

    // A shell needs a running machine; boot it via the SDK first if needed.
    if (item.instance.status !== "running") {
      await this.withProgress(`Starting "${name}"`, () =>
        this.manager.start(name),
      );
    }

    const cfg = vscode.workspace.getConfiguration("smolvm");
    const cli = cfg.get<string>("cliPath", "smolvm");
    const shell = cfg.get<string>("shell", "/bin/sh");

    // Open a normal terminal and run the CLI's interactive exec. The CLI's
    // `-it` gives a real PTY, which the SDK (exec/execStream only) cannot.
    const terminal = vscode.window.createTerminal({
      name: `SmolVM: ${name}`,
      iconPath: new vscode.ThemeIcon("terminal"),
    });
    this.terminals.set(name, terminal);
    terminal.show();
    terminal.sendText(
      `${cli} machine exec --name ${quoteArg(name)} -it -- ${shell}`,
    );
    this.refresh();
  }

  private disposeTerminal(name: string): void {
    const terminal = this.terminals.get(name);
    if (terminal) {
      this.terminals.delete(name);
      terminal.dispose();
    }
  }

  /** Run an async machine operation with a notification and unified error UI. */
  private async withProgress<T>(
    title: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title },
        work,
      );
      this.refresh();
      return result;
    } catch (err) {
      this.refresh();
      this.reportError(err);
      throw err;
    }
  }

  private reportError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`SmolVM: ${message}`);
  }
}

export class InstanceItem extends vscode.TreeItem {
  constructor(public readonly instance: InstanceInfo) {
    super(instance.name, vscode.TreeItemCollapsibleState.None);
    this.description = instance.status;
    this.contextValue = `instance-${instance.status}`;
    this.iconPath = new vscode.ThemeIcon(iconFor(instance.status));
    this.tooltip = `${instance.name} — ${instance.status}`;
  }
}

function iconFor(status: MachineState): string {
  return status === "running" ? "vm-running" : "vm-outline";
}

/** Single-quote an argument for a POSIX shell so machine names are safe. */
function quoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
