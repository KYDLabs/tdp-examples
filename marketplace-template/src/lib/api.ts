export async function requestJson<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw Object.assign(
      new Error(body?.error ?? `Request failed (${response.status}).`),
      {
        canStartNewOrder: body?.canStartNewOrder === true,
        code: typeof body?.code === "string" ? body.code : undefined,
        requestId:
          typeof body?.requestId === "string" ? body.requestId : undefined,
      },
    );
  }
  return response.json();
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
