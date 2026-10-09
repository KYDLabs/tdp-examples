import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchCatalogPage,
  type ListActiveListingsResponse,
  type ListUpcomingEventsResponse,
} from "./catalog";

function eventsPage(ids: (string | null)[], cursor: string | null = null) {
  return {
    items: ids.map(
      (event_id) =>
        ({
          event_id,
          event_account: `event-${event_id}`,
          name: null,
          start_at: null,
          on_sale_at: null,
          image_url: null,
          timezone: null,
          address: null,
          venue: null,
          active_listing_count: 0,
          tickets_issued_count: 0,
          integrator_identity: null,
          updated_at: null,
          found: true,
          genres: null,
        }) satisfies ListUpcomingEventsResponse["items"][number],
    ),
    next_cursor: cursor,
  } satisfies ListUpcomingEventsResponse;
}

function listingsPage(ids: string[], cursor: string | null = null) {
  return {
    items: ids.map(
      (listing_id) =>
        ({
          event_account: null,
          event_id: null,
          listing_id,
          ticket_id: null,
          seller: null,
          buyer_allow: null,
          ask_price_cents: null,
          payout_ata: null,
          expires_at: null,
          updated_at: null,
        }) satisfies ListActiveListingsResponse["items"][number],
    ),
    next_cursor: cursor,
  } satisfies ListActiveListingsResponse;
}

test("the listing catalog finishes each event before advancing the event cursor", async (context) => {
  const responses = [
    eventsPage([null, "0", "2"], "events-2"),
    listingsPage([], "listings-2"),
    listingsPage(["a"]),
    listingsPage(["b"]),
    eventsPage(["3"]),
    listingsPage(["c"]),
  ];
  const requests: string[] = [];
  const signal = new AbortController().signal;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string, init?: RequestInit) => {
      requests.push(input);
      assert.equal(init?.signal, signal);
      const response = responses.shift();
      assert.ok(response, "every request has an expected response");
      return Response.json(response);
    },
  );

  const first = await fetchCatalogPage("listings", {}, signal);
  assert.deepEqual(first.items, []);
  assert.ok(first.nextPage);
  const second = await fetchCatalogPage("listings", first.nextPage, signal);
  assert.ok(second.nextPage);
  const third = await fetchCatalogPage("listings", second.nextPage, signal);
  assert.ok(third.nextPage);
  const fourth = await fetchCatalogPage("listings", third.nextPage, signal);
  assert.equal(fourth.nextPage, undefined);
  assert.deepEqual(
    [...second.items, ...third.items, ...fourth.items],
    listingsPage(["a", "b", "c"]).items,
  );
  assert.deepEqual(requests, [
    "/api/events",
    "/api/listings?eventId=0",
    "/api/listings?eventId=0&cursor=listings-2",
    "/api/listings?eventId=2",
    "/api/events?cursor=events-2",
    "/api/listings?eventId=3",
  ]);
  assert.equal(responses.length, 0);
});

test("empty event pages and events without IDs preserve the event cursor", async (context) => {
  const responses = [
    eventsPage([], "events-2"),
    eventsPage([null], "events-3"),
    eventsPage([]),
  ];
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string) => {
    requests.push(input);
    return Response.json(responses.shift());
  });
  let page = await fetchCatalogPage("listings", {});
  assert.deepEqual(page.nextPage, { eventCursor: "events-2" });
  assert.ok(page.nextPage);
  page = await fetchCatalogPage("listings", page.nextPage);
  assert.deepEqual(page.nextPage, { eventCursor: "events-3" });
  assert.ok(page.nextPage);
  page = await fetchCatalogPage("listings", page.nextPage);
  assert.deepEqual(page.items, []);
  assert.equal(page.nextPage, undefined);
  assert.deepEqual(requests, [
    "/api/events",
    "/api/events?cursor=events-2",
    "/api/events?cursor=events-3",
  ]);
});

test("the events catalog keeps its normal pagination", async (context) => {
  context.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(input, "/api/events?cursor=events-2");
    return Response.json(eventsPage(["5"]));
  });
  const page = await fetchCatalogPage("events", { eventCursor: "events-2" });
  assert.deepEqual(page.items, eventsPage(["5"]).items);
  assert.equal(page.nextPage, undefined);
});

test("a listing failure does not discard the event or advance its cursor", async (context) => {
  const params = {
    eventIds: ["0", "1"],
    eventCursor: "events-2",
    listingCursor: "listings-2",
  };
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Unavailable" }, { status: 503 }),
  );
  await assert.rejects(fetchCatalogPage("listings", params), /Unavailable/);
  assert.deepEqual(params, {
    eventIds: ["0", "1"],
    eventCursor: "events-2",
    listingCursor: "listings-2",
  });
});
