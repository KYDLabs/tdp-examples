import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const key = "test-key-not-a-credential";

function run(script: string, options: { key?: string; status?: number; networkError?: boolean } = {}) {
  const preload = `
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (${options.networkError ?? false}) throw new Error('Network error with secret: ' + request.headers.get('x-api-key'));
      console.log(JSON.stringify({
        url: request.url,
        method: request.method,
        keyPresent: request.headers.get('x-api-key') === 'test-key-not-a-credential',
        hasSignal: !!request.signal
      }));
      return new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: ${options.status ?? 200},
        headers: { 'content-type': 'application/json' }
      });
    };
  `;
  return spawnSync(process.execPath, [
    "--import", "tsx",
    "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    script,
  ], {
    cwd: import.meta.dirname,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, TDP_API_KEY: options.key ?? "", NODE_OPTIONS: "" },
  });
}

for (const [script, path] of [
  ["list-events.ts", "/tix-indexer/events/upcoming"],
  ["list-listings.ts", "/tix-indexer/listings/active"],
]) {
  test(`${script}: authenticated sandbox GET accepts empty results`, () => {
    const result = run(script, { key });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const [request, ...body] = result.stdout.trim().split("\n");
    assert.deepEqual(JSON.parse(request), {
      url: `https://api.sandbox.tix.xyz${path}?limit=10`,
      method: "GET",
      keyPresent: true,
      hasSignal: true,
    });
    assert.deepEqual(JSON.parse(body.join("\n")), { items: [], next_cursor: null });
  });

  test(`${script}: missing and whitespace-only keys fail before a request`, () => {
    for (const value of ["", "   "]) {
      const result = run(script, { key: value });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /Set TDP_API_KEY/);
    }
  });

  test(`${script}: HTTP failures do not expose credentials`, () => {
    for (const status of [401, 403, 500]) {
      const result = run(script, { key, status });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Request failed/);
      assert.ok(!(result.stdout + result.stderr).includes(key));
    }
  });

  test(`${script}: network errors do not expose credentials`, () => {
    const result = run(script, { key, networkError: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Request failed/);
    assert.ok(!(result.stdout + result.stderr).includes(key));
  });
}

test("README local links resolve within this repository", () => {
  const base = new URL("../README.md", import.meta.url);
  const guide = readFileSync(base, "utf8");
  for (const [, target] of guide.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(target)) continue;
    assert.ok(existsSync(new URL(target.split("#")[0], base)), target);
  }
});
