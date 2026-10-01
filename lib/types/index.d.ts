/**
 * Public surface of dsh-skill-manager's host half.
 *
 * The plugin is loaded by the harness' cordis loader, which reads `name`,
 * `inject` and `apply` from the module. `apply` registers the
 * `/api/dsh-skill-manager` route family on the shared web server.
 */

/** Cordis plugin name. */
export declare const name: "skill-manager";

/** Services that must be present before the routes mount. */
export declare const inject: readonly ["webServer"];

/** Access posture for the HTTP routes. */
export type AccessMode = "loopback" | "paired" | "lan";

/** Overwrite policy when an install would replace an existing skill. */
export type OverwriteMode = "skip" | "trash";

/** Plugin configuration, as read from the profile's `cordis.patch.yml`. */
export interface SkillManagerConfig {
  /** Set false to mount no routes at all. Defaults to true. */
  enabled?: boolean;
  /** Who may reach the routes. Defaults to `paired`. */
  access?: AccessMode;
  /** Catalog URL behind the market tab. Defaults to this repository's `registry/skills.json`. */
  registryUrl?: string;
  /** How long a fetched catalog is reused. Defaults to ten minutes. */
  registryTtlMs?: number;
  /** Harness config root whose `skills` subdirectory is the user skill root. */
  dshHome?: string;
  /** Shared agent config root. */
  agentsHome?: string;
  /** Extra skill roots, scanned between the project and user roots. */
  customSkillDirs?: string[];
  /** Cap on a single ZIP upload or host-path import. Defaults to 16 MiB. */
  maxUploadBytes?: number;
  /** Cap on the total expanded size of one import. Defaults to 64 MiB. */
  maxExtractBytes?: number;
  /** Cap on the number of files in one import. Defaults to 4096. */
  maxEntries?: number;
  /** Cap on a single file inside an import. Defaults to 8 MiB. */
  maxFileBytes?: number;
  /** Cap on how many skills one import may define. Defaults to 64. */
  maxSkills?: number;
}

/** One skill as the manager reports it. */
export interface SkillRecord {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
  userInvocable: boolean;
  /** Absolute path of the file the harness reads. */
  path: string;
  /** Directory that holds the skill, or the owning root for a flat skill. */
  directory: string;
  form: "directory" | "file";
  /** Owning root, e.g. `user-dsh` or `custom:0`. */
  root: string;
  rank: number;
  /** Whether the manager is allowed to write to this root. */
  writable: boolean;
  symlink: boolean;
  /** A nearer root serves the same skill name. */
  shadowed: boolean;
  bytes: number;
}

/** One outcome of an install. */
export interface InstallResult {
  name: string;
  status: "installed" | "skipped" | "failed";
  path?: string;
  reason?: string;
  files?: number;
}

/**
 * Mount the manager's HTTP routes.
 * @param ctx - host plugin context; must expose `webServer`.
 * @param config - resolved plugin configuration.
 */
export declare function apply(ctx: unknown, config?: SkillManagerConfig): void;
