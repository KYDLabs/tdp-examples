import type { TdpClient } from "@tixprotocol/tdp-sdk";
import { requestJson } from "./api";

export type ListUpcomingEventsResponse = Awaited<
  ReturnType<TdpClient["indexer"]["listUpcomingEvents"]>
>;
export type ListActiveListingsResponse = Awaited<
  ReturnType<TdpClient["indexer"]["listActiveListings"]>
>;

type CatalogPageParams = {
  eventIds?: NonNullable<
    ListUpcomingEventsResponse["items"][number]["event_id"]
  >[];
  eventCursor?: ListUpcomingEventsResponse["next_cursor"];
  listingCursor?: ListActiveListingsResponse["next_cursor"];
};

function fetchUpcomingEventsPage(
  cursor: CatalogPageParams["eventCursor"],
  signal?: AbortSignal,
) {
  return requestJson<ListUpcomingEventsResponse>(
    `/api/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    { signal },
  );
}

export async function fetchCatalogPage(
  kind: "events" | "listings",
  params: CatalogPageParams,
  signal?: AbortSignal,
) {
  if (kind === "events") {
    const page = await fetchUpcomingEventsPage(params.eventCursor, signal);
    return {
      ...page,
      nextPage: page.next_cursor
        ? { eventCursor: page.next_cursor }
        : undefined,
    };
  }

  let { eventIds = [], eventCursor, listingCursor } = params;
  if (eventIds.length === 0) {
    const events = await fetchUpcomingEventsPage(eventCursor, signal);
    eventIds = events.items.flatMap((event) =>
      event.event_id === null ? [] : [event.event_id],
    );
    eventCursor = events.next_cursor;
  }

  if (eventIds.length === 0) {
    return {
      items: [],
      next_cursor: null,
      nextPage: eventCursor ? { eventCursor } : undefined,
    };
  }

  const query = new URLSearchParams({ eventId: eventIds[0] });
  if (listingCursor) query.set("cursor", listingCursor);
  const page = await requestJson<ListActiveListingsResponse>(
    `/api/listings?${query}`,
    { signal },
  );
  const remainingEventIds = page.next_cursor ? eventIds : eventIds.slice(1);
  return {
    ...page,
    nextPage:
      remainingEventIds.length > 0 || eventCursor
        ? {
            eventIds: remainingEventIds,
            eventCursor,
            listingCursor: page.next_cursor,
          }
        : undefined,
  };
}
