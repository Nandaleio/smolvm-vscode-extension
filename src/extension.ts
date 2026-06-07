import * as vscode from "vscode";
import { Machine } from "smolmachines";
import { InstanceProvider } from "./instanceProvider";
import { MachineManager } from "./machineManager";

export function activate(context: vscode.ExtensionContext): void {
  const manager = new MachineManager(context, Machine);
  const provider = new InstanceProvider(context, manager);

  const treeView = vscode.window.createTreeView("smolvm.instances", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand("smolvm.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("smolvm.createInstance", () =>
      provider.createInstance(),
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
    vscode.commands.registerCommand("smolvm.deleteInstance", (item) =>
      provider.deleteInstance(item),
    ),
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables registered in activate().
}
