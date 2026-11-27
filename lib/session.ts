export type User = { id: string; email: string };

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function session(): Promise<{
  configured: boolean;
  user: User | null;
  mfaRequired: boolean;
}>;
export function session(
  body: object,
): Promise<{
  verify?: boolean;
  success?: boolean;
  mfaRequired?: boolean;
  signOutFailed?: boolean;
}>;
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

export function deviceId() {
  try {
    const previous = localStorage.getItem("layers-pro-device");
    if (previous) return previous;
    const id = crypto.randomUUID();
    localStorage.setItem("layers-pro-device", id);
    return id;
  } catch {
    return undefined;
  }
}

export async function security<T>(body?: object): Promise<T> {
  const res = await fetch(
    "/api/security",
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
    throw new SessionError(
      data.error || "Could not access security settings.",
      data.code,
    );
  return data;
}
