"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SessionError, session } from "../lib/session";
import { AccountFrame } from "./account-screen";
import { MfaChallenge } from "./mfa-challenge";
import { PasswordField } from "./password-field";
import { Field } from "./ui";

export function RecoveryScreen({
  update,
  expired = false,
}: {
  update: boolean;
  expired?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [revocationFailed, setRevocationFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = fields.get("password");
    setError("");
    if (update && password !== fields.get("confirmPassword")) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (update) {
        const result = await session({ action: "password-update", password });
        if (result.signOutFailed) setRevocationFailed(true);
        else window.location.replace("/login?confirmation=password-updated");
      } else {
        await session({ action: "password-reset", email: fields.get("email") });
        setSent(true);
      }
    } catch (cause) {
      if (cause instanceof SessionError && cause.code === "mfa_required")
        setChallenge(true);
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not complete this request.",
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFrame>
      <h1>
        {challenge
          ? "Verify your authenticator"
          : revocationFailed
            ? "Password updated"
            : update
              ? "Choose a new password"
              : sent
                ? "Check your inbox"
                : "Reset your password"}
      </h1>
      {!update && !sent && (
        <p className="account-intro">
          Enter the email address you used to register.
        </p>
      )}
      {expired && (
        <p className="form-warning">
          That reset link expired or could not be used. Request a new link and
          open it in this browser.
        </p>
      )}
      {sent && (
        <p role="status">
          If your email belongs to an account, a reset link will arrive shortly.
          Open it in this browser.
        </p>
      )}
      {revocationFailed && (
        <p role="status">
          Your password changed. Use Sign out all devices in account settings to
          end other sessions.
        </p>
      )}
      {challenge && <MfaChallenge complete={() => setChallenge(false)} />}
      {!sent && !challenge && !revocationFailed && (
        <form className="editor-form account-form" onSubmit={submit}>
          {update ? (
            <>
              <PasswordField label="New password" autoComplete="new-password" />
              <PasswordField
                label="Confirm password"
                name="confirmPassword"
                autoComplete="new-password"
              />
            </>
          ) : (
            <Field label="Email address">
              <input name="email" type="email" autoComplete="email" required />
            </Field>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : update
                ? "Update password"
                : "Send reset link"}
          </button>
        </form>
      )}
      <div className="account-links">
        {update && (
          <Link href="/forgot-password">Request a new reset link</Link>
        )}
        <Link href="/login">Back to login</Link>
      </div>
    </AccountFrame>
  );
}
