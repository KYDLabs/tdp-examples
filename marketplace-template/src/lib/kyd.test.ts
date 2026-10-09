import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWebStorage } from "oidc-client-ts";
import { authorizeResale, createKydUserManager, listFanTickets } from "./kyd";

void test("KYD sign-in uses matching modes, isolated storage, PKCE, and the registered callback", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "http://localhost:5173" },
      sessionStorage: new InMemoryWebStorage(),
    },
  });
  try {
    for (const environment of ["sandbox", "live"] as const) {
      const manager = createKydUserManager(
        {
          authority: "https://auth.kydlabs.com",
          clientId: "example-client",
          fanApiUrl: "https://api.kydlabs.com",
          scope: "openid profile fan:tickets:read",
        },
        environment,
      );
      assert.equal(
        manager.settings.redirect_uri,
        "http://localhost:5173/auth/callback",
      );
      assert.equal(manager.settings.response_type, "code");
      assert.equal(manager.settings.disablePKCE, false);
      assert.equal(manager.settings.loadUserInfo, true);
      assert.equal(manager.settings.automaticSilentRenew, false);
      assert.equal(
        manager.settings.extraQueryParams.mode,
        environment === "live" ? "production" : "sandbox",
      );
      await manager.settings.stateStore.set("pending-request", environment);
    }
    assert.equal(
      window.sessionStorage.getItem("oidc:sandbox:pending-request"),
      "sandbox",
    );
    assert.equal(
      window.sessionStorage.getItem("oidc:live:pending-request"),
      "live",
    );
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

void test("fan ticket reads keep large identifiers exact and send the fan token", async () => {
  const tickets = await listFanTickets(
    "fan-token",
    "https://api.kydlabs.com/",
    async (url, options) => {
      assert.equal(url, "https://api.kydlabs.com/fans/tickets");
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Bearer fan-token",
      );
      return Response.json({
        user_id: "fan-1",
        mode: "sandbox",
        tickets: [
          {
            id: "ticket-1",
            event_name: "Example event",
            on_chain_metadata: {
              tix_event_id: "18446744073709551615",
              tix_permit_id: 0,
            },
          },
        ],
      });
    },
  );
  assert.equal(tickets[0]?.event_name, "Example event");
  assert.equal(
    tickets[0]?.on_chain_metadata?.tix_event_id,
    "18446744073709551615",
  );
  assert.equal(tickets[0]?.on_chain_metadata?.tix_permit_id, "0");
});

void test("fan ticket IDs fall back per field and prefer nested metadata", async () => {
  const topLevel = {
    tix_event_id: "9785354150855233863",
    tix_id: "1",
  };
  const tickets = await listFanTickets(
    "token",
    "https://example.test",
    async () =>
      Response.json({
        tickets: [
          { id: "production", ...topLevel },
          { id: "empty", ...topLevel, on_chain_metadata: {} },
          {
            id: "partial",
            ...topLevel,
            on_chain_metadata: { tix_permit_id: "0" },
          },
          {
            id: "nested",
            ...topLevel,
            on_chain_metadata: { tix_event_id: "2", tix_permit_id: "3" },
          },
        ],
      }),
  );
  assert.deepEqual(
    tickets.map((ticket) => ticket.on_chain_metadata),
    [
      { tix_event_id: "9785354150855233863", tix_permit_id: "1" },
      { tix_event_id: "9785354150855233863", tix_permit_id: "1" },
      { tix_event_id: "9785354150855233863", tix_permit_id: "0" },
      { tix_event_id: "2", tix_permit_id: "3" },
    ] satisfies (typeof tickets)[number]["on_chain_metadata"][],
  );
});

void test("resale authorization sends the fan token and preserves KYD's signed bytes", async () => {
  const result = await authorizeResale(
    "fan-token",
    "https://api.kydlabsdemo.com/",
    "010203",
    async (url, options) => {
      assert.equal(url, "https://api.kydlabsdemo.com/fans/authorizations");
      assert.equal(options?.method, "POST");
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Bearer fan-token",
      );
      assert.equal(
        options?.body,
        JSON.stringify({ type: "list", transactions: ["010203"] }),
      );
      return Response.json({ transactions: ["040506"] } satisfies Record<
        "transactions",
        Awaited<ReturnType<typeof authorizeResale>>[]
      >);
    },
  );
  assert.equal(result, "040506");
  await assert.rejects(
    authorizeResale(
      "fan-token",
      "https://api.kydlabsdemo.com",
      "010203",
      async () => Response.json({ message: "Consent denied" }, { status: 403 }),
    ),
    /Consent denied/,
  );
  await assert.rejects(
    authorizeResale(
      "fan-token",
      "https://api.kydlabsdemo.com",
      "010203",
      async () => Response.json({ transactions: ["invalid"] }),
    ),
    /unexpected authorization/,
  );
});

void test("fan API failures and invalid responses are visible to the caller", async () => {
  await assert.rejects(
    listFanTickets("fan-token", "https://api.kydlabs.com", async () =>
      Response.json({ message: "Consent grant revoked" }, { status: 401 }),
    ),
    /Consent grant revoked/,
  );
  await assert.rejects(
    listFanTickets("fan-token", "https://api.kydlabs.com", async () =>
      Response.json({ tickets: [{ event_name: "Missing ID" }] }),
    ),
    /ticket without an ID/,
  );
  await assert.rejects(
    listFanTickets("fan-token", "https://api.kydlabs.com", async () =>
      Response.json({ items: [] }),
    ),
    /unexpected ticket response/,
  );
});
