import type { ApiEnvironment } from "@tixprotocol/tdp-sdk";

export function readServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  production = env.NODE_ENV === "production",
) {
  const environment = env.TDP_ENVIRONMENT ?? "sandbox";
  if (environment !== "sandbox" && environment !== "live") {
    throw new Error("TDP_ENVIRONMENT must be sandbox or live.");
  }
  const apiKey = env.TDP_API_KEY?.trim() ?? "";
  const keyEnvironment = /^tdp_(sandbox|live)_/.exec(apiKey)?.[1];
  if (keyEnvironment && keyEnvironment !== environment) {
    throw new Error("TDP_API_KEY must match TDP_ENVIRONMENT.");
  }
  const baseApiUrl = validateHttpUrl(
    env.TDP_API_BASE_URL ??
      (environment === "sandbox"
        ? "https://api.sandbox.tix.xyz"
        : "https://api.tix.xyz"),
    "TDP_API_BASE_URL",
  );
  if (new URL(baseApiUrl).pathname !== "/") {
    throw new Error("TDP_API_BASE_URL must be an API origin without a path.");
  }
  const hostname = new URL(baseApiUrl).hostname;
  const sandboxHost = hostname.startsWith("api.sandbox.");
  if (
    hostname.startsWith("api.") &&
    sandboxHost !== (environment === "sandbox")
  ) {
    throw new Error("TDP_API_BASE_URL must match TDP_ENVIRONMENT.");
  }
  const clientId = env.KYD_OIDC_CLIENT_ID?.trim();
  if (!clientId && (env.KYD_OIDC_AUTHORITY || env.KYD_FAN_API_URL)) {
    throw new Error("Set KYD_OIDC_CLIENT_ID to enable KYD sign-in.");
  }
  const kyd = clientId
    ? {
        authority: validateHttpUrl(
          env.KYD_OIDC_AUTHORITY ?? "https://auth.kydlabs.com",
          "KYD_OIDC_AUTHORITY",
        ),
        clientId,
        fanApiUrl: validateHttpUrl(
          env.KYD_FAN_API_URL ?? "https://api.kydlabs.com",
          "KYD_FAN_API_URL",
        ),
        scope:
          "openid profile fan:read fan:write fan:tickets:read fan:tickets:write fan:listings:write",
      }
    : null;
  const port = Number(env.PORT ?? "5173");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be between 1 and 65535.");
  }
  return {
    environment: environment as ApiEnvironment,
    apiKey,
    baseApiUrl,
    checkoutEnabled: Boolean(apiKey),
    ordersDirectory: env.TDP_ORDERS_DIRECTORY ?? ".data/orders",
    host: env.HOST ?? "127.0.0.1",
    port,
    production,
    kyd,
  };
}

function validateHttpUrl(value: string, variable: string) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${variable} must be an HTTPS URL (HTTP is allowed locally).`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

export type ServerConfig = ReturnType<typeof readServerConfig>;

export function getPublicConfig(config: ServerConfig) {
  return {
    environment: config.environment,
    configured: Boolean(config.apiKey),
    checkoutEnabled: config.checkoutEnabled,
    kyd: config.kyd,
  };
}

export type PublicConfig = ReturnType<typeof getPublicConfig>;
