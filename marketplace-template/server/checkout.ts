import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ApiEnvironment,
  CreateAndSubmitOrderInput,
  CreateAndSubmitOrderResponse,
  TdpClient,
} from "@tixprotocol/tdp-sdk";

export type CheckoutInput = {
  orderId: string;
  eventId: string;
  ticketId: string;
  email: string;
  expectedPriceCents: number;
};

type StoredOrder = {
  accountScope: string;
  input: CheckoutInput;
  request: CreateAndSubmitOrderInput;
  result?: CreateAndSubmitOrderResponse;
};

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly canStartNewOrder = false,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

const MAX_U64 = 18_446_744_073_709_551_615n;

function validateCheckoutInput(input: unknown): CheckoutInput {
  if (!input || typeof input !== "object") {
    throw new CheckoutError("Enter an order, ticket, email, and quoted price.");
  }
  const { orderId, eventId, ticketId, email, expectedPriceCents } =
    input as Record<string, unknown>;
  if (
    typeof orderId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(orderId)
  ) {
    throw new CheckoutError("Use a valid order ID, such as a UUID.");
  }
  for (const value of [eventId, ticketId]) {
    if (
      typeof value !== "string" ||
      !/^\d{1,20}$/.test(value) ||
      BigInt(value) > MAX_U64
    ) {
      throw new CheckoutError(
        "Event and ticket IDs must be unsigned decimal strings.",
      );
    }
  }
  if (
    typeof expectedPriceCents !== "number" ||
    !Number.isInteger(expectedPriceCents) ||
    expectedPriceCents < 0
  ) {
    throw new CheckoutError(
      "The quoted price must be a whole number of cents.",
    );
  }
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new CheckoutError("Enter a valid recipient email address.");
  }
  return {
    orderId,
    eventId: String(eventId),
    ticketId: String(ticketId),
    email,
    expectedPriceCents,
  };
}

function requireMatchingOrderInput(saved: CheckoutInput, input: CheckoutInput) {
  if (JSON.stringify(saved) !== JSON.stringify(input)) {
    throw new CheckoutError(
      "This order ID already belongs to a different purchase.",
      409,
    );
  }
}

async function readStoredOrder(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as StoredOrder;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new CheckoutError(
      "The saved order could not be read. Keep its order ID and contact the operator.",
      503,
    );
  }
}

function buildOrderRequest(input: CheckoutInput) {
  return {
    idempotencyKey: `template-checkout:${input.orderId}`,
    body: {
      userId: input.email,
      userEmail: input.email,
      listings: [{ eventId: input.eventId, ticketId: input.ticketId }],
    },
  } satisfies CreateAndSubmitOrderInput;
}

/** A retry of an order that TDP already accepted only reads its status, so the claim URL comes from the saved result. */
async function sendOrRefreshOrder(
  client: TdpClient,
  order: StoredOrder,
): Promise<CreateAndSubmitOrderResponse> {
  if (!order.result) return client.orders.createAndSubmit(order.request);
  const status = await client.orders.get({ id: order.result.id });
  return { ...order.result, ...status };
}

export function createCheckoutService(
  client: TdpClient,
  {
    ordersDirectory,
    accountScope,
  }: {
    environment: ApiEnvironment;
    ordersDirectory: string;
    accountScope: string;
  },
) {
  const pending = new Map<
    string,
    { input: CheckoutInput; promise: Promise<CreateAndSubmitOrderResponse> }
  >();

  async function executeCheckout(input: CheckoutInput) {
    await mkdir(ordersDirectory, { recursive: true, mode: 0o700 });
    const path = join(ordersDirectory, `${input.orderId}.json`);
    let order = await readStoredOrder(path);
    if (!order) {
      order = { accountScope, input, request: buildOrderRequest(input) };
      try {
        await writeFile(path, JSON.stringify(order, null, 2), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        )
          throw error;
        const saved = await readStoredOrder(path);
        if (!saved)
          throw new CheckoutError(
            "The order is being saved. Retry with the same order ID.",
            409,
          );
        order = saved;
      }
    }
    if (order.accountScope !== accountScope) {
      throw new CheckoutError(
        "This order belongs to a different API connection. Restore its original credentials to check it.",
        409,
      );
    }
    requireMatchingOrderInput(order.input, input);
    if (
      order.request?.idempotencyKey !== `template-checkout:${input.orderId}`
    ) {
      throw new CheckoutError(
        "The saved order key is invalid. Keep its order ID and contact the operator.",
        503,
      );
    }
    if (order.result?.status && order.result.status !== "processing")
      return order.result;

    const result = await sendOrRefreshOrder(client, order);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify({ ...order, result }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporaryPath, path);
    return result;
  }

  function checkout(value: unknown): Promise<CreateAndSubmitOrderResponse> {
    let input: CheckoutInput;
    try {
      input = validateCheckoutInput(value);
      const existing = pending.get(input.orderId);
      if (existing) {
        requireMatchingOrderInput(existing.input, input);
        return existing.promise;
      }
    } catch (error) {
      return Promise.reject(error);
    }
    const promise = executeCheckout(input).finally(() =>
      pending.delete(input.orderId),
    );
    pending.set(input.orderId, { input, promise });
    return promise;
  }

  return { checkout };
}
