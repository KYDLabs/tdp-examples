import { randomUUID } from "node:crypto";
import type { GetPermitInput, TdpClient } from "@tixprotocol/tdp-sdk";
import { SubmitTenantTransactionRequestBodySchema } from "@tixprotocol/tdp-sdk/schemas";
import { CheckoutError } from "./checkout";

type ListingTerms = { askPriceCents: number; expiresAt: string };

function parseListingTerms(input: unknown): ListingTerms {
  const { askPriceCents, expiresAt } = (input ?? {}) as Record<string, unknown>;
  if (
    typeof askPriceCents !== "number" ||
    !Number.isInteger(askPriceCents) ||
    askPriceCents < 0 ||
    typeof expiresAt !== "string" ||
    !/^\d{1,19}$/.test(expiresAt)
  ) {
    throw new CheckoutError("Enter a price in whole cents and an expiry.");
  }
  return { askPriceCents, expiresAt };
}

export async function prepareResale(
  client: TdpClient,
  ticket: GetPermitInput,
  input: unknown,
) {
  const terms = parseListingTerms(input);
  if (BigInt(terms.expiresAt) <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new CheckoutError("Listing expiry must be in the future.");
  }
  const [permit, protocol, identity, feePayer] = await Promise.all([
    client.solana.getPermit(ticket),
    client.solana.getProtocolConfig(),
    client.integrator.getInfo(),
    client.wallets.getFeePayerAddress(),
  ]);
  const { integrator } = await client.solana.getIntegrator({
    identity: identity.address,
  });
  const signed = await client.transactions.signIntegrator({
    idempotencyKey: randomUUID(),
    body: {
      tixInstructions: {
        instruction: "list_ticket_v2",
        params: [
          {
            event_id: ticket.eventId,
            ticket_id: ticket.ticketId,
            ask_price_minor: client.utils
              .centsToUsdcMinor(BigInt(terms.askPriceCents))
              .toString(),
            expires_at: terms.expiresAt,
            seller: permit.owner,
            storage_fee_payer: feePayer.address,
            listing_integrator_identity: identity.address,
            listing_integrator_authority: integrator.authority,
            usdc_mint: protocol.usdc_mint,
            payout_ata: integrator.treasury_usdc,
            ticket_type_config: permit.ticket_type_config,
          },
        ],
      },
    },
  });
  return {
    transaction: Buffer.from(signed.signedTransaction, "base64").toString(
      "hex",
    ),
    payoutAddress: integrator.treasury_usdc,
  };
}

export function submitResale(client: TdpClient, transaction: unknown) {
  if (
    typeof transaction !== "string" ||
    !/^(?:[0-9a-fA-F]{2})+$/.test(transaction)
  ) {
    throw new CheckoutError("KYD must return a hex-encoded transaction.");
  }
  return client.transactions.submit({
    body: SubmitTenantTransactionRequestBodySchema.parse({
      signedTransaction: Buffer.from(transaction, "hex").toString("base64"),
    }),
  });
}
