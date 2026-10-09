import assert from "node:assert/strict";
import test from "node:test";
import {
  createTdpClient,
  type SignIntegratorTransactionInput,
  type SignTransactionBody,
  type SubmitTransactionInput,
} from "@tixprotocol/tdp-sdk";
import {
  Base58Address,
  Base64WireEncodedTransactionSchema,
  SignTransactionResponseSchema,
  SubmitTenantTransactionResponseSchema,
} from "@tixprotocol/tdp-sdk/schemas";
import { prepareResale, submitResale } from "./resale";

const address = Base58Address.parse("11111111111111111111111111111111");
const transactionBytes = Buffer.concat([
  Buffer.from([1]),
  Buffer.alloc(64),
  Buffer.from([1, 0, 0, 1]),
  Buffer.alloc(64),
  Buffer.from([0]),
]);
const transaction = Base64WireEncodedTransactionSchema.parse(
  transactionBytes.toString("base64"),
);
const signed = SignTransactionResponseSchema.parse({
  custodialTransactionId: "a".repeat(64),
  signerAddress: address,
  feePayerAddress: address,
  signedTransaction: transaction,
  message: "message",
  signature: "1".repeat(64),
  feePayerSignature: "1".repeat(64),
  requiredSigners: [address],
  recentBlockhash: "1".repeat(32),
});
const submitted = SubmitTenantTransactionResponseSchema.parse({
  custodialTransactionId: "a".repeat(64),
  transactionSignature: "1".repeat(64),
  status: "processing",
});

function createResaleTestClient() {
  const signRequests: SignIntegratorTransactionInput[] = [];
  const submitRequests: SubmitTransactionInput[] = [];
  const client = createTdpClient({
    baseApiUrl: "https://example.test",
    apiKey: "test-key",
    fetchImpl: async () => assert.fail("Resale must not call TDP directly."),
  });
  client.solana.getPermit = async () => ({
    owner: address,
    status: 0,
    ticket_type_id: 0,
    ticket_type_config: address,
    version: "1",
    ticket_id: "2",
    listing_lock_expiry: "0",
  });
  client.solana.getProtocolConfig = async () => ({
    address,
    usdc_mint: address,
    default_royalty_vault: address,
    authority: address,
    usdc_decimals: 6,
    event_registration_fee_cents: 0,
    permit_fee_cents: 0,
    p2p_transfer_fee_cents: 0,
    resale_fee_bps: 100,
  });
  client.integrator.getInfo = async () => ({ address });
  client.wallets.getFeePayerAddress = async () => ({ address });
  client.solana.getIntegrator = async () => ({
    integrator_pda: address,
    integrator: {
      authority: address,
      status: "Active",
      treasury_usdc: address,
      balance: { amount_cents: 100 },
    },
  });
  client.transactions.signIntegrator = async (request) => {
    signRequests.push(request);
    return signed;
  };
  client.transactions.submit = async (request) => {
    submitRequests.push(request);
    return submitted;
  };
  return { client, signRequests, submitRequests };
}

void test("resale signs one listing paid out to the treasury", async () => {
  const { client, signRequests } = createResaleTestClient();
  const result = await prepareResale(
    client,
    { eventId: "16159443462307518117", ticketId: "2" },
    { askPriceCents: 100, expiresAt: "4102444800" },
  );
  assert.deepEqual(result, {
    transaction: transactionBytes.toString("hex"),
    payoutAddress: address,
  } satisfies Awaited<ReturnType<typeof prepareResale>>);
  assert.equal(signRequests.length, 1);
  assert.ok(signRequests[0].idempotencyKey);
  assert.deepEqual(signRequests[0].body, {
    tixInstructions: {
      instruction: "list_ticket_v2",
      params: [
        {
          event_id: "16159443462307518117",
          ticket_id: "2",
          ask_price_minor: "1000000",
          expires_at: "4102444800",
          seller: address,
          storage_fee_payer: address,
          listing_integrator_identity: address,
          listing_integrator_authority: address,
          usdc_mint: address,
          payout_ata: address,
          ticket_type_config: address,
        },
      ],
    },
  } satisfies SignTransactionBody);
});

void test("invalid prices and expired listings never reach the signer", async () => {
  const { client, signRequests } = createResaleTestClient();
  await assert.rejects(
    prepareResale(
      client,
      { eventId: "1", ticketId: "2" },
      { askPriceCents: -1, expiresAt: "4102444800" },
    ),
    /price/,
  );
  await assert.rejects(
    prepareResale(
      client,
      { eventId: "1", ticketId: "2" },
      { askPriceCents: 1.5, expiresAt: "4102444800" },
    ),
    /price/,
  );
  await assert.rejects(
    prepareResale(
      client,
      { eventId: "1", ticketId: "2" },
      { askPriceCents: 1, expiresAt: "1" },
    ),
    /future/,
  );
  assert.equal(signRequests.length, 0);
});

void test("resubmission preserves the authorized bytes and pending status", async () => {
  const { client, submitRequests } = createResaleTestClient();
  assert.equal(
    (await submitResale(client, transactionBytes.toString("hex"))).status,
    "processing",
  );
  await submitResale(client, transactionBytes.toString("hex"));
  assert.equal(submitRequests.length, 2);
  assert.equal(
    submitRequests[0].body.signedTransaction,
    transactionBytes.toString("base64"),
  );
  assert.deepEqual(submitRequests[0], submitRequests[1]);
  assert.throws(() => submitResale(client, "not-hex"), /hex-encoded/);
  assert.equal(submitRequests.length, 2);
});
