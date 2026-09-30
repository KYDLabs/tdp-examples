import { createTdpClient } from "@tixprotocol/tdp-sdk";

const apiKey = process.env.TDP_API_KEY;
if (!apiKey) throw new Error("Set TDP_API_KEY to your sandbox API key.");

const client = createTdpClient({
  baseApiUrl: "https://api.sandbox.tix.xyz",
  apiKey,
});

const events = await client.indexer.listUpcomingEvents({ limit: 10 });
console.log(JSON.stringify(events, null, 2));
