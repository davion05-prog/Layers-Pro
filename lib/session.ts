export type User = { id: string; email: string };

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function session(): Promise<{ configured: boolean; user: User | null }>;
export function session(
  body: object,
): Promise<{ verify?: boolean; success?: boolean }>;
export async function session(body?: object) {
  const res = await fetch(
    "/api/session",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok)
    throw new SessionError(data.error || "Could not access account", data.code);
  return data;
}
