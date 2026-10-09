export function formatAmount(cents: number | null) {
  if (cents === null || !Number.isInteger(cents) || cents < 0) {
    return "Price unavailable";
  }
  return `${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC`;
}

export function formatEventDate(
  value: string | null,
  timezone?: string | null,
) {
  if (!value || Number.isNaN(Date.parse(value))) return "Date to be announced";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export function abbreviateAddress(value: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Unavailable";
}
