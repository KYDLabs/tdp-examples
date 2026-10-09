import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { User } from "oidc-client-ts";
import { Dialog } from "radix-ui";
import { useState } from "react";
import type { prepareResale, submitResale } from "../../server/resale";
import { postJson } from "../lib/api";
import { authorizeResale, type FanTicket } from "../lib/kyd";
import { Button } from "./ui/button";

export function ResaleDialog({
  ticket,
  user,
  fanApiUrl,
  onClose,
}: {
  ticket: FanTicket;
  user: User;
  fanApiUrl: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const eventId = ticket.on_chain_metadata?.tix_event_id;
  const ticketId = ticket.on_chain_metadata?.tix_permit_id;
  const storageKey = `tdp:resale:${fanApiUrl}:${user.profile.sub}:${eventId}:${ticketId}`;
  const [transaction, setTransaction] = useState<string | null>(() =>
    sessionStorage.getItem(storageKey),
  );
  const [price, setPrice] = useState("100");
  const [expiresAt, setExpiresAt] = useState("");
  const resale = useMutation({
    mutationFn: async () => {
      let authorizedTransaction = transaction;
      if (!authorizedTransaction) {
        const prepared = await postJson<
          Awaited<ReturnType<typeof prepareResale>>
        >(`/api/resale/${eventId}/${ticketId}/prepare`, {
          askPriceCents: Number(price),
          expiresAt: String(Math.floor(new Date(expiresAt).getTime() / 1000)),
        });
        authorizedTransaction = await authorizeResale(
          user.access_token,
          fanApiUrl,
          prepared.transaction,
        );
        sessionStorage.setItem(storageKey, authorizedTransaction);
        setTransaction(authorizedTransaction);
      }
      return postJson<Awaited<ReturnType<typeof submitResale>>>(
        "/api/resale/submit",
        { transaction: authorizedTransaction },
      );
    },
    onSuccess: async (result) => {
      if (result.status === "confirmed") {
        await queryClient.invalidateQueries({ queryKey: ["listings"] });
        await queryClient.invalidateQueries({ queryKey: ["my-tickets"] });
      }
    },
  });
  const terminal =
    resale.data?.status === "confirmed" ||
    resale.data?.status === "landed_with_error" ||
    resale.data?.status === "expired";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Close asChild>
            <Button
              variant="ghost"
              className="dialog-close"
              aria-label="Close resale"
            >
              <X size={18} />
            </Button>
          </Dialog.Close>
          <Dialog.Title>List ticket for resale</Dialog.Title>
          <Dialog.Description>
            {ticket.event_name ?? eventId} · Ticket {ticketId}
          </Dialog.Description>
          <p className="notice notice-warning">
            Proceeds go to this app’s TDP integrator treasury, not the seller’s
            wallet. Listing spends funds for fees and storage.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              resale.mutate();
            }}
          >
            <label htmlFor="resale-price">Price in cents (100 = $1.00)</label>
            <input
              id="resale-price"
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={price}
              disabled={Boolean(transaction) || resale.isPending}
              onChange={(event) => setPrice(event.target.value)}
            />
            <label htmlFor="resale-expiry">Expiry (your local time)</label>
            <input
              id="resale-expiry"
              type="datetime-local"
              required={!transaction}
              value={expiresAt}
              disabled={Boolean(transaction) || resale.isPending}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
            <Button
              type="submit"
              className="full-width"
              disabled={resale.isPending || terminal}
            >
              {resale.isPending
                ? "Listing…"
                : terminal
                  ? "Submission complete"
                  : transaction
                    ? "Check / retry same transaction"
                    : "Authorize and list"}
            </Button>
          </form>
          {transaction && !terminal && (
            <p className="form-hint">
              The authorized transaction is saved for this session. Retry it
              rather than starting another listing if the outcome is uncertain.
            </p>
          )}
          {resale.error && (
            <p className="notice notice-error" role="alert">
              {resale.error.message}
            </p>
          )}
          {resale.data && (
            <div className="order-result" role="status">
              <strong>
                {resale.data.status === "confirmed"
                  ? "Listing confirmed. Refresh Listings to see it after indexing."
                  : resale.data.status === "landed_with_error"
                    ? "Listing transaction failed on-chain."
                    : resale.data.status === "expired"
                      ? "Listing transaction expired."
                      : "Submission pending; listing is not yet confirmed."}
              </strong>
              <p>{resale.data.failureReason}</p>
              <p className="mono order-id">
                {resale.data.transactionSignature}
              </p>
            </div>
          )}
          {terminal && (
            <Button
              variant="outline"
              onClick={() => {
                sessionStorage.removeItem(storageKey);
                setTransaction(null);
                resale.reset();
                onClose();
              }}
            >
              Done
            </Button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
