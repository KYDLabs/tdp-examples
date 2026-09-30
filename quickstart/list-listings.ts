import { createTdpClient } from "@tixprotocol/tdp-sdk";

const apiKey = process.env.TDP_API_KEY;
if (!apiKey?.trim()) {
  console.error(
    "Set TDP_API_KEY to your sandbox API key before running this example.",
  );
  process.exit(1);
}

const client = createTdpClient({
  baseApiUrl: "https://api.sandbox.tix.xyz",
  apiKey,
});

try {
  const page = await client.indexer.listActiveListings(
    { limit: 10 },
    { signal: AbortSignal.timeout(15_000) },
  );
  console.log(JSON.stringify(page, null, 2));
} catch {
  console.error(
    "Request failed. Check your sandbox key, Query Solana permission, and network connection.",
  );
  process.exitCode = 1;
}
