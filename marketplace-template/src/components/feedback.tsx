import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";

export function StatusLabel({
  state,
  children,
}: {
  state: "warning" | "ready" | "error";
  children: ReactNode;
}) {
  const Icon =
    state === "warning"
      ? CircleAlert
      : state === "error"
        ? CircleX
        : CircleCheck;
  return (
    <span className={`connection-status status-${state}`}>
      <Icon size={15} aria-hidden="true" />
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export function QueryFeedback({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => void;
}) {
  if (pending)
    return (
      <div className="loading" role="status">
        <LoaderCircle className="animate-spin" size={16} /> Loading…
      </div>
    );
  if (error)
    return (
      <div className="notice notice-error" role="alert">
        <p>
          <StatusLabel state="error">{error.message}</StatusLabel>
        </p>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  return null;
}
