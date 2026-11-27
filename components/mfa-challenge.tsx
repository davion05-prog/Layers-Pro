"use client";

import { useState, type FormEvent } from "react";
import { deviceId, security } from "../lib/session";
import { Field } from "./ui";

export function MfaChallenge({ complete }: { complete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code");
    setBusy(true);
    setError("");
    try {
      await security({ action: "verify", code, device: deviceId() });
      complete();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not verify the code",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="editor-form account-form" onSubmit={verify}>
      <Field label="Authenticator code">
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? "Checking…" : "Verify code"}
      </button>
    </form>
  );
}
