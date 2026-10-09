import { useMutation, useQuery } from "@tanstack/react-query";
import type { CreateAndSubmitOrderResponse } from "@tixprotocol/tdp-sdk";
import { ArrowUpRight, Check, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import type { ListingDetails } from "../../server/app";
import type { CheckoutInput } from "../../server/checkout";
import { postJson, requestJson } from "../lib/api";
import type { ListActiveListingsResponse } from "../lib/catalog";
import { formatAmount } from "../lib/format";
import { QueryFeedback } from "./feedback";
import { Button } from "./ui/button";

/** The protocol charges the resale fee on-chain, so this fee is an estimate for display. */
function estimateResaleFeeCents(priceCents: number, resaleFeeBps: number) {
  return Math.round((priceCents * resaleFeeBps) / 10_000);
}

function readSavedOrder(key: string): CheckoutInput | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function CheckoutDialog({
  listing,
  checkoutEnabled,
  onClose,
}: {
  listing: ListActiveListingsResponse["items"][number];
  checkoutEnabled: boolean;
  onClose: () => void;
}) {
  const storageKey = `tdp:sandbox:order:${listing.event_id}:${listing.ticket_id}`;
  const [order, setOrder] = useState(() => readSavedOrder(storageKey));
  const [email, setEmail] = useState(order?.email ?? "");
  const [storageError, setStorageError] = useState("");
  const details = useQuery({
    queryKey: ["listing", listing.event_id, listing.ticket_id],
    queryFn: ({ signal }) =>
      requestJson<ListingDetails>(
        `/api/listings/${listing.event_id}/${listing.ticket_id}`,
        { signal },
      ),
    staleTime: 0,
  });
  const purchase = useMutation({
    mutationFn: (input: CheckoutInput) =>
      postJson<CreateAndSubmitOrderResponse>("/api/checkout", input),
  });
  const data = details.data;
  const terminal =
    purchase.data?.status === "confirmed" ||
    purchase.data?.status === "landed_with_error" ||
    purchase.data?.status === "expired";
  const canStartNewOrder =
    terminal ||
    Boolean(
      purchase.error &&
        "canStartNewOrder" in purchase.error &&
        purchase.error.canStartNewOrder === true,
    );
  const quotedPrice =
    order?.expectedPriceCents ?? data?.listing.ask_price_cents ?? 0;
  const fee = data
    ? estimateResaleFeeCents(quotedPrice, data.protocol.resale_fee_bps)
    : 0;
  const total = quotedPrice + fee;

  function startNewOrder() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      setStorageError("Enable browser storage before starting another order.");
      return;
    }
    setOrder(null);
    setStorageError("");
    purchase.reset();
    void details.refetch();
  }

  function submitOrder() {
    const input =
      order ??
      (data
        ? {
            orderId: crypto.randomUUID(),
            eventId: String(listing.event_id),
            ticketId: String(listing.ticket_id),
            email: email.trim(),
            expectedPriceCents: data.listing.ask_price_cents,
          }
        : null);
    if (!input) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(input));
    } catch {
      setStorageError(
        "Enable browser storage to retain this order before purchasing.",
      );
      return;
    }
    setStorageError("");
    setOrder(input);
    purchase.mutate(input);
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Close asChild>
            <Button
              variant="ghost"
              className="dialog-close"
              aria-label="Close ticket"
            >
              <X size={18} />
            </Button>
          </Dialog.Close>
          <p className="eyebrow">Event {listing.event_id}</p>
          <Dialog.Title>Ticket {listing.ticket_id}</Dialog.Title>
          <Dialog.Description>
            Review the current listing and deliver a ticket to an email address.
          </Dialog.Description>
          <QueryFeedback
            pending={details.isPending}
            error={details.error}
            retry={() => void details.refetch()}
          />
          {data && (
            <dl className="price-breakdown">
              <div>
                <dt>{order ? "Quoted ticket price" : "Ticket price"}</dt>
                <dd>{formatAmount(quotedPrice)}</dd>
              </div>
              <div>
                <dt>Resale fee (estimate)</dt>
                <dd>{formatAmount(fee)}</dd>
              </div>
              <div className="price-total">
                <dt>Estimated total</dt>
                <dd>{formatAmount(total)}</dd>
              </div>
            </dl>
          )}
          {(data || order) &&
            (!checkoutEnabled ? (
              <p className="notice">
                Configure a TDP API key to purchase tickets.
              </p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitOrder();
                }}
              >
                <label htmlFor="recipient">Recipient email</label>
                <input
                  id="recipient"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={Boolean(order)}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p className="form-hint">
                  Checkout uses your integrator’s balance. A listing’s price can
                  change before it completes.
                </p>
                {order && !canStartNewOrder && (
                  <p className="form-hint">
                    Your order is saved. Retry this same order if its outcome is
                    still unknown.
                  </p>
                )}
                <Button
                  className="full-width"
                  type="submit"
                  disabled={
                    purchase.isPending ||
                    terminal ||
                    (!order && details.isFetching)
                  }
                >
                  {purchase.isPending
                    ? "Checking order…"
                    : terminal
                      ? purchase.data?.status === "confirmed"
                        ? "Purchased"
                        : "Order ended"
                      : order
                        ? "Check / retry this order"
                        : "Purchase"}
                  {purchase.data?.status === "confirmed" ? (
                    <Check size={16} />
                  ) : (
                    <ArrowUpRight size={16} />
                  )}
                </Button>
                {canStartNewOrder && (
                  <Button
                    className="full-width"
                    variant="outline"
                    type="button"
                    onClick={startNewOrder}
                  >
                    Review a new order
                  </Button>
                )}
              </form>
            ))}
          {(purchase.error || storageError) && (
            <p className="notice notice-error" role="alert">
              {purchase.error?.message ?? storageError}
            </p>
          )}
          {purchase.data && (
            <div className="order-result" role="status">
              <strong>
                {purchase.data.status === "confirmed"
                  ? "Ticket purchase confirmed"
                  : purchase.data.status === "landed_with_error"
                    ? "The transaction completed with an error"
                    : purchase.data.status === "expired"
                      ? "The transaction expired"
                      : "Purchase awaiting confirmation"}
              </strong>
              <p>
                {purchase.data.status === "confirmed"
                  ? "Your recipient can open the claim link to receive their ticket."
                  : purchase.data.status === "processing" ||
                      purchase.data.status === null
                    ? "Use this order’s retry button to check again. A claim link alone does not confirm a purchase."
                    : "This order did not purchase the ticket."}
              </p>
              {(purchase.data.status === "confirmed" ||
                purchase.data.status === "processing" ||
                purchase.data.status === null) && (
                <a
                  className="text-link"
                  href={purchase.data.claimUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open claim link <ArrowUpRight size={15} />
                </a>
              )}
            </div>
          )}
          <p className="mono order-id">
            {order ? `Order ${order.orderId}` : ""}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
