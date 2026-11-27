"use client";

import { useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { farmDefaults, rowSchema, type Row } from "../lib/model";
import { AccountFrame } from "./account-screen";
import { Field } from "./ui";

export function FarmOnboarding({
  date,
  email,
  syncError,
  save,
  logout,
}: {
  date: string;
  email: string;
  syncError: string;
  save: (row: Row) => Promise<void>;
  logout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = crypto.randomUUID();
    const row = rowSchema.safeParse({
      id,
      farmId: id,
      type: "farm",
      date,
      data: {
        ...farmDefaults,
        name: form.get("name"),
        location: form.get("location"),
      },
    });
    if (!row.success) {
      setError("Enter a farm name to continue.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save(row.data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save your farm.",
      );
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await logout();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    }
  }

  return (
    <AccountFrame>
      <div className="account-card-icon">
        <Building2 size={23} aria-hidden="true" />
      </div>
      <h1>Set up your first farm</h1>
      <p className="account-intro">
        Start with your farm details. You can add your flocks right after.
      </p>
      {syncError && (
        <p className="form-warning" role="status">
          {syncError}
        </p>
      )}
      <form className="editor-form account-form" onSubmit={submit}>
        <Field label="Farm name">
          <input
            name="name"
            autoComplete="organization"
            maxLength={120}
            required
          />
        </Field>
        <Field label="Location (optional)">
          <input name="location" maxLength={120} />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Create farm"}
        </button>
      </form>
      <div className="account-links">
        <p>{email}</p>
        <button className="text-button" onClick={() => void signOut()}>
          Log out
        </button>
      </div>
    </AccountFrame>
  );
}
