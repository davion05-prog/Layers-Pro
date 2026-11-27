"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Egg, House, ShieldCheck } from "lucide-react";
import { SessionError, session } from "../lib/session";
import { Field, Logo } from "./ui";

export function AccountFrame({ children }: { children: ReactNode }) {
  return (
    <div className="account-layout">
      <aside className="account-brand">
        <Link href="/" aria-label="Layers Pro home">
          <Logo />
        </Link>
        <div className="account-brand-copy">
          <div className="account-brand-icon">
            <Egg size={32} aria-hidden="true" />
          </div>
          <p>Manage your flock with Layers Pro.</p>
        </div>
      </aside>
      <main className="account-main">
        <div className="account-card">{children}</div>
      </main>
    </div>
  );
}

export function AccountScreen({
  mode,
  configured,
  confirmation,
}: {
  mode: "login" | "signup";
  configured: boolean;
  confirmation?: string;
}) {
  const signup = mode === "signup";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkInbox, setCheckInbox] = useState(false);
  const [showResend, setShowResend] = useState(
    confirmation === "failed" || confirmation === "continue",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const confirmationNotice =
    confirmation === "failed"
      ? "This link could not sign you in. Try logging in first. If your email is still unconfirmed, request a new link below."
      : confirmation === "continue"
        ? "Log in to continue. If your email is still unconfirmed, request a new link below."
        : "";

  useEffect(() => {
    // Some older Supabase emails return credentials or an error in the fragment.
    // Verification takes place at Supabase and password login starts our session.
    if (/^#(?:access_token|error|refresh_token)=/.test(window.location.hash)) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (signup && password !== form.get("confirmPassword")) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await session({
        action: signup ? "register" : "login",
        email: email.trim(),
        password,
      });
      if (result.verify) {
        setCheckInbox(true);
        setShowResend(true);
      } else {
        window.location.replace("/");
      }
    } catch (cause) {
      if (cause instanceof SessionError && cause.code === "email_not_confirmed")
        setShowResend(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await session({ action: "resend", email: address });
      setMessage(
        "If confirmation is still pending, a fresh link will arrive at this address.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not send a confirmation email.",
      );
    } finally {
      setBusy(false);
    }
  }

  const emailField = (
    <Field label="Email address">
      <input
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        placeholder="you@example.com"
        required
      />
    </Field>
  );

  return (
    <AccountFrame>
      <div className="account-card-icon">
        <ShieldCheck size={23} aria-hidden="true" />
      </div>
      <h1>
        {checkInbox
          ? "Check your inbox"
          : signup
            ? "Create your account"
            : "Log in to Layers Pro"}
      </h1>
      <p className="account-intro">
        {checkInbox ? (
          <>
            Open the confirmation link sent to <strong>{email}</strong>, then
            log in to set up your farm.
          </>
        ) : signup ? (
          "Create an account to set up your farm and register your flocks."
        ) : (
          "Access your farms, flocks and daily records."
        )}
      </p>
      {!configured && (
        <p className="form-warning" role="status">
          Account access is unavailable on this deployment. You can still
          explore the demo.
        </p>
      )}
      {confirmationNotice && (
        <p className="form-warning" role="status">
          {confirmationNotice}
        </p>
      )}
      {!checkInbox && (
        <form className="editor-form account-form" onSubmit={submit}>
          {emailField}
          <Field label="Password">
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={72}
              autoComplete={signup ? "new-password" : "current-password"}
              required
            />
          </Field>
          {signup && (
            <Field label="Confirm password">
              <input
                name="confirmPassword"
                type="password"
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                required
              />
            </Field>
          )}
          <button className="button primary" disabled={!configured || busy}>
            {busy ? "Please wait…" : signup ? "Create account" : "Log in"}
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-warning" role="status">
          {message}
        </p>
      )}
      {showResend && (
        <form className="account-resend" onSubmit={resend}>
          <button
            className="text-button"
            disabled={!configured || busy || !email.trim()}
          >
            Resend confirmation email
          </button>
        </form>
      )}
      <div className="account-links">
        {signup ? (
          <p>
            {checkInbox ? "Email confirmed?" : "Already have an account?"}{" "}
            <Link href="/login">Log in</Link>
          </p>
        ) : (
          <p>
            New to Layers Pro? <Link href="/signup">Create an account</Link>
          </p>
        )}
        <Link href="/demo">Explore the demo</Link>
      </div>
    </AccountFrame>
  );
}

export function WorkspaceLoading() {
  return (
    <AccountFrame>
      <div className="account-card-icon">
        <House size={23} aria-hidden="true" />
      </div>
      <h1>Opening your workspace</h1>
      <p className="account-intro" role="status">
        Checking your session and farm records.
      </p>
      <div className="account-links">
        <Link href="/login">Go to log in</Link>
      </div>
    </AccountFrame>
  );
}
