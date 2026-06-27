/** Lifecycle state of a machine (subset reported by `machine ls --json`). */
export type MachineState = "created" | "running" | "stopped";

/** Host directory bind-mounted into a machine. */
export interface MountSpec {
  source: string;
  target: string;
  readonly?: boolean;
}

/** Host→guest port mapping. */
export interface PortSpec {
  host: number;
  guest: number;
}

/** CPU / memory / disk / network allocation. */
export interface ResourceSpec {
  cpus?: number;
  memoryMb?: number;
  network?: boolean;
  storageGb?: number;
  overlayGb?: number;
}

/** Configuration for a new machine (subset the `smolvm` CLI accepts). */
export interface MachineConfig {
  name?: string;
  image?: string;
  resources?: ResourceSpec;
  ports?: PortSpec[];
  mounts?: MountSpec[];
}

/** A machine as listed by `machine ls --json`. */
export interface InstanceInfo {
  name: string;
  status: MachineState;
}

/** A line/chunk of exec output, or its terminal exit/error event. */
export type ExecEvent =
  | { kind: "stdout"; data: string }
  | { kind: "stderr"; data: string }
  | { kind: "exit"; exitCode: number }
  | { kind: "error"; message: string };
