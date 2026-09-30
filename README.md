# TDP examples

Integration examples and starter projects for the TIX Developer Platform (TDP).

- [Quickstart](quickstart/): Fetch upcoming events and active resale listings from the sandbox using the TypeScript SDK.

## Run the quickstart

Set your `TDP_API_KEY` in `.env`, then from the repo's root:

```bash
cp example.env .env
```

Once your `.env` file is set, you can run the examples:

```bash
pnpm --dir quickstart events
pnpm --dir quickstart listings
```

Each command prints one page of results.

