import { useEffect, useState } from "react";
import { LogIn, LogOut, User } from "lucide-react";
import { getAuthStatus, login, logout } from "../api";
import { getAuth } from "../auth";
import ErrorAlert from "./ErrorAlert";

export default function AuthBar() {
  const [available, setAvailable] = useState(false);
  const [username, setUsername] = useState(getAuth()?.username || "");
  const [showForm, setShowForm] = useState(false);
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuthStatus()
      .then((s) => setAvailable(s.available))
      .catch(() => setAvailable(false));
  }, []);

  if (!available) {
    // Sign-in needs MongoDB configured — stay invisible rather than show a
    // feature that can't work, keeping the no-DB experience exactly as before.
    return null;
  }

  async function handleSignIn() {
    if (!formUsername.trim() || !formPassword) return;
    setBusy(true);
    setError(null);
    try {
      const result = await login(formUsername.trim(), formPassword);
      setUsername(result.username);
      setShowForm(false);
      setFormPassword("");
    } catch (e: any) {
      setError(e.message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await logout();
    setUsername("");
  }

  if (username) {
    return (
      <div className="auth-bar">
        <User size={13} />
        <span className="auth-username">{username}</span>
        <button className="auth-link" onClick={handleSignOut} title="Sign out">
          <LogOut size={13} />
        </button>
      </div>
    );
  }

  if (!showForm) {
    return (
      <button className="auth-bar auth-signin-trigger" onClick={() => setShowForm(true)}>
        <LogIn size={13} />
        <span>Sign in</span>
      </button>
    );
  }

  return (
    <div className="auth-form">
      <input
        placeholder="Username"
        value={formUsername}
        onChange={(e) => setFormUsername(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
      />
      <input
        type="password"
        placeholder="Password"
        value={formPassword}
        onChange={(e) => setFormPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
      />
      {error && <ErrorAlert error={error} style={{ marginTop: 8 }} />}
      <div className="auth-form-actions">
        <button className="small" onClick={() => setShowForm(false)} disabled={busy}>
          Cancel
        </button>
        <button className="small" onClick={handleSignIn} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
      <p className="auth-hint">New username? It creates your account automatically.</p>
    </div>
  );
}
