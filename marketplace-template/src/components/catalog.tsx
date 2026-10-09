import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchCatalogPage,
  type ListActiveListingsResponse,
  type ListUpcomingEventsResponse,
} from "../lib/catalog";
import {
  abbreviateAddress,
  formatAmount,
  formatEventDate,
} from "../lib/format";
import { CheckoutDialog } from "./checkout-dialog";
import { EmptyState, QueryFeedback } from "./feedback";
import { Button } from "./ui/button";

type ListingItem = ListActiveListingsResponse["items"][number];

export function Catalog({
  kind,
  checkoutEnabled,
}: {
  kind: "events" | "listings";
  checkoutEnabled: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: [kind],
    initialPageParam: {},
    queryFn: ({ pageParam, signal }) =>
      fetchCatalogPage(kind, pageParam, signal),
    getNextPageParam: (page) => page.nextPage,
  });
  const [selected, setSelected] = useState<ListingItem | null>(null);
  const pages = query.data?.pages ?? [];
  const count = pages.reduce((total, page) => total + page.items.length, 0);
  return (
    <section>
      <div className="section-heading">
        <div>
          <h2>{kind === "events" ? "Upcoming events" : "Active listings"}</h2>
          <code>
            {kind === "events"
              ? "client.indexer.listUpcomingEvents()"
              : "client.indexer.listActiveListings({ eventId })"}
          </code>
        </div>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      </div>
      <QueryFeedback
        pending={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {!query.isPending && !query.isError && count === 0 && (
        <EmptyState
          title={query.hasNextPage ? "No results on this page" : "No results"}
        >
          {query.hasNextPage
            ? "Continue to the next page below."
            : `No ${kind} returned in this environment. Check the onboarding prerequisites in README.md.`}
        </EmptyState>
      )}
      {count > 0 && (
        <div className="data-table-wrap">
          {kind === "events" ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Event ID</th>
                  <th>Date</th>
                  <th>Venue</th>
                  <th>Listings</th>
                </tr>
              </thead>
              <tbody>
                {(pages as ListUpcomingEventsResponse[])
                  .flatMap((page) => page.items)
                  .map((event) => (
                    <tr key={event.event_account}>
                      <td>{event.name ?? "Unnamed event"}</td>
                      <td className="mono">{event.event_id ?? "—"}</td>
                      <td>{formatEventDate(event.start_at, event.timezone)}</td>
                      <td>{event.venue ?? "—"}</td>
                      <td>{event.active_listing_count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Ticket ID</th>
                  <th>Seller</th>
                  <th>Price</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(pages as ListActiveListingsResponse[])
                  .flatMap((page) => page.items)
                  .map((listing) => (
                    <tr
                      key={
                        listing.listing_id ??
                        `${listing.event_id}:${listing.ticket_id}:${listing.seller}`
                      }
                    >
                      <td className="mono">{listing.event_id ?? "—"}</td>
                      <td className="mono">{listing.ticket_id ?? "—"}</td>
                      <td className="mono" title={listing.seller ?? undefined}>
                        {abbreviateAddress(listing.seller)}
                      </td>
                      <td>{formatAmount(listing.ask_price_cents)}</td>
                      <td>
                        <Button
                          variant="outline"
                          disabled={!listing.event_id || !listing.ticket_id}
                          onClick={() => setSelected(listing)}
                        >
                          Inspect / buy
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {query.hasNextPage && (
        <div className="load-more">
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
      {selected && (
        <CheckoutDialog
          listing={selected}
          checkoutEnabled={checkoutEnabled}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
