import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  type CreateAndSubmitOrderInput,
  type CreateAndSubmitOrderResponse,
  createTdpClient,
} from "@tixprotocol/tdp-sdk";
import {
  Base58Address,
  CreateAndSubmitOrderRequestBodySchema,
} from "@tixprotocol/tdp-sdk/schemas";
import { CheckoutError, createCheckoutService } from "./checkout.js";

const address = Base58Address.parse("11111111111111111111111111111111");
const claimWallet = { address, claimWalletId: "a".repeat(64) };
const input = {
  orderId: "order-1",
  eventId: "1",
  ticketId: "2",
  email: "fan@example.com",
  expectedPriceCents: 100,
};

function assertRequestSavedBeforeSending(
  saved: string,
  idempotencyKey: string | null,
) {
  assert.ok(saved.includes(idempotencyKey ?? ""));
  assert.equal(saved.includes("server-secret"), false);
}

async function setup(t: TestContext) {
  const ordersDirectory = await mkdtemp(join(tmpdir(), "tdp-checkout-"));
  t.after(() => rm(ordersDirectory, { recursive: true, force: true }));
  const calls: {
    body: ReturnType<typeof CreateAndSubmitOrderRequestBodySchema.parse>;
    idempotencyKey: string;
  }[] = [];
  const statusChecks: string[] = [];
  const state = {
    status: "processing" as CreateAndSubmitOrderResponse["status"],
    rejectSend: false,
  };
  const client = createTdpClient({
    baseApiUrl: "https://example.test",
    apiKey: "server-secret",
    fetchImpl: async (request, options) => {
      const path = new URL(String(request)).pathname;
      let payload: unknown;
      if (path === "/orders" && options?.method === "POST") {
        const body = CreateAndSubmitOrderRequestBodySchema.parse(
          JSON.parse(String(options?.body)),
        );
        const idempotencyKey = new Headers(options?.headers).get(
          "idempotency-key",
        );
        calls.push({ body, idempotencyKey: idempotencyKey ?? "" });
        const saved = await readFile(
          join(ordersDirectory, `${input.orderId}.json`),
          "utf8",
        );
        assertRequestSavedBeforeSending(saved, idempotencyKey);
        if (state.rejectSend) throw new Error("Connection interrupted");
        payload = {
          id: idempotencyKey,
          status: state.status,
          claimWallet,
          claimUrl: "https://claim.example.test/claim",
        };
      } else if (path.startsWith("/orders/")) {
        const id = decodeURIComponent(path.slice("/orders/".length));
        statusChecks.push(id);
        payload = {
          id,
          status: state.status,
          claimWallet,
          custodialTransactionId: "a".repeat(64),
          transactionSignature: "1".repeat(64),
        };
      } else {
        throw new Error(`Unexpected request: ${path}`);
      }
      return Response.json(payload);
    },
  });
  const createService = (
    environment: "sandbox" | "live" = "sandbox",
    accountScope = "connection-a",
  ) =>
    createCheckoutService(client, {
      environment,
      ordersDirectory,
      accountScope,
    });
  return { calls, statusChecks, state, ordersDirectory, createService };
}

test("pending orders are sent once and then only checked across retry and restart", async (t) => {
  const { calls, statusChecks, ordersDirectory, createService } =
    await setup(t);
  const first = await createService().checkout(input);
  assert.equal(first.status, "processing");
  const second = await createService().checkout(input);
  assert.equal(second.status, "processing");
  assert.equal(second.claimUrl, first.claimUrl);
  assert.equal(calls.length, 1);
  assert.deepEqual(statusChecks, [calls[0].idempotencyKey]);
  assert.equal(
    (await stat(join(ordersDirectory, "order-1.json"))).mode & 0o777,
    0o600,
  );
});

test("simultaneous copies of one order share a request", async (t) => {
  const { calls, createService } = await setup(t);
  const service = createService();
  const first = service.checkout(input);
  const second = service.checkout(input);
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(calls.length, 1);
});

test("an order ID cannot change its input", async (t) => {
  const { calls, createService } = await setup(t);
  await createService().checkout(input);
  await assert.rejects(
    createService().checkout({ ...input, email: "other@example.com" }),
    (error: unknown) =>
      error instanceof CheckoutError &&
      error.status === 409 &&
      !error.canStartNewOrder,
  );
  assert.equal(calls.length, 1);
});

test("saved orders cannot be replayed with a different API connection", async (t) => {
  const { calls, statusChecks, createService } = await setup(t);
  await createService().checkout(input);
  await assert.rejects(
    createService("sandbox", "connection-b").checkout(input),
    (error: unknown) =>
      error instanceof CheckoutError &&
      error.status === 409 &&
      !error.canStartNewOrder,
  );
  assert.equal(calls.length, 1);
  assert.equal(statusChecks.length, 0);
  await createService().checkout(input);
  assert.equal(calls.length, 1);
  assert.equal(statusChecks.length, 1);
});

test("a corrupted saved key cannot create another purchase", async (t) => {
  const { calls, ordersDirectory, createService } = await setup(t);
  await createService().checkout(input);
  const path = join(ordersDirectory, "order-1.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.request.idempotencyKey = "another-order";
  await writeFile(path, JSON.stringify(saved));
  await assert.rejects(
    createService().checkout(input),
    (error: unknown) =>
      error instanceof CheckoutError &&
      error.status === 503 &&
      !error.canStartNewOrder,
  );
  assert.equal(calls.length, 1);
});

test("uncertain send outcomes retain the order for an identical retry", async (t) => {
  const { calls, state, createService } = await setup(t);
  state.rejectSend = true;
  await assert.rejects(
    createService().checkout(input),
    /Connection interrupted/,
  );
  state.rejectSend = false;
  state.status = "confirmed";
  assert.equal((await createService().checkout(input)).status, "confirmed");
  assert.deepEqual(calls[0], calls[1]);
  await createService().checkout(input);
  assert.equal(calls.length, 2);
});

test("live purchases send the ticket pair and reject a fractional quoted price", async (t) => {
  const { calls, createService } = await setup(t);
  await assert.rejects(
    createService().checkout({ ...input, expectedPriceCents: 1.5 }),
    (error: unknown) =>
      error instanceof CheckoutError &&
      /whole number of cents/.test(error.message),
  );
  assert.equal(calls.length, 0);
  await createService("live").checkout(input);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {
    userId: input.email,
    userEmail: input.email,
    listings: [{ eventId: "1", ticketId: "2" }],
  } satisfies CreateAndSubmitOrderInput["body"]);
});
