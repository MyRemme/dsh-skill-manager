/**
 * Access fence for the manager's HTTP routes.
 *
 * Every route can create, rewrite and delete files under a skill root, so the
 * default posture is the same one the official client uses: loopback callers,
 * plus devices that completed the LAN pairing handshake. `access: "lan"` widens
 * that to any same-origin caller and exists for key-free LAN setups; it is a
 * deliberate choice, not a default.
 *
 * @module dsh-skill-manager/guard
 */

const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

/**
 * Decide whether a hostname denotes the local machine.
 * @param hostname - value from the request Host header.
 * @returns true for loopback names and addresses.
 */
export function isLoopbackHostname(hostname) {
  const name = String(hostname).toLowerCase().replace(/^\[|\]$/gu, "");
  if (name === "localhost" || name === "::1" || name === "0:0:0:0:0:0:0:1") return true;
  if (name.endsWith(".localhost")) return true;
  return LOOPBACK_V4.test(name);
}

function parseHost(request) {
  const header = request.headers?.host;
  if (typeof header !== "string") return undefined;
  try {
    return new URL(`http://${header}`);
  } catch {
    return undefined;
  }
}

/**
 * Whether the request reached the server over a loopback origin.
 * @param request - incoming HTTP request.
 * @returns true when host, fetch metadata and origin all agree on loopback.
 */
export function isLoopbackRequest(request) {
  const host = parseHost(request);
  if (host === undefined) return false;
  if (!isLoopbackHostname(host.hostname)) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host.host;
  } catch {
    return false;
  }
}

/** True when the request is a same-origin browser request to this very server. */
function isSameOriginRequest(request) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = parseHost(request);
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host.host;
  } catch {
    return false;
  }
}

/**
 * Resolve the pairing service when the LAN plugin is installed.
 * @param ctx - host plugin context.
 * @returns a service exposing `isPairedDevice`, or undefined.
 */
export function pairingService(ctx) {
  const fromContext = typeof ctx.get === "function" ? ctx.get("remoteWebUiPairing", false) : undefined;
  const candidate = fromContext ?? ctx.remoteWebUiPairing;
  if (candidate !== undefined && candidate !== null && typeof candidate.isPairedDevice === "function") return candidate;
  return undefined;
}

/**
 * Decide whether a request may enter the manager's routes.
 * @param ctx - host plugin context.
 * @param request - incoming HTTP request.
 * @param access - `loopback` | `paired` | `lan`.
 * @returns true when the caller is allowed.
 */
export function isAllowed(ctx, request, access = "paired") {
  if (isLoopbackRequest(request)) return true;
  if (access === "loopback") return false;
  if (access === "lan") return isSameOriginRequest(request);
  return pairingService(ctx)?.isPairedDevice(request) === true;
}
