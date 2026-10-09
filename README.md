# TDP examples

Integration examples and starter projects for the TIX Developer Platform (TDP).

- [Quickstart](quickstart/): Fetch events and active resale listings from the sandbox using the TypeScript SDK.

## Run the quickstart

From the repo's root:

```bash
pnpm install
cp .env.example .env
```

Set `TDP_API_KEY` in `.env` to your sandbox API key with **Query Solana** permission, then run:

```bash
pnpm --dir quickstart events
```

The command prints one page of events. Pass a non-null `event_id` from the output to list that event's active listings; the event ID is required:

```bash
pnpm --dir quickstart listings 16159443462307518117
```

