import assert from "node:assert/strict";
import { test } from "node:test";
import { requestJson } from "./api";

test("browser errors retain API diagnostics and the order retry decision", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: "The operation conflicts with the ticket state.",
        code: "TICKET_CONFLICT",
        requestId: "request-409",
        canStartNewOrder: true,
      },
      { status: 409 },
    ),
  );
  await assert.rejects(requestJson("/api/checkout"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      "The operation conflicts with the ticket state.",
    );
    assert.ok("code" in error);
    assert.equal(error.code, "TICKET_CONFLICT");
    assert.ok("requestId" in error);
    assert.equal(error.requestId, "request-409");
    assert.ok("canStartNewOrder" in error);
    assert.equal(error.canStartNewOrder, true);
    return true;
  });
});

test("browser errors ignore non-string diagnostics", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: "Unavailable", code: 502, requestId: { private: "detail" } },
      { status: 502 },
    ),
  );
  await assert.rejects(requestJson("/api/events"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Unavailable");
    assert.ok("code" in error);
    assert.equal(error.code, undefined);
    assert.ok("requestId" in error);
    assert.equal(error.requestId, undefined);
    assert.ok("canStartNewOrder" in error);
    assert.equal(error.canStartNewOrder, false);
    return true;
  });
});

test("non-JSON failures retain the HTTP status in the browser message", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Unavailable", { status: 503 }),
  );
  await assert.rejects(requestJson("/api/events"), /Request failed \(503\)/);
});
