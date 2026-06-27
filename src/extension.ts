import * as vscode from "vscode";
import { Machine } from "smolmachines";
import { InstanceProvider } from "./instanceProvider";
import { MachineManager } from "./machineManager";

export function activate(context: vscode.ExtensionContext): void {
  const manager = new MachineManager(Machine);
  const provider = new InstanceProvider(context, manager);

  const treeView = vscode.window.createTreeView("smolvm.instances", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand("smolvm.refresh", () => provider.reload(true)),
    vscode.commands.registerCommand("smolvm.createInstance", () =>
      provider.createInstance(),
    ),
    vscode.commands.registerCommand("smolvm.createFromSmolfile", () =>
      provider.createFromSmolfile(),
    ),
    vscode.commands.registerCommand("smolvm.startInstance", (item) =>
      provider.startInstance(item),
    ),
    vscode.commands.registerCommand("smolvm.stopInstance", (item) =>
      provider.stopInstance(item),
    ),
    vscode.commands.registerCommand("smolvm.openShell", (item) =>
      provider.openShell(item),
    ),
    vscode.commands.registerCommand("smolvm.execCommand", (item) =>
      provider.execCommand(item),
    ),
    vscode.commands.registerCommand("smolvm.deleteInstance", (item) =>
      provider.deleteInstance(item),
    ),
  );

  // Populate the list from `smolvm machine ls` now, then poll periodically.
  // Only spawn the CLI while the view is actually visible; refresh on reveal so
  // a hidden-then-shown panel is immediately current.
  void provider.reload();
  const intervalSeconds = vscode.workspace
    .getConfiguration("smolvm")
    .get<number>("refreshIntervalSeconds", 60);
  if (intervalSeconds > 0) {
    const timer = setInterval(() => {
      if (treeView.visible) void provider.reload();
    }, intervalSeconds * 1000);
    context.subscriptions.push(
      { dispose: () => clearInterval(timer) },
      treeView.onDidChangeVisibility((e) => {
        if (e.visible) void provider.reload();
      }),
    );
  }
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables registered in activate().
}
