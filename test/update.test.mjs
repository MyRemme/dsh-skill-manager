import assert from "node:assert/strict";
import test from "node:test";
import { MarketError } from "../lib/market.js";
import { REPO, REPO_URL, SUBMIT_URL, compare, compareVersions, fetchLatestVersion } from "../lib/update.js";

test("the exported coordinates point at this repository", () => {
  assert.equal(REPO, "MyRemme/dsh-skill-manager");
  assert.equal(REPO_URL, `https://github.com/${REPO}`);
  assert.equal(SUBMIT_URL, `${REPO_URL}/issues/new`);
});

test("compareVersions orders dotted versions", () => {
  assert.ok(compareVersions("0.2.0", "0.1.0") > 0);
  assert.ok(compareVersions("0.1.0", "0.2.0") < 0);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0, "10 must beat 9 numerically, not as text");
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.ok(compareVersions("0.2.0", "0.2.0-rc.1") > 0, "a release outranks its prerelease");
});

/** A fetch stub that answers the contents API for one given manifest body. */
function stubManifest(body, status = 200) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(String(url));
    if (status !== 200) return new Response("nope", { status });
    return new Response(JSON.stringify({ content: Buffer.from(body, "utf8").toString("base64"), size: body.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { seen, restore: () => { globalThis.fetch = original; } };
}

test("fetchLatestVersion reads the version out of the remote manifest", async () => {
  const stub = stubManifest(JSON.stringify({ name: "dsh-skill-manager", version: "9.9.9" }));
  try {
    const result = await fetchLatestVersion();
    assert.equal(result.version, "9.9.9");
    assert.equal(result.ref, "main");
    assert.ok(result.url.includes("package.json"));
    assert.ok(stub.seen[0].includes("api.github.com/repos/MyRemme/dsh-skill-manager"));
  } finally {
    stub.restore();
  }
});

test("fetchLatestVersion refuses a repository coordinate that is not owner/name", async () => {
  await assert.rejects(() => fetchLatestVersion({ repo: "not-a-repo" }), MarketError);
  await assert.rejects(() => fetchLatestVersion({ repo: "a/.." }), MarketError);
});

test("fetchLatestVersion reports an HTTP failure rather than inventing a version", async () => {
  const stub = stubManifest("{}", 403);
  try {
    await assert.rejects(() => fetchLatestVersion(), /HTTP 403/u);
  } finally {
    stub.restore();
  }
});

test("fetchLatestVersion rejects a manifest with no version field", async () => {
  const stub = stubManifest(JSON.stringify({ name: "dsh-skill-manager" }));
  try {
    await assert.rejects(() => fetchLatestVersion(), /declares no version/u);
  } finally {
    stub.restore();
  }
});

test("fetchLatestVersion rejects a manifest that is not JSON", async () => {
  const stub = stubManifest("this is not json");
  try {
    await assert.rejects(() => fetchLatestVersion(), /not valid JSON/u);
  } finally {
    stub.restore();
  }
});

test("a network failure is reported, not swallowed", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("read ECONNRESET");
  };
  try {
    await assert.rejects(() => fetchLatestVersion(), /cannot reach/u);
  } finally {
    globalThis.fetch = original;
  }
});

test("compare classifies the three real outcomes", () => {
  assert.equal(compare("0.1.0", "0.1.0").status, "current");
  assert.equal(compare("0.1.0", "0.2.0").status, "behind");
  assert.equal(compare("0.2.0", "0.1.0").status, "ahead");
  assert.equal(compare("0.1.0", "0.2.0").latest, "0.2.0");
});

test("compare reports unknown instead of guessing when a side is missing", () => {
  for (const [current, latest] of [[undefined, "1.0.0"], ["1.0.0", undefined], ["", "1.0.0"], ["1.0.0", ""]]) {
    assert.equal(compare(current, latest).status, "unknown", `${current} vs ${latest}`);
  }
});
