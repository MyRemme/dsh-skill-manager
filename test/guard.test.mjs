import assert from "node:assert/strict";
import test from "node:test";
import { isAllowed, isLoopbackHostname, isLoopbackRequest, pairingService } from "../lib/guard.js";

const request = (headers) => ({ headers });

test("isLoopbackHostname recognises loopback names and addresses", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("127.5.6.7"), true);
  assert.equal(isLoopbackHostname("::1"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("app.localhost"), true);
  assert.equal(isLoopbackHostname("192.168.1.22"), false);
  assert.equal(isLoopbackHostname("example.com"), false);
  assert.equal(isLoopbackHostname("127.0.0.1.example.com"), false);
});

test("isLoopbackRequest requires host, fetch metadata and origin to agree", () => {
  assert.equal(isLoopbackRequest(request({ host: "127.0.0.1:19387" })), true);
  assert.equal(isLoopbackRequest(request({ host: "127.0.0.1:19387", origin: "http://127.0.0.1:19387" })), true);
  assert.equal(isLoopbackRequest(request({ host: "192.168.1.22:19387" })), false);
  assert.equal(isLoopbackRequest(request({ host: "127.0.0.1:19387", "sec-fetch-site": "cross-site" })), false);
  assert.equal(isLoopbackRequest(request({ host: "127.0.0.1:19387", origin: "http://evil.example" })), false);
  assert.equal(isLoopbackRequest(request({})), false);
});

test("paired access admits a device the pairing service vouches for", () => {
  const ctx = { get: (key) => (key === "remoteWebUiPairing" ? { isPairedDevice: (req) => req.headers.cookie === "paired" } : undefined) };
  assert.equal(isAllowed(ctx, request({ host: "192.168.1.22:19387", cookie: "paired" }), "paired"), true);
  assert.equal(isAllowed(ctx, request({ host: "192.168.1.22:19387", cookie: "nope" }), "paired"), false);
  assert.equal(isAllowed(ctx, request({ host: "127.0.0.1:19387" }), "paired"), true, "loopback is always allowed");
});

test("a missing pairing service does not admit LAN callers", () => {
  assert.equal(isAllowed({}, request({ host: "192.168.1.22:19387", cookie: "paired" }), "paired"), false);
});

test("access=loopback refuses every non-loopback caller", () => {
  const ctx = { remoteWebUiPairing: { isPairedDevice: () => true } };
  assert.equal(isAllowed(ctx, request({ host: "192.168.1.22:19387" }), "loopback"), false);
});

test("access=lan admits same-origin LAN callers only", () => {
  assert.equal(isAllowed({}, request({ host: "192.168.1.22:19387", origin: "http://192.168.1.22:19387" }), "lan"), true);
  assert.equal(isAllowed({}, request({ host: "192.168.1.22:19387", origin: "http://evil.example" }), "lan"), false);
  assert.equal(isAllowed({}, request({ host: "192.168.1.22:19387", "sec-fetch-site": "cross-site" }), "lan"), false);
});

test("pairingService ignores a service without isPairedDevice", () => {
  assert.equal(pairingService({ remoteWebUiPairing: {} }), undefined);
  const service = { isPairedDevice: () => true };
  assert.equal(pairingService({ remoteWebUiPairing: service }), service);
  assert.equal(pairingService({ get: () => service }), service);
});
