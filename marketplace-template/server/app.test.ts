import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  createTdpClient,
  type GetIntegratorInfoResponse,
  type GetIntegratorResponse,
} from "@tixprotocol/tdp-sdk";
import type { TdpApiError } from "@tixprotocol/tdp-sdk/errors";
import {
  Base58Address,
  IntegratorAccountResponseSchema,
} from "@tixprotocol/tdp-sdk/schemas";
import { createApp } from "./app";
import { getPublicConfig, readServerConfig } from "./config";

async function withServer(
  config: ReturnType<typeof readServerConfig>,
  run: (baseUrl: string) => Promise<void>,
  client?: Parameters<typeof createApp>[1],
) {
  const server = createApp(config, client).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await run(baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("public config exposes setup state without the key", async () => {
  const config = readServerConfig({ TDP_API_KEY: "private-test-key" });
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(body.includes("private-test-key"), false);
    assert.deepEqual(JSON.parse(body), {
      environment: "sandbox",
      configured: true,
      checkoutEnabled: true,
      kyd: null,
    });
  });
  await withServer(readServerConfig({}), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/events`)).status, 503);
  });
});

test("checkout works with a configured key in either environment and server mode", () => {
  const env = { TDP_API_KEY: "key" };
  assert.equal(getPublicConfig(readServerConfig(env)).checkoutEnabled, true);
  assert.equal(readServerConfig(env, true).checkoutEnabled, true);
  assert.equal(readServerConfig({}).checkoutEnabled, false);
  assert.equal(
    readServerConfig({ ...env, TDP_ENVIRONMENT: "live" }, true).checkoutEnabled,
    true,
  );
  assert.throws(() => readServerConfig({ TDP_ENVIRONMENT: "staging" }));
  assert.throws(() =>
    readServerConfig({ TDP_API_BASE_URL: "https://example.com/rpc" }),
  );
});

test("API hostname and key cannot silently change the selected environment", () => {
  assert.throws(() =>
    readServerConfig({ TDP_API_BASE_URL: "https://api.tix.xyz" }),
  );
  assert.throws(() =>
    readServerConfig({
      TDP_ENVIRONMENT: "live",
      TDP_API_BASE_URL: "https://api.sandbox.tix.xyz",
    }),
  );
  assert.throws(() =>
    readServerConfig({ TDP_API_KEY: "tdp_live_example_secret" }),
  );
  assert.equal(
    readServerConfig({
      TDP_API_KEY: "key",
      TDP_API_BASE_URL: "http://localhost:8888",
    }).checkoutEnabled,
    true,
  );
  assert.equal(
    readServerConfig({
      TDP_API_BASE_URL: "https://api.sandbox.example.test",
      TDP_API_KEY: "tdp_sandbox_example_secret",
    }).environment,
    "sandbox",
  );
});

test("catalog routes forward cursor through the published SDK and reject invalid queries", async () => {
  const requests: URL[] = [];
  const client = createTdpClient({
    baseApiUrl: "https://api.sandbox.tix.xyz",
    apiKey: "key",
    fetchImpl: async (input) => {
      requests.push(new URL(String(input)));
      return Response.json({ items: [], next_cursor: "next-page" });
    },
  });
  await withServer(
    readServerConfig({ TDP_API_KEY: "key" }),
    async (baseUrl) => {
      for (const path of [
        "events?cursor=page-2",
        "listings?eventId=0&cursor=page-2",
      ]) {
        const response = await fetch(`${baseUrl}/api/${path}`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          items: [],
          next_cursor: "next-page",
        });
      }
      for (const query of ["", "?eventId=bad", "?eventId=1&eventId=2"]) {
        assert.equal(
          (await fetch(`${baseUrl}/api/listings${query}`)).status,
          400,
        );
      }
      assert.equal(
        (await fetch(`${baseUrl}/api/events?cursor=a&cursor=b`)).status,
        400,
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/listings/1/18446744073709551616`)).status,
        400,
      );
    },
    client,
  );
  assert.deepEqual(
    requests.map((url) => url.pathname),
    ["/events/upcoming", "/listings/active"],
  );
  assert.equal(requests[0].searchParams.get("limit"), "24");
  assert.equal(requests[0].searchParams.get("cursor"), "page-2");
  assert.equal(requests[1].searchParams.get("limit"), "24");
  assert.equal(requests[1].searchParams.get("eventId"), "0");
  assert.equal(requests[1].searchParams.get("cursor"), "page-2");
});

