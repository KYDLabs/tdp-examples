import { createTdpClient } from "@tixprotocol/tdp-sdk";

const apiKey = process.env.TDP_API_KEY;
if (!apiKey) throw new Error("Set TDP_API_KEY to your sandbox API key.");

const client = createTdpClient({
  baseApiUrl: "https://api.sandbox.tix.xyz",
  apiKey,
});

const eventId = process.argv[2]; // optional: an event_id from list-events
const listings = await client.indexer.listActiveListings({
  limit: 10,
  ...(eventId ? { eventId } : {}),
});
console.log(JSON.stringify(listings, null, 2));
