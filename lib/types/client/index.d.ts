/**
 * Public surface of dsh-skill-manager's browser half.
 *
 * The harness evaluates `lib/client.js` as a classic script; it calls
 * `window.__ModuleLoader__.load({ id, factory })` and the factory returns this
 * shape. `react` is the only module the factory may `require`, because the
 * platform seed provides it.
 */

import type { FC } from "react";

/** Seats this plugin registers into. Both are optional at runtime. */
export declare const inject: readonly ["slots", "locale"];

/** Cordis plugin name, also the module-loader registration id. */
export declare const name: "dsh-skill-manager";

/**
 * Mount the sidebar row and the manager panel.
 * @param ctx - client root context with `slots`; `locale` is optional.
 */
export declare function apply(ctx: unknown): void;

/** The sidebar row's icon. */
export declare const PanelIcon: FC;
/** The manager page. */
export declare const ManagerPanel: FC<{ api: { selectPanel(panelId: string | null): void } }>;
