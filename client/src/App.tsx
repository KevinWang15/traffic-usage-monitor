import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { HostDto, UserDto } from "@shared/types/traffic";
import { SHARED_APP_NAME } from "@shared/config/runtime";
import { api, getToken, setToken, type JoinCommandResponse } from "./api";
import { bytesToGiB, formatBytes, formatDate, gibToBytes } from "./lib";

type AuthMode = "login" | "signup" | "forgot" | "reset" | "verify";

type Notice = { type: "ok" | "error"; message: string } | null;

function AuthPage({ onAuthed }: { onAuthed: (user: UserDto) => void }) {
  const initialPath = window.location.pathname;
  const initialToken = new URLSearchParams(window.location.search).get("token") || "";
  const [mode, setMode] = useState<AuthMode>(
    initialPath === "/reset-password" ? "reset" : initialPath === "/verify-email" ? "verify" : "login",
  );
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [token, setTokenValue] = useState(initialToken);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "signup") {
        const response = await api.signup(email, password, name);
        setNotice({ type: "ok", message: response.message || "Account created. Check your email to activate it." });
        setMode("login");
        setPassword("");
        return;
      }
      if (mode === "forgot") {
        const response = await api.forgotPassword(email);
        setNotice({ type: "ok", message: response.message || "If that email exists, a password reset link has been sent." });
        return;
      }
      const response =
        mode === "reset"
          ? await api.resetPassword(token, password)
          : mode === "verify"
            ? await api.verifyEmail(token)
            : await api.login(email, password);
      setToken(response.token);
      onAuthed(response.user);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Authentication failed" });
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setNotice(null);
    try {
      await api.resendVerificationEmail(email);
      setNotice({ type: "ok", message: "If the account exists and is not active, a new verification email has been sent." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to resend verification email" });
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signup"
      ? "Create account"
      : mode === "forgot"
        ? "Reset password"
        : mode === "reset"
          ? "Choose a new password"
          : mode === "verify"
            ? "Verify email"
            : "Log in";

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Central server + Linux agents</p>
        <h1>{SHARED_APP_NAME}</h1>
        <p className="muted">
          Sign up, copy the generated install command, and let each Linux host report dumb
          /proc/net/dev counters while the central server handles quotas, cycles, corrections, and alerts.
        </p>
        <h2>{title}</h2>
        <form onSubmit={submit} className="stack">
          {mode === "signup" ? (
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
          ) : null}
          {mode === "reset" || mode === "verify" ? (
            <label>
              Token
              <input value={token} onChange={(event) => setTokenValue(event.target.value)} required />
            </label>
          ) : null}
          {mode !== "reset" && mode !== "verify" ? (
            <label>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </label>
          ) : null}
          {mode !== "forgot" && mode !== "verify" ? (
            <label>
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                minLength={10}
                required
              />
            </label>
          ) : null}
          {notice ? <div className={`notice ${notice.type}`}>{notice.message}</div> : null}
          <button disabled={busy} className="primary">
            {busy ? "Working…" : title}
          </button>
        </form>
        <div className="auth-links">
          {mode === "login" ? (
            <button className="link-button" onClick={() => setMode("signup")}>
              Need an account? Sign up
            </button>
          ) : null}
          {mode === "login" ? (
            <button className="link-button" onClick={() => setMode("forgot")}>
              Forgot password?
            </button>
          ) : null}
          {mode === "login" ? (
            <button className="link-button" onClick={resendVerification} disabled={busy || !email}>
              Resend verification email
            </button>
          ) : null}
          {mode !== "login" ? (
            <button className="link-button" onClick={() => setMode("login")}>
              Back to login
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function AccountPanel({ user, onUserChanged }: { user: UserDto; onUserChanged: (user: UserDto) => void }) {
  const [threshold, setThreshold] = useState(String(user.defaultAlertThresholdPercent));
  const [joinCommand, setJoinCommand] = useState<JoinCommandResponse | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    api.joinCommand().then(setJoinCommand).catch((error) => setNotice({ type: "error", message: String(error) }));
  }, []);

  async function saveThreshold() {
    setNotice(null);
    try {
      const result = await api.updateAccount(Number(threshold));
      onUserChanged(result.user);
      setNotice({ type: "ok", message: "Default alert threshold saved." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to save" });
    }
  }

  async function rotateToken() {
    if (!confirm("Rotate the join token? Existing agents continue working, but old install commands will stop joining new nodes.")) {
      return;
    }
    setNotice(null);
    try {
      setJoinCommand(await api.rotateJoinToken());
      setNotice({ type: "ok", message: "Join token rotated." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to rotate token" });
    }
  }

  async function sendTestEmail() {
    setNotice(null);
    try {
      const result = await api.sendTestEmail();
      setNotice({ type: "ok", message: result.message || "Test email sent." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to send test email" });
    }
  }

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h2>Join Linux nodes</h2>
        </div>
        <span className="pill">{user.email}</span>
      </div>
      <p className="muted">
        Run this on a Linux host. It installs a dumb systemd agent that reports interface counters; the central server owns all policy.
      </p>
      <pre className="command">{joinCommand?.command || "Loading command…"}</pre>
      <div className="row wrap">
        <label className="compact-field">
          Default alert threshold (%)
          <input value={threshold} onChange={(event) => setThreshold(event.target.value)} type="number" min="0" max="100" step="0.01" />
        </label>
        <button onClick={saveThreshold}>Save default</button>
        <button onClick={rotateToken} className="secondary">
          Rotate join token
        </button>
        <button onClick={sendTestEmail} className="secondary">
          Send me a test email
        </button>
      </div>
      {joinCommand ? <p className="muted small">Token preview: {joinCommand.tokenPreview}</p> : null}
      {notice ? <div className={`notice ${notice.type}`}>{notice.message}</div> : null}
    </section>
  );
}

function HostCard({ host, userDefaultThreshold, onChanged }: { host: HostDto; userDefaultThreshold: number; onChanged: (host: HostDto) => void }) {
  const [name, setName] = useState(host.name || "");
  const [allowanceGiB, setAllowanceGiB] = useState(bytesToGiB(host.trafficAllowanceBytes));
  const [meteringType, setMeteringType] = useState(host.meteringType);
  const [resetPeriod, setResetPeriod] = useState(host.resetPeriod);
  const [resetDayOfMonth, setResetDayOfMonth] = useState(String(host.resetDayOfMonth));
  const [resetDayOfWeek, setResetDayOfWeek] = useState(String(host.resetDayOfWeek));
  const [resetMonth, setResetMonth] = useState(String(host.resetMonth));
  const [resetHourUtc, setResetHourUtc] = useState(String(host.resetHourUtc));
  const [resetMinuteUtc, setResetMinuteUtc] = useState(String(host.resetMinuteUtc));
  const [alertThreshold, setAlertThreshold] = useState(
    host.alertThresholdOverridePercent === null ? "" : String(host.alertThresholdOverridePercent),
  );
  const [pollInterval, setPollInterval] = useState(String(host.pollIntervalSeconds));
  const [remainingGiB, setRemainingGiB] = useState(bytesToGiB(host.remainingBytes));
  const [correctionReason, setCorrectionReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const usedPercent = useMemo(() => {
    if (host.remainingPercent === null) {
      return null;
    }
    return Math.max(0, Math.min(100, 100 - host.remainingPercent));
  }, [host.remainingPercent]);

  async function saveConfig() {
    setNotice(null);
    try {
      const response = await api.updateHost(host.id, {
        name,
        trafficAllowanceBytes: gibToBytes(allowanceGiB),
        meteringType,
        resetPeriod,
        resetDayOfMonth: Number(resetDayOfMonth),
        resetDayOfWeek: Number(resetDayOfWeek),
        resetMonth: Number(resetMonth),
        resetHourUtc: Number(resetHourUtc),
        resetMinuteUtc: Number(resetMinuteUtc),
        alertThresholdPercent: alertThreshold === "" ? null : Number(alertThreshold),
        pollIntervalSeconds: Number(pollInterval),
      });
      onChanged(response.host);
      setNotice({ type: "ok", message: "Host configuration saved." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to save host" });
    }
  }

  async function correctRemaining() {
    setNotice(null);
    try {
      const response = await api.correctRemaining(host.id, gibToBytes(remainingGiB), correctionReason);
      onChanged(response.host);
      setNotice({ type: "ok", message: "Remaining traffic corrected." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to correct remaining traffic" });
    }
  }

  return (
    <article className="host-card">
      <div className="host-top">
        <div>
          <h3>{host.name || host.hostname}</h3>
          <p className="muted small">
            {host.hostname} · {host.machineId || "no machine id"}
          </p>
        </div>
        <span className={`status ${host.status.toLowerCase()}`}>{host.status}</span>
      </div>

      <div className="metrics">
        <div>
          <span>Remaining</span>
          <strong>{formatBytes(host.remainingBytes)}</strong>
        </div>
        <div>
          <span>Used this cycle</span>
          <strong>{formatBytes(host.usedBytes)}</strong>
        </div>
        <div>
          <span>Allowance</span>
          <strong>{formatBytes(host.trafficAllowanceBytes)}</strong>
        </div>
        <div>
          <span>Remaining %</span>
          <strong>{host.remainingPercent === null ? "—" : `${host.remainingPercent.toFixed(2)}%`}</strong>
        </div>
      </div>
      {usedPercent !== null ? (
        <div className="bar"><span style={{ width: `${usedPercent}%` }} /></div>
      ) : null}

      <div className="grid-form">
        <label>
          Display name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Allowance (GiB)
          <input value={allowanceGiB} onChange={(event) => setAllowanceGiB(event.target.value)} type="number" min="0" step="0.01" />
        </label>
        <label>
          Metering
          <select value={meteringType} onChange={(event) => setMeteringType(event.target.value as HostDto["meteringType"])}>
            <option value="EGRESS_ONLY">Egress only</option>
            <option value="INGRESS_AND_EGRESS">Ingress + egress</option>
          </select>
        </label>
        <label>
          Reset period
          <select value={resetPeriod} onChange={(event) => setResetPeriod(event.target.value as HostDto["resetPeriod"])}>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </label>
        <label>
          Reset day of month
          <input value={resetDayOfMonth} onChange={(event) => setResetDayOfMonth(event.target.value)} type="number" min="1" max="31" />
        </label>
        <label>
          Reset day of week
          <select value={resetDayOfWeek} onChange={(event) => setResetDayOfWeek(event.target.value)}>
            <option value="0">Sunday</option>
            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
            <option value="6">Saturday</option>
          </select>
        </label>
        <label>
          Reset month
          <input value={resetMonth} onChange={(event) => setResetMonth(event.target.value)} type="number" min="1" max="12" />
        </label>
        <label>
          Reset hour UTC
          <input value={resetHourUtc} onChange={(event) => setResetHourUtc(event.target.value)} type="number" min="0" max="23" />
        </label>
        <label>
          Reset minute UTC
          <input value={resetMinuteUtc} onChange={(event) => setResetMinuteUtc(event.target.value)} type="number" min="0" max="59" />
        </label>
        <label>
          Alert threshold override (%)
          <input
            value={alertThreshold}
            onChange={(event) => setAlertThreshold(event.target.value)}
            placeholder={`Default ${userDefaultThreshold}%`}
            type="number"
            min="0"
            max="100"
            step="0.01"
          />
        </label>
        <label>
          Agent poll interval (s)
          <input value={pollInterval} onChange={(event) => setPollInterval(event.target.value)} type="number" min="10" max="3600" />
        </label>
      </div>
      <div className="row wrap">
        <button onClick={saveConfig}>Save host config</button>
        <span className="muted small">Last report: {formatDate(host.lastReportAt)} · Cycle: {host.currentCycleStartedAt ? formatDate(host.currentCycleStartedAt) : "—"}</span>
      </div>

      <div className="correction-box">
        <h4>Manual correction</h4>
        <p className="muted small">Set the remaining traffic directly when provider-side metering differs from collected counters.</p>
        <div className="row wrap">
          <label className="compact-field">
            Remaining (GiB)
            <input value={remainingGiB} onChange={(event) => setRemainingGiB(event.target.value)} type="number" min="0" step="0.01" />
          </label>
          <label className="compact-field grow">
            Reason
            <input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Optional" />
          </label>
          <button onClick={correctRemaining} className="secondary">Correct remaining</button>
        </div>
      </div>

      {notice ? <div className={`notice ${notice.type}`}>{notice.message}</div> : null}
    </article>
  );
}

function Dashboard({ user, onUserChanged, onLogout }: { user: UserDto; onUserChanged: (user: UserDto) => void; onLogout: () => void }) {
  const [hosts, setHosts] = useState<HostDto[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);

  async function loadHosts() {
    try {
      const response = await api.hosts();
      setHosts(response.hosts);
      setNotice(null);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to load hosts" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHosts();
    const id = window.setInterval(() => void loadHosts(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  function replaceHost(nextHost: HostDto) {
    setHosts((current) => current.map((host) => (host.id === nextHost.id ? nextHost : host)));
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Traffic allowance metering</p>
          <h1>{SHARED_APP_NAME}</h1>
        </div>
        <button onClick={onLogout} className="secondary">Log out</button>
      </header>

      <AccountPanel user={user} onUserChanged={onUserChanged} />

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Hosts</p>
            <h2>Monitored nodes</h2>
          </div>
          <button onClick={loadHosts} className="secondary">Refresh</button>
        </div>
        {notice ? <div className={`notice ${notice.type}`}>{notice.message}</div> : null}
        {loading ? <p className="muted">Loading hosts…</p> : null}
        {!loading && hosts.length === 0 ? (
          <p className="muted">No hosts have joined yet. Copy the command above and run it on a Linux server.</p>
        ) : null}
        <div className="hosts">
          {hosts.map((host) => (
            <HostCard key={host.id} host={host} userDefaultThreshold={user.defaultAlertThresholdPercent} onChanged={replaceHost} />
          ))}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) {
      return;
    }
    api
      .me()
      .then((response) => setUser(response.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  function logout() {
    setToken(null);
    setUser(null);
  }

  if (loading) {
    return <main className="auth-shell"><div className="auth-card">Loading…</div></main>;
  }

  if (!user) {
    return <AuthPage onAuthed={setUser} />;
  }

  return <Dashboard user={user} onUserChanged={setUser} onLogout={logout} />;
}
