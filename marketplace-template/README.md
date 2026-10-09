# TDP marketplace starter

A runnable reference app connecting the **TDP SDK** to **KYD Labs sign-in and tickets**: browse events, list a ticket, purchase it, open the claim link, and check the recipient’s inventory.

For platform setup and API contracts, use the [TDP documentation](https://docs.tix.xyz) and [KYD documentation](https://docs.kydlabs.com/). This README covers the app-specific setup and behavior.

The template uses the published SDK version pinned in `package.json`.

## SDK 0.5.0 compatibility

- Active-listing queries require an `eventId`. Every page retains the same event ID until that event's listing cursor is exhausted.
- Both `indexer.listActiveListings` and `indexer.listUpcomingEvents` receive numeric `limit` values.
- Checkout submits one listing per request as `{ eventId, ticketId }`. `orders.createAndSubmit` accepts at most six distinct listings, and a retry of an accepted order reads its status with `orders.get`.
- The server uses `TdpApiError` and `TdpResponseValidationError` from `@tixprotocol/tdp-sdk/errors`. API errors retain optional `code` and `requestId` fields through to the browser; invalid successful responses return a gateway error.
- Resale signs a `list_ticket_v2` instruction with `transactions.signIntegrator` for a transaction that the fan signs through KYD, then calls `transactions.submit`. The server reads the permit, the protocol config and the integrator account, and converts the price from cents to USDC minor units with `utils.centsToUsdcMinor`; the app sends only the price in cents and the expiry.
- The SDK returns every amount as whole cents (`100` = $1.00); the HTTP API keeps USDC minor units. The treasury balance comes from `solana.getIntegrator` at the address that `integrator.getInfo` returns.

## Start locally

Requires Node.js **24.15+** and [pnpm](https://pnpm.io/installation) **12.5.1**.

```bash
pnpm install
cp .env.example .env
```

Fill in `.env`:

- `TDP_ENVIRONMENT`: `sandbox` or `live`.
- `TDP_API_KEY`: a matching key from the [TDP dashboard](https://dashboard.tix.xyz), with **Query Solana**, **Accept offers** for checkout, and **Create listings** for resale.
- `KYD_OIDC_CLIENT_ID`: your matching KYD client from the [developer portal](https://developers.kydlabs.com). TDP `sandbox` pairs with KYD `sandbox`; TDP `live` pairs with KYD `production`.

Keep the TDP key on the server: never give it a `VITE_` prefix. The KYD client ID is public; no client secret is required.

```bash
pnpm dev
```

Open **http://localhost:5173**. Development reloads when source files or `.env` change. To run without watching files, use `pnpm build` followed by `pnpm start`. Both modes support checkout and resale.

## Register your KYD client

Follow the [KYD documentation](https://docs.kydlabs.com/) to configure your client and test users. Register `http://localhost:5173/auth/callback` as an allowed redirect. Register each additional origin’s callback separately if you change the port or deploy elsewhere.

Enable these scopes:

```text
openid profile fan:read fan:write fan:tickets:read fan:tickets:write fan:listings:write
```

Allow popups for the app’s origin: KYD sign-in opens in a popup. Signing out clears this app’s session; it does not sign you out of KYD everywhere.

## Run the ticket flow

Use a funded integrator treasury and ticket inventory in the configured environment. Ask your onboarding contact for sandbox funding and sample inventory.

1. Sign in and open **My KYD tickets**. Choose a ticket with TDP event/ticket IDs and open its resale dialog.
2. Enter a price in cents (`100` = $1.00), choose an expiry, and authorize the listing. Wait for a **confirmed** result, then refresh **Listings** after indexing.
3. Open **Listings**, choose **Inspect / buy**, enter the recipient email, and purchase. You can also start here with an existing listing.
4. Only a **confirmed** result means the purchase completed. Open the claim link and finish the KYD claim flow as the recipient.
5. Sign in as the recipient and check **My KYD tickets**.

**Resale proceeds go to this app’s integrator treasury, not the fan’s wallet.** This is a reference flow, not a fan payout implementation. Buying a listing that pays the same treasury skips the self-transfer on-chain, so the balance need not fall by the ticket’s full price.

Purchases use the integrator’s USDC treasury and incur protocol fees. This starter does not collect card payments or settle money to sellers. The displayed amount is an estimate; TDP currently has no maximum-price field.

Order requests live in `.data/orders` and retries reuse the same request. The browser retains its current order in session storage, so a refresh can resume it. Keep `.data` and the original API key/URL when recovering an order, and do not start a replacement order while the first outcome is unknown. The local example runs as one server process; use a shared order store and your application's user/order controls before extending it for a hosted checkout.

## Template boundaries

- **Catalog:** listings are fetched per event after discovering upcoming events. Event discovery requires published metadata with a future start date, so past events and events without that metadata are absent. Load more follows each event’s listing pages before continuing through the events; the catalog is not restricted to one integrator.
- **Resale:** tickets need TDP event/ticket IDs. Listing incurs fees and storage costs; it does not pay the fan.
- **Claims:** the target TDP claim app must have a working KYD client for the selected environment.
- **Hosting:** this sample uses local order storage and does not implement checkout authentication, payment collection, or seller settlement. Add application-level authorization and durable shared storage before exposing its transaction endpoints publicly.

## Use live

Set `TDP_ENVIRONMENT=live`, provide a **live** TDP key, and use an approved KYD **production** client ID. Development reloads automatically; restart `pnpm start` after changing environments. The default TDP endpoint changes to `https://api.tix.xyz`; sandbox uses `https://api.sandbox.tix.xyz`. KYD uses the same public issuer and fan API for both modes. If you set `TDP_API_BASE_URL`, supply the matching API origin.

Catalog browsing, KYD sign-in, checkout, and resale use the configured environment. Live transactions spend real funds.

## Build and customize

```bash
pnpm verify
pnpm start
```

`pnpm verify` runs TypeScript, Biome, tests, and the production build. `pnpm install` includes the pinned Biome CLI.

`pnpm start` serves the built SPA and its API from one Node process. Set `HOST`/`PORT` for your host. Checkout and resale are enabled when a TDP API key is configured. Deploy the Node app alongside its `dist` output; the SPA needs the included API server.

- **Brand, colors, radius:** `src/styles.css` contains the theme variables.
- **Page and navigation:** `src/App.tsx`.
- **Catalog and checkout:** `src/components/`.
- **KYD sign-in and fan API:** `src/lib/kyd.ts`.
- **TDP SDK calls:** `server/app.ts`, `server/checkout.ts`, and `server/resale.ts`.
- **Environment settings:** `server/config.ts` and `.env.example`.

Install the recommended **Biome** extension in VS Code or Cursor. Workspace settings enable formatting and import organization on save. Run `pnpm format` to apply the same rules manually.

Update the SDK deliberately, commit the resulting `pnpm-lock.yaml`, and run the checks above. The SDK types define its contracts; this template does not duplicate TDP schemas.

References: [TDP documentation](https://docs.tix.xyz), [published SDK](https://www.npmjs.com/package/@tixprotocol/tdp-sdk), [Radix UI](https://www.radix-ui.com/primitives), [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite).
