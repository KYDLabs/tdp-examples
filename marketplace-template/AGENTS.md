# Working in this template

This is a standalone downstream integrator app. It connects the published TDP SDK and KYD public APIs; it does not depend on either platform's source repository.

## Navigation

- `src/App.tsx` owns the page, navigation, and login entry points.
- `src/components/catalog.tsx` renders paginated events/listings.
- `src/components/my-tickets.tsx` renders KYD fan inventory.
- `src/components/checkout-dialog.tsx` presents sandbox checkout and saved-order retries.
- `src/lib/kyd.ts` configures OIDC and the public fan API adapter; `src/lib/use-kyd-user.ts` handles popup sign-in and its callback.
- `src/styles.css` owns theme variables and layout; `src/components/ui/` owns UI primitives.
- `server/app.ts` exposes the app's selected TDP operations through the published SDK.
- `server/checkout.ts` validates purchases and retains idempotent order requests.
- `server/config.ts` reads configuration; `server/index.ts` hosts the app.
- `.env.example` and `README.md` describe onboarding. `.data/` and `.env` are private local state.

## Conventions

Keep changes small and readable. Use ordinary TypeScript and official dependency types; do not import private TDP/KYD packages, copy internal schemas, or add direct chain access to fill a missing public API. Surface missing capabilities instead.

Use `@tixprotocol/tdp-sdk` only on the server; browser type-only imports are fine. Keep the API key out of browser code and build variables. Sandbox is the default. KYD client mode and TDP key/environment must match.

Keep monetary amounts and ticket identifiers as decimal strings or bigint. Follow `next_cursor` even if a page has no items. Do not label a claim URL or pending submission as a confirmed purchase. Never create a replacement order for an uncertain result: reuse the saved idempotency key and body.

Keep onboarding prose brief. Explain what a developer needs to supply or change, not platform internals. `README.md` lists the current supported flows and integration gaps.

## Checks

Use pnpm. Run `pnpm format` and `pnpm verify` for relevant changes. Tests use SDK/API substitutes and do not spend funds. Exercise real transactions only when explicitly requested, with the intended environment and credentials.
