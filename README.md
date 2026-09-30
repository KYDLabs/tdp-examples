# TDP examples

Integration examples and starter projects for the TIX Developer Platform (TDP).

- [Quickstart](quickstart/): Fetch upcoming events and active resale listings from the sandbox using the TypeScript SDK.

## Run the quickstart

From the repo's root:

```bash
pnpm install
cp example.env .env
```

Set `TDP_API_KEY` in `.env` to your sandbox API key with **Query Solana** permission, then run:

```bash
pnpm --dir quickstart events
pnpm --dir quickstart listings
```

Each command prints one page of results.

