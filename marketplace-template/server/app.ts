import { createHash } from "node:crypto";
import { createTdpClient, type TdpClient } from "@tixprotocol/tdp-sdk";
import {
  TdpApiError,
  TdpResponseValidationError,
} from "@tixprotocol/tdp-sdk/errors";
import express, { type ErrorRequestHandler } from "express";
import { CheckoutError, createCheckoutService } from "./checkout";
import { getPublicConfig, type ServerConfig } from "./config";
import { prepareResale, submitResale } from "./resale";

export async function getListingDetails(
  client: TdpClient,
  eventId: string,
  ticketId: string,
) {
  const [listing, event, permit, protocol] = await Promise.all([
    client.solana.getListing({ eventId, ticketId }),
    client.solana.getEvent({ eventId }),
    client.solana.getPermit({ eventId, ticketId }),
    client.solana.getProtocolConfig(),
  ]);
  return { listing, event, permit, protocol };
}

export type ListingDetails = Awaited<ReturnType<typeof getListingDetails>>;

export function createApp(
  config: ServerConfig,
  client = createTdpClient({
    baseApiUrl: config.baseApiUrl,
    apiKey: config.apiKey,
    fetchImpl: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      }),
  }),
) {
  const app = express();
  const checkout = createCheckoutService(client, {
    ...config,
    accountScope: createHash("sha256")
      .update(`${config.baseApiUrl}|${config.apiKey}`)
      .digest("hex"),
  });
  app.disable("x-powered-by");
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/config", (_request, response) => {
    response.json(getPublicConfig(config));
  });
  app.use("/api", (_request, response, next) => {
    if (!config.apiKey) {
      response
        .status(503)
        .json({ error: "Set TDP_API_KEY in .env to connect." });
      return;
    }
    next();
  });
  app.get("/api/events", async (request, response) => {
    response.json(
      await client.indexer.listUpcomingEvents({
        limit: 24,
        cursor: readCursor(request.query.cursor),
      }),
    );
  });
  app.get("/api/listings", async (request, response) => {
    response.json(
      await client.indexer.listActiveListings({
        eventId: readU64(request.query.eventId),
        limit: 24,
        cursor: readCursor(request.query.cursor),
      }),
    );
  });
  app.get("/api/treasury", async (_request, response) => {
    const { address } = await client.integrator.getInfo();
    response.json(await client.solana.getIntegrator({ identity: address }));
  });
  app.get("/api/listings/:eventId/:ticketId", async (request, response) => {
    response.json(
      await getListingDetails(
        client,
        readU64(request.params.eventId),
        readU64(request.params.ticketId),
      ),
    );
  });
  app.use(
    ["/api/checkout", "/api/resale"],
    (request, response, next) => {
      if (!config.checkoutEnabled) {
        response
          .status(403)
          .json({ error: "Checkout is disabled for this server." });
        return;
      }
      const origin = request.get("origin");
      if (
        !origin ||
        !URL.canParse(origin) ||
        new URL(origin).origin !==
          `${request.protocol}://${request.get("host")}`
      ) {
        response
          .status(403)
          .json({ error: "Use checkout from this application." });
        return;
      }
      next();
    },
    express.json({ limit: "16kb" }),
  );
  app.post("/api/checkout", async (request, response) => {
    response.json(await checkout.checkout(request.body));
  });
  app.post(
    "/api/resale/:eventId/:ticketId/prepare",
    async (request, response) => {
      response.json(
        await prepareResale(
          client,
          {
            eventId: readU64(request.params.eventId),
            ticketId: readU64(request.params.ticketId),
          },
          request.body,
        ),
      );
    },
  );
  app.post("/api/resale/submit", async (request, response) => {
    response.json(await submitResale(client, request.body?.transaction));
  });
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Endpoint not found." });
  });
  app.use(handleApiError);
  return app;
}

function readCursor(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[\w-]{1,8192}$/.test(value)) {
    throw new RequestError("Invalid page cursor.");
  }
  return value;
}

function readU64(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{1,20}$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  ) {
    throw new RequestError(
      "Event and ticket IDs must be unsigned 64-bit integers.",
    );
  }
  return value;
}

class RequestError extends Error {}

const handleApiError: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  if (error instanceof RequestError) {
    res.status(400).json({ error: error.message });
  } else if (error instanceof CheckoutError) {
    res.status(error.status).json({
      error: error.message,
      canStartNewOrder: error.canStartNewOrder,
    });
  } else if (error instanceof TdpApiError) {
    const messages: Record<number, string> = {
      400: "TDP could not accept this request. Refresh and try again.",
      401: "TDP rejected the API key. Check its environment and validity.",
      403: "The API key lacks permission for this operation.",
      404: "This event or ticket is no longer available.",
      409: "This operation conflicts with the current ticket state. Refresh and try again.",
      429: "TDP is receiving too many requests. Wait briefly and try again.",
    };
    const status =
      !(error instanceof TdpResponseValidationError) && messages[error.status]
        ? error.status
        : 502;
    res.status(status).json({
      error:
        messages[status] ??
        "TDP returned an unexpected response. Try again shortly.",
      code: error.code,
      requestId: error.requestId,
    });
  } else if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  ) {
    res
      .status(504)
      .json({ error: "TDP took too long to respond. Try again shortly." });
  } else if (error instanceof SyntaxError) {
    res.status(400).json({ error: "Send a valid JSON request." });
  } else if (
    error instanceof Error &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    res.status(413).json({ error: "The request is too large." });
  } else {
    res.status(502).json({
      error: "The request could not be completed. Try again shortly.",
    });
  }
};
