import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GetIntegratorResponse } from "@tixprotocol/tdp-sdk";
import { Tabs } from "radix-ui";
import { useMemo } from "react";
import type { PublicConfig } from "../server/config";
import { Catalog } from "./components/catalog";
import { QueryFeedback, StatusLabel } from "./components/feedback";
import { MyTickets } from "./components/my-tickets";
import { Button } from "./components/ui/button";
import { requestJson } from "./lib/api";
import { formatAmount } from "./lib/format";
import { createKydUserManager } from "./lib/kyd";
import { useKydUser } from "./lib/use-kyd-user";

function ConnectionSetup() {
  return (
    <section className="setup-panel">
      <h2>
        <StatusLabel state="warning">Configuration needed</StatusLabel>
      </h2>
      <ol>
        <li>
          Create a sandbox key in the{" "}
          <a href="https://dashboard.tix.xyz" target="_blank" rel="noreferrer">
            TDP dashboard
          </a>{" "}
          with <strong>Query Solana</strong>. Add <strong>Accept offers</strong>{" "}
          for checkout.
        </li>
        <li>
          Register a sandbox client in the{" "}
          <a
            href="https://developers.kydlabs.com"
            target="_blank"
            rel="noreferrer"
          >
            KYD developer portal
          </a>{" "}
          with callback <code>http://localhost:5173/auth/callback</code>.
        </li>
        <li>
          Copy <code>.env.example</code> to <code>.env</code>. Set{" "}
          <code>TDP_API_KEY</code> and <code>KYD_OIDC_CLIENT_ID</code>.
          Development configuration reloads automatically.
        </li>
      </ol>
    </section>
  );
}

function Marketplace({ config }: { config: PublicConfig }) {
  const queryClient = useQueryClient();
  const manager = useMemo(
    () =>
      config.kyd ? createKydUserManager(config.kyd, config.environment) : null,
    [config.kyd, config.environment],
  );
  const auth = useKydUser(manager);
  const treasury = useQuery({
    queryKey: ["treasury"],
    queryFn: () => requestJson<GetIntegratorResponse>("/api/treasury"),
    enabled: config.configured && config.checkoutEnabled,
    retry: false,
  });
  async function signOut() {
    await auth.signOut();
    queryClient.removeQueries({ queryKey: ["my-tickets"] });
  }
  if (window.location.pathname === "/auth/callback") {
    return (
      <main className="initial-loading">
        <p role={auth.error ? "alert" : "status"}>
          {auth.error?.message ??
            (auth.pending
              ? "Completing sign-in…"
              : "This window should close automatically. If it stays open, close it and start sign-in again from the marketplace.")}
        </p>
      </main>
    );
  }
  return (
    <>
      <header className="site-header">
        <div className="site-heading">
          <span className="spectrum-mark" aria-hidden="true" />
          <div>
            <h1>TDP / KYD marketplace</h1>
            <p className="muted">Integration proof of concept</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="environment-badge">{config.environment}</span>
          {auth.user ? (
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out of this app
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!manager || auth.pending}
              onClick={() => void auth.signIn()}
            >
              {auth.pending ? "Connecting…" : "Sign in with KYD"}
            </Button>
          )}
        </div>
      </header>
      <main>
        <section className="architecture" aria-label="Connections">
          <div
            className="connection-panel"
            data-state={config.configured ? "ready" : "warning"}
          >
            <h2>TDP</h2>
            <code>React → app server → TDP SDK</code>
            <p>
              <StatusLabel state={config.configured ? "ready" : "warning"}>
                {config.configured
                  ? "API key configured"
                  : "API key not configured"}
              </StatusLabel>
              <span className="muted"> · SDK 0.5.0</span>
            </p>
          </div>
          <div
            className="connection-panel"
            data-state={auth.error ? "error" : config.kyd ? "ready" : "warning"}
          >
            <h2>KYD Labs</h2>
            <code>React → OIDC / fan API</code>
            <p>
              <StatusLabel
                state={auth.error ? "error" : config.kyd ? "ready" : "warning"}
              >
                {auth.error
                  ? "Sign-in failed"
                  : auth.user
                    ? "Fan signed in"
                    : config.kyd
                      ? "Client configured · signed out"
                      : "OIDC client not configured"}
              </StatusLabel>
            </p>
          </div>
        </section>
        {auth.error && (
          <p className="notice notice-error" role="alert">
            <StatusLabel state="error">{auth.error.message}</StatusLabel>
          </p>
        )}
        {(!config.configured || !config.kyd) && <ConnectionSetup />}
        <div className="catalog-shell">
          <Tabs.Root defaultValue="events">
            <div className="catalog-toolbar">
              <Tabs.List className="tabs-list" aria-label="Marketplace">
                <Tabs.Trigger className="tab" value="events">
                  Events
                </Tabs.Trigger>
                <Tabs.Trigger className="tab" value="listings">
                  Listings
                </Tabs.Trigger>
                <Tabs.Trigger className="tab" value="mine">
                  My KYD tickets
                </Tabs.Trigger>
              </Tabs.List>
              {config.checkoutEnabled && (
                <span className="balance">
                  Treasury:{" "}
                  {treasury.data
                    ? formatAmount(
                        treasury.data.integrator.balance.amount_cents,
                      )
                    : treasury.error
                      ? "unavailable"
                      : "loading…"}
                </span>
              )}
            </div>
            <Tabs.Content value="events" className="tab-content">
              {config.configured ? (
                <Catalog
                  kind="events"
                  checkoutEnabled={config.checkoutEnabled}
                />
              ) : (
                <p className="notice notice-warning">
                  <StatusLabel state="warning">
                    Set TDP_API_KEY to load events.
                  </StatusLabel>
                </p>
              )}
            </Tabs.Content>
            <Tabs.Content value="listings" className="tab-content">
              {config.configured ? (
                <Catalog
                  kind="listings"
                  checkoutEnabled={config.checkoutEnabled}
                />
              ) : (
                <p className="notice notice-warning">
                  <StatusLabel state="warning">
                    Set TDP_API_KEY to load listings.
                  </StatusLabel>
                </p>
              )}
            </Tabs.Content>
            <Tabs.Content value="mine" className="tab-content">
              <MyTickets
                user={auth.user}
                fanApiUrl={config.kyd?.fanApiUrl}
                onSignIn={() => void auth.signIn()}
                resaleEnabled={config.checkoutEnabled}
              />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </main>
      <footer>
        <span>
          React + Vite · See README.md for setup and integration limits.
        </span>
        <a href="https://docs.tix.xyz" target="_blank" rel="noreferrer">
          TDP docs ↗
        </a>
      </footer>
    </>
  );
}

export function App() {
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => requestJson<PublicConfig>("/api/config"),
    staleTime: Infinity,
  });
  if (!config.data)
    return (
      <main className="initial-loading">
        <QueryFeedback
          pending={config.isPending}
          error={config.error}
          retry={() => void config.refetch()}
        />
      </main>
    );
  return <Marketplace config={config.data} />;
}
