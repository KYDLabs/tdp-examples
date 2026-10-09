import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { PublicConfig } from "../../server/config";

export function createKydUserManager(
  config: NonNullable<PublicConfig["kyd"]>,
  environment: PublicConfig["environment"],
) {
  const storage = new WebStorageStateStore({
    prefix: `oidc:${environment}:`,
    store: window.sessionStorage,
  });
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    response_type: "code",
    scope: config.scope,
    extraQueryParams: {
      mode: environment === "live" ? "production" : "sandbox",
    },
    loadUserInfo: true,
    automaticSilentRenew: false,
    userStore: storage,
    stateStore: storage,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalTicketIdentifier(value: unknown) {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

function readFanTicket(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
    throw new Error("KYD returned a ticket without an ID.");
  }
  const metadata = isRecord(value.on_chain_metadata)
    ? value.on_chain_metadata
    : undefined;
  return {
    id: value.id,
    event_id: optionalString(value.event_id),
    event_name: optionalString(value.event_name),
    ticket_type_name: optionalString(value.ticket_type_name),
    status: optionalString(value.status),
    on_chain_metadata: {
      tix_event_id:
        optionalTicketIdentifier(metadata?.tix_event_id) ??
        optionalTicketIdentifier(value.tix_event_id),
      tix_permit_id:
        optionalTicketIdentifier(metadata?.tix_permit_id) ??
        optionalTicketIdentifier(value.tix_id),
    },
  };
}

export type FanTicket = ReturnType<typeof readFanTicket>;

export async function authorizeResale(
  accessToken: string,
  fanApiUrl: string,
  transaction: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(
    `${fanApiUrl.replace(/\/$/, "")}/fans/authorizations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "list", transactions: [transaction] }),
    },
  );
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      (isRecord(body) && optionalString(body.message)) ||
        `KYD could not authorize resale (${response.status}).`,
    );
  }
  if (
    !isRecord(body) ||
    !Array.isArray(body.transactions) ||
    body.transactions.length !== 1 ||
    typeof body.transactions[0] !== "string" ||
    !/^(?:[0-9a-fA-F]{2})+$/.test(body.transactions[0])
  ) {
    throw new Error("KYD returned an unexpected authorization response.");
  }
  return body.transactions[0];
}

export async function listFanTickets(
  accessToken: string,
  fanApiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FanTicket[]> {
  const response = await fetchImpl(
    `${fanApiUrl.replace(/\/$/, "")}/fans/tickets`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = isRecord(body) ? optionalString(body.message) : undefined;
    throw new Error(
      message || `KYD could not load your tickets (${response.status}).`,
    );
  }
  if (!isRecord(body) || !Array.isArray(body.tickets)) {
    throw new Error("KYD returned an unexpected ticket response.");
  }
  return body.tickets.map(readFanTicket);
}
