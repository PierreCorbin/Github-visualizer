"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full navigation so the browser sends the just-set cookie on the next
        // request. router.push uses the RSC cache which doesn't always pick up
        // a fresh HttpOnly cookie on the first hop.
        const next = new URLSearchParams(window.location.search).get("next") || "/";
        window.location.assign(next);
        return; // unmounts; don't clear `busy` so the button stays in "Unlocking…"
      } else {
        setError("Incorrect password");
        setBusy(false);
      }
    } catch {
      setError("Network error — try again");
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="login-mark">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <path d="M6 9v3a3 3 0 0 0 3 3h6" />
            </svg>
          </div>
          <div>
            <h1>Flash Repo Visualizer</h1>
            <p>Enter the shared team password to continue.</p>
          </div>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
        />
        <button type="submit" disabled={busy || !password}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
