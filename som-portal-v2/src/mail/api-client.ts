// som-portal-v2/src/mail/api-client.ts
// Browser helper for the /v2/api/mail routes. Returns the unwrapped data or throws
// with the server's message.
export async function mailCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/v2/api/${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}
