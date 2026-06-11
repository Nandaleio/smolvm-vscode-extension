# SmolVM VSCode

<p align="center">
  <img src="media/smolmachines.png" alt="smol machines" width="240">
</p>



A VS Code extension to manage [SmolVM](https://smolmachines.com/)
microVM sandboxes from within the editor, powered by the
[`smolvm-sdk Node JS SDK`](https://github.com/smol-machines/smolvm-sdk).

## Features

- **SmolVM** activity-bar view listing your machines and their status. The list
  is populated from `smolvm machine ls --json` at startup and refreshed
  periodically (and after each action).
- Create, start, stop, and delete machines from the view title bar and inline
  actions — all backed by the `smolmachines` SDK.
- **Open Shell**: drop into a running machine in a dedicated VS Code terminal.
- The machine registry (names + last-known status) is persisted in workspace
  state; machines are created `persistent` so they can be reconnected after a
  reload.

### About the shell

The SDK exposes `exec`/`execStream`, not an interactive PTY, so **Open Shell**
opens a normal VS Code terminal and runs the `smolvm` CLI:

```bash
smolvm machine exec --name <name> -it -- /bin/sh
```

The CLI's `-it` provides a real interactive PTY (so `vim`, `top`, etc. work).
Configure the CLI binary with `smolvm.cliPath` (default `smolvm`) and the in-VM
shell with `smolvm.shell` (default `/bin/sh`). The machine is started via the
SDK first if it isn't already running.

## Requirements

`smolmachines` links a native engine. Per its docs, the local (embedded)
transport needs **macOS Apple Silicon** or **Linux x64/arm64 with glibc ≥ 2.34
and KVM**. On unsupported hosts the SDK calls will fail at runtime.

## Getting started

> `smolmachines` is kept **external** from the bundle (it loads a platform
> specific `.node` addon at runtime) and is shipped in the packaged extension
> via a `.vscodeignore` negation.

## Configuration

Creating a machine walks you through its configuration (image, resources, and
the folder to bind). Number/image fields are pre-filled with the defaults below
— press Enter to accept, edit to override, or blank to fall back. For the mount
you choose **Workspace root**, **Choose folder…** (a folder picker over the
filesystem), or **Don't mount**; by default the workspace root is bind-mounted
(read-write) at `/workspace`.

All settings below map to the SDK's `MachineConfig`. Optional ones (`null`/empty)
are omitted so the SDK applies its own defaults.

| Setting                       | Default      | Purpose                                  |
| ----------------------------- | ------------ | ---------------------------------------- |
| `smolvm.cliPath`              | `smolvm`     | `smolvm` CLI binary (list + Open Shell).   |
| `smolvm.refreshIntervalSeconds` | `60`       | Polling interval for `machine ls` (`0` = off). |
| `smolvm.shell`                | `/bin/sh`    | In-VM shell launched by Open Shell.      |
| `smolvm.image`                | `""`         | Default base OCI image for new machines (blank = bare Alpine).  |
| `smolvm.mountSource`          | `""`         | Host folder to bind (blank = workspace root). |
| `smolvm.workspaceMount`       | `/workspace` | In-VM path to bind the chosen folder.     |
| `smolvm.persistent`           | `true`       | Keep machines for reconnect (needed for Start/Shell after reload). |
| `smolvm.ports`                | `[]`         | Host→guest port mappings.                 |
| `smolvm.autoStopSeconds`      | unset        | Auto-stop after N idle seconds (cloud).   |
| `smolvm.ttlSeconds`           | unset        | Delete after N seconds (cloud).           |
| `smolvm.resources.cpus`       | `2`          | vCPUs for new machines.                  |
| `smolvm.resources.memoryMb`   | `1024`       | Memory (MB) for new machines.            |
| `smolvm.resources.network`    | `true`       | Outbound network access for new machines.|
| `smolvm.resources.storageGb`  | unset (20)   | Storage disk size (GB) for new machines.  |
| `smolvm.resources.overlayGb`  | unset (10)   | Overlay disk size (GB) for new machines.  |

## Project layout

| Path                       | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `src/extension.ts`         | Activation entry point; registers commands.          |
| `src/machineManager.ts`    | SDK wrapper: registry + create/start/stop/delete.    |
| `src/instanceProvider.ts`  | Tree data provider; delegates to the manager.        |
| `esbuild.js`               | Bundler configuration.                               |
| `package.json`             | Extension manifest (views, commands, menus, config). |
