"use client";

import { useEffect, useState } from "react";
import { security } from "../lib/session";

export function SecurityNotice({
  account,
  settings,
}: {
  account: string;
  settings: () => void;
}) {
  const [latest, setLatest] = useState<{ id: string; event: string }>();
  const seenKey = "layers-security-seen:" + account;
  useEffect(() => {
    let cancelled = false;
    security<{ events: { id: string; event: string; occurred_at: string }[] }>()
      .then((data) => {
        if (cancelled) return;
        const event = data.events.find(
          (item) =>
            item.event !== "Sign-in" &&
            Date.parse(item.occurred_at) > Date.now() - 7 * 86_400_000,
        );
        if (event && localStorage.getItem(seenKey) !== event.id)
          setLatest(event);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [seenKey]);

  function acknowledge() {
    if (!latest) return;
    try {
      localStorage.setItem(seenKey, latest.id);
    } catch {}
    setLatest(undefined);
  }

  return latest ? (
    <div className="form-warning security-notice" role="status">
      <strong>Account activity: {latest.event}</strong>
      <div className="row-actions">
        <button
          className="text-button"
          onClick={() => {
            acknowledge();
            settings();
          }}
        >
          Review security
        </button>
        <button className="text-button" onClick={acknowledge}>
          Dismiss
        </button>
      </div>
    </div>
  ) : null;
}
