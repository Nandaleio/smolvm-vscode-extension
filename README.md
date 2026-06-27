# SmolVM VSCode

<p align="center">
  <img src="media/smolmachines.png" alt="smol machines" width="240">
</p>



A VS Code extension to manage [SmolVM](https://smolmachines.com/)
microVM sandboxes from within the editor, driven by the `smolvm` CLI.

## Features

- **SmolVM** activity-bar view listing your machines and their status. The list
  is populated from `smolvm machine ls --json` at startup and refreshed
  periodically (and after each action).
- Create, start, stop, and delete machines from the view title bar and inline
  actions — each shells out to the matching `smolvm machine` subcommand.
- **Open Shell**: drop into a running machine in a dedicated VS Code terminal.
- **Run Command**: execute a command in a machine and stream its output.

### About the shell

**Open Shell** opens a normal VS Code terminal and runs the `smolvm` CLI:

```bash
smolvm machine exec --name <name> -it -- /bin/sh
```

The CLI's `-it` provides a real interactive PTY (so `vim`, `top`, etc. work).
Configure the CLI binary with `smolvm.cliPath` (default `smolvm`) and the in-VM
shell with `smolvm.shell` (default `/bin/sh`). The machine is started first if
it isn't already running.

## Requirements

The **`smolvm` CLI must be installed** and on your `PATH` (or pointed at via the
`smolvm.cliPath` setting). The extension shells out to it for every action —
listing, creating, starting, stopping, deleting, and exec/shell — so nothing
works without it. See [smolmachines.com](https://smolmachines.com/) for install
instructions.

## Configuration

Creating a machine walks you through its configuration (image, resources, and
the folder to bind). Number/image fields are pre-filled with the defaults below
— press Enter to accept, edit to override, or blank to fall back. For the mount
you choose **Workspace root**, **Choose folder…** (a folder picker over the
filesystem), or **Don't mount**; by default the workspace root is bind-mounted
(read-write) at `/workspace`.

Each setting below maps to a `smolvm machine create` flag. Optional ones
(`null`/empty) are omitted so the CLI applies its own defaults.

| Setting                       | Default      | Purpose                                  |
| ----------------------------- | ------------ | ---------------------------------------- |
| `smolvm.cliPath`              | `smolvm`     | `smolvm` CLI binary (list + Open Shell).   |
| `smolvm.refreshIntervalSeconds` | `60`       | Polling interval for `machine ls` (`0` = off). |
| `smolvm.shell`                | `/bin/sh`    | In-VM shell launched by Open Shell.      |
| `smolvm.image`                | `""`         | Default base OCI image for new machines (blank = bare Alpine).  |
| `smolvm.mountSource`          | `""`         | Host folder to bind (blank = workspace root). |
| `smolvm.workspaceMount`       | `/workspace` | In-VM path to bind the chosen folder.     |
| `smolvm.ports`                | `[]`         | Host→guest port mappings.                 |
| `smolvm.resources.cpus`       | `2`          | vCPUs for new machines.                  |
| `smolvm.resources.memoryMb`   | `1024`       | Memory (MB) for new machines.            |
| `smolvm.resources.network`    | `true`       | Outbound network access for new machines.|
| `smolvm.resources.storageGb`  | unset (20)   | Storage disk size (GB) for new machines.  |
| `smolvm.resources.overlayGb`  | unset (10)   | Overlay disk size (GB) for new machines.  |

## Project layout

| Path                       | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `src/extension.ts`         | Activation entry point; registers commands.          |
| `src/cli.ts`               | `smolvm` process execution (run + streaming exec).   |
| `src/machineManager.ts`    | Machine registry + create/start/stop/delete logic.   |
| `src/types.ts`             | Shared model/type definitions.                       |
| `src/instanceProvider.ts`  | Tree data provider; delegates to the manager.        |
| `esbuild.js`               | Bundler configuration.                               |
| `package.json`             | Extension manifest (views, commands, menus, config). |
