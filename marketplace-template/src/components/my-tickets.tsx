import { useQuery } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import { useState } from "react";
import { type FanTicket, listFanTickets } from "../lib/kyd";
import { EmptyState, QueryFeedback, StatusLabel } from "./feedback";
import { ResaleDialog } from "./resale-dialog";
import { Button } from "./ui/button";

export function MyTickets({
  user,
  fanApiUrl,
  onSignIn,
  resaleEnabled,
}: {
  user: User | null;
  fanApiUrl?: string;
  onSignIn: () => void;
  resaleEnabled: boolean;
}) {
  const [selected, setSelected] = useState<FanTicket | null>(null);
  const tickets = useQuery({
    queryKey: ["my-tickets", user?.profile.sub, user?.access_token],
    queryFn: () => listFanTickets(user?.access_token ?? "", fanApiUrl ?? ""),
    enabled: Boolean(user && fanApiUrl),
    retry: false,
    gcTime: 0,
  });
  if (!fanApiUrl)
    return (
      <div className="notice notice-warning">
        <p>
          <StatusLabel state="warning">KYD client not configured</StatusLabel>
        </p>
        <p>
          Set <code>KYD_OIDC_CLIENT_ID</code> in <code>.env</code> to enable
          sign-in and ticket inventory.
        </p>
      </div>
    );
  if (!user)
    return (
      <EmptyState title="Sign in to load tickets">
        <Button onClick={onSignIn}>Sign in with KYD</Button>
      </EmptyState>
    );
  return (
    <section>
      <div className="section-heading">
        <div>
          <h2>KYD ticket inventory</h2>
          <code>GET /fans/tickets</code>
        </div>
        <Button
          variant="outline"
          disabled={tickets.isFetching}
          onClick={() => void tickets.refetch()}
        >
          Refresh
        </Button>
      </div>
      <QueryFeedback
        pending={tickets.isPending}
        error={tickets.error}
        retry={() => void tickets.refetch()}
      />
      <p className="notice notice-warning">
        {resaleEnabled
          ? "Resale pays proceeds to this app’s TDP integrator treasury."
          : "Configure a TDP API key to create resale listings."}
      </p>
      {tickets.data?.length === 0 && (
        <EmptyState title="No tickets">
          This KYD account returned no tickets in the selected environment.
        </EmptyState>
      )}
      {Boolean(tickets.data?.length) && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Ticket type</th>
                <th>Status</th>
                <th>TDP event / ticket</th>
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.data?.map((ticket) => (
                <tr key={ticket.id}>
                  <td>{ticket.event_name ?? "—"}</td>
                  <td>{ticket.ticket_type_name ?? "—"}</td>
                  <td>{ticket.status ?? "—"}</td>
                  <td className="mono">
                    {ticket.on_chain_metadata?.tix_event_id ?? "—"} /{" "}
                    {ticket.on_chain_metadata?.tix_permit_id ?? "—"}
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      disabled={
                        !resaleEnabled ||
                        !ticket.on_chain_metadata?.tix_event_id ||
                        !ticket.on_chain_metadata?.tix_permit_id
                      }
                      onClick={() => setSelected(ticket)}
                    >
                      List for resale
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <ResaleDialog
          key={selected.id}
          ticket={selected}
          user={user}
          fanApiUrl={fanApiUrl}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