test("upstream failures return a useful message without exposing its payload", async () => {
  const client = createTdpClient({
    baseApiUrl: "https://api.sandbox.tix.xyz",
    apiKey: "key",
    fetchImpl: async () =>
      Response.json({ message: "private-upstream-detail" }, { status: 403 }),
  });
  await withServer(
    readServerConfig({ TDP_API_KEY: "key" }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/events`);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "The API key lacks permission for this operation.",
      });
    },
    client,
  );
});

test("API failures retain the code and request ID without exposing the payload", async () => {
  const diagnostics = {
    code: "PERMISSION_DENIED",
    requestId: "request-403",
  } satisfies Pick<TdpApiError, "code" | "requestId">;
  const client = createTdpClient({
    baseApiUrl: "https://api.sandbox.tix.xyz",
    apiKey: "key",
    fetchImpl: async () =>
      Response.json(
        { code: diagnostics.code, message: "private-upstream-detail" },
        { status: 403, headers: { "apigw-requestid": diagnostics.requestId } },
      ),
  });
  await withServer(
    readServerConfig({ TDP_API_KEY: "key" }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/events`);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "The API key lacks permission for this operation.",
        ...diagnostics,
      });
    },
    client,
  );
});

test("invalid successful SDK responses return a gateway error and request ID", async () => {
  const client = createTdpClient({
    baseApiUrl: "https://api.sandbox.tix.xyz",
    apiKey: "key",
    fetchImpl: async () =>
      Response.json(
        { items: "private-invalid-payload" },
        { headers: { "apigw-requestid": "request-invalid-response" } },
      ),
  });
  await withServer(
    readServerConfig({ TDP_API_KEY: "key" }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/events`);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "TDP returned an unexpected response. Try again shortly.",
        requestId: "request-invalid-response",
      });
    },
    client,
  );
});

test("treasury lookup reads the integrator through the SDK", async () => {
  const address = Base58Address.parse("11111111111111111111111111111111");
  const info = { address } satisfies GetIntegratorInfoResponse;
  const integratorAccount = IntegratorAccountResponseSchema.parse({
    integrator_pda: address,
    integrator: {
      authority: address,
      status: "Active",
      treasury_usdc: address,
      balance: { amount_minor: "1000000", decimals: 6 },
    },
  });
  const requests: string[] = [];
  const client = createTdpClient({
    baseApiUrl: "https://api.sandbox.tix.xyz",
    apiKey: "key",
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      return Response.json(path === "/integrator" ? info : integratorAccount);
    },
  });
  await withServer(
    readServerConfig({ TDP_API_KEY: "key" }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/treasury`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        integrator_pda: address,
        integrator: {
          authority: address,
          status: "Active",
          treasury_usdc: address,
          balance: { amount_cents: 100 },
        },
      } satisfies GetIntegratorResponse);
    },
    client,
  );
  assert.deepEqual(requests, ["/integrator", `/solana/integrators/${address}`]);
});

test("checkout rejects cross-origin requests before calling the SDK", async () => {
  await withServer(
    readServerConfig({ TDP_API_KEY: "key" }),
    async (baseUrl) => {
      for (const path of [
        "/api/checkout",
        "/api/resale/1/2/prepare",
        "/api/resale/submit",
      ]) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            Origin: "https://other.example",
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        assert.equal(response.status, 403);
      }
    },
  );
});
