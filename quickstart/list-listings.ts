import { createTdpClient } from "@tixprotocol/tdp-sdk";

const apiKey = process.env.TDP_API_KEY;
if (!apiKey) throw new Error("Set TDP_API_KEY to your sandbox API key.");

const client = createTdpClient({
  baseApiUrl: "https://api.sandbox.tix.xyz",
  apiKey,
});

const eventId = process.argv[2];
if (!eventId) throw new Error("Pass an event_id from the events output.");
const listings = await client.events.getListings({
  limit: 10,
  eventId,
});
console.log(JSON.stringify(listings, null, 2));
