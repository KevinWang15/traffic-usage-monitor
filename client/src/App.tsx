import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  BellOff,
  Check,
  Copy,
  Download,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { HostDto, TrafficSampleDto, UserDto } from "@shared/types/traffic";
import { SHARED_APP_NAME } from "@shared/config/runtime";
import { api, getToken, setToken, type JoinCommandResponse } from "./api";
import { bytesToGiB, formatBytes, gibToBytes } from "./lib";

type AuthMode = "login" | "signup" | "forgot" | "reset" | "verify";
type Notice = { type: "ok" | "error"; message: string } | null;
type FleetStatus = "active" | "warning" | "critical" | "exceeded" | "missing" | "disabled";
type Density = "comfy" | "compact" | "ultra";
type GroupBy = "none" | "provider" | "region" | "tag" | "status";
type SortKey =
  | "status"
  | "hostname"
  | "publicIp"
  | "provider"
  | "region"
  | "usedBytes"
  | "remainingBytes"
  | "trafficAllowanceBytes"
  | "usedPercent"
  | "last24hBytes"
  | "recentRateMbps"
  | "lastSeenSort";

type NodeView = {
  host: HostDto;
  id: string;
  hostname: string;
  publicIp: string;
  title: string;
  provider: string;
  region: string;
  tags: string[];
  status: FleetStatus;
  usedBytes: number;
  remainingBytes: number;
  trafficAllowanceBytes: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  last24hBytes: number;
  recentRateMbps: number;
  spark: number[];
  cycle: string;
  lastSeenSort: number;
};

const statusOptions: Array<{ value: FleetStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
  { value: "exceeded", label: "Exceeded" },
  { value: "missing", label: "Missing" },
  { value: "disabled", label: "Disabled" },
];

const weekDayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function asNumberBytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentUsed(host: HostDto): number | null {
  if (host.remainingPercent !== null) {
    return Math.max(0, Math.min(100, 100 - host.remainingPercent));
  }
  const allowance = asNumberBytes(host.trafficAllowanceBytes);
  return allowance > 0 ? Math.min(100, (asNumberBytes(host.usedBytes) / allowance) * 100) : null;
}

function deriveStatus(host: HostDto): FleetStatus {
  if (host.status === "DISABLED") {
    return "disabled";
  }
  if (host.status === "STALE") {
    return "missing";
  }
  if (host.remainingPercent === null) {
    return "active";
  }
  if (host.remainingPercent <= 0) {
    return "exceeded";
  }
  if (host.remainingPercent <= 10) {
    return "critical";
  }
  if (host.remainingPercent <= host.alertThresholdPercent) {
    return "warning";
  }
  return "active";
}

function statusTone(status: FleetStatus): "ok" | "warn" | "crit" | "off" {
  if (status === "active") {
    return "ok";
  }
  if (status === "warning") {
    return "warn";
  }
  if (status === "critical" || status === "exceeded") {
    return "crit";
  }
  return "off";
}

function statusRank(status: FleetStatus): number {
  return { missing: 6, exceeded: 5, critical: 4, warning: 3, disabled: 1, active: 0 }[status];
}

function labelStatus(status: FleetStatus): string {
  return status.toUpperCase();
}

function labelGroupBy(value: GroupBy): string {
  return value === "region" ? "Country" : value[0].toUpperCase() + value.slice(1);
}

function detectProvider(host: HostDto): string {
  const source = `${host.name || ""} ${host.hostname}`.toLowerCase();
  const known = [
    "DMIT",
    "OneProvider",
    "DreamCloud",
    "Bandwagon",
    "RFCHost",
    "Hetzner",
    "OVH",
    "Vultr",
    "Linode",
    "Contabo",
    "LeaseWeb",
    "Datapacket",
  ];
  return known.find((provider) => source.includes(provider.toLowerCase())) || "Unassigned";
}

function hostCountryCode(host: HostDto): string {
  return host.countryCode || "--";
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function fallbackSpark(seed: string, used: number | null): number[] {
  const base = Math.max(0.08, Math.min(1, (used ?? 20) / 100));
  let value = base;
  return Array.from({ length: 48 }, (_, index) => {
    const noise = (hashString(`${seed}:${index}`) % 1000) / 1000 - 0.5;
    value = Math.max(0.02, Math.min(1, value + noise * 0.22));
    return value;
  });
}

function toNodeView(host: HostDto): NodeView {
  const used = percentUsed(host);
  const provider = detectProvider(host);
  const region = hostCountryCode(host);
  const status = deriveStatus(host);
  return {
    host,
    id: host.id,
    hostname: host.hostname,
    publicIp: host.publicIp || "",
    title: host.name || host.hostname,
    provider,
    region,
    tags: [host.meteringType === "EGRESS_ONLY" ? "egress" : "in-out", host.resetPeriod.toLowerCase(), status].filter(
      (tag, index, tags) => tags.indexOf(tag) === index,
    ),
    status,
    usedBytes: asNumberBytes(host.usedBytes),
    remainingBytes: asNumberBytes(host.remainingBytes),
    trafficAllowanceBytes: asNumberBytes(host.trafficAllowanceBytes),
    usedPercent: used,
    remainingPercent: host.remainingPercent,
    last24hBytes: (host.trafficSpark || []).reduce((sum, bytes) => sum + bytes, 0),
    recentRateMbps: host.recentRateMbps || 0,
    spark: host.trafficSpark?.length ? host.trafficSpark : fallbackSpark(host.id, used),
    cycle: host.resetPeriod.toLowerCase(),
    lastSeenSort: host.lastSeenAt ? new Date(host.lastSeenAt).getTime() : 0,
  };
}

function formatRate(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) {
    return "0 Kbps";
  }
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(2)} Gbps`;
  }
  if (mbps >= 1) {
    return `${mbps.toFixed(0)} Mbps`;
  }
  return `${(mbps * 1000).toFixed(0)} Kbps`;
}

function formatRateAxis(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) {
    return "0 K";
  }
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(2)} G`;
  }
  if (mbps >= 1) {
    return `${mbps.toFixed(0)} M`;
  }
  return `${(mbps * 1000).toFixed(0)} K`;
}

function relTime(value: string | null): string {
  if (!value) {
    return "never";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

function shortDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function Sparkline({ data, tone = "ok", width = 72, height = 18 }: { data: number[]; tone?: string; width?: number; height?: number }) {
  if (data.length === 0) {
    return null;
  }
  const max = Math.max(...data, 0.001);
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((value, index) => [index * step, height - (value / max) * (height - 2) - 1]);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg className={`spark ${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path className="area" d={area} />
      <path className="line" d={line} />
    </svg>
  );
}

function bucketedBytesToMbps(data: number[], windowHours = 24): number[] {
  if (data.length === 0) {
    return [];
  }
  const bucketSeconds = (windowHours * 60 * 60) / data.length;
  return data.map((bytes) => (bytes * 8) / bucketSeconds / 1_000_000);
}

function TimeSeries({ data, tone = "ok" }: { data: number[]; tone?: string }) {
  const series = data.length ? data : [0];
  const width = 520;
  const height = 112;
  const pad = { left: 40, right: 8, top: 8, bottom: 18 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(...series, 0.001);
  const step = series.length > 1 ? plotWidth / (series.length - 1) : plotWidth;
  const points = series.map((value, index) => [pad.left + index * step, pad.top + plotHeight - (value / max) * plotHeight]);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pad.left + plotWidth},${pad.top + plotHeight} L${pad.left},${pad.top + plotHeight} Z`;
  return (
    <svg className={`spark ${tone} timeseries`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Traffic history">
      {[0.25, 0.5, 0.75].map((gridLine) => (
        <line key={gridLine} x1={pad.left} x2={pad.left + plotWidth} y1={pad.top + plotHeight * gridLine} y2={pad.top + plotHeight * gridLine} />
      ))}
      <path className="area" d={area} />
      <path className="line" d={line} />
      {[0, 0.5, 1].map((tick) => (
        <text key={tick} x={pad.left - 6} y={pad.top + plotHeight * tick + 3} textAnchor="end">
          {formatRateAxis(max * (1 - tick))}
        </text>
      ))}
      {[0, 0.5, 1].map((tick) => (
        <text key={tick} x={pad.left + plotWidth * tick} y={height - 4} textAnchor="middle">
          {tick === 1 ? "now" : `-${Math.round(24 * (1 - tick))}h`}
        </text>
      ))}
    </svg>
  );
}

function UsageBar({ node }: { node: NodeView }) {
  if (node.usedPercent === null) {
    return <span className="muted-inline">No allowance</span>;
  }
  const tone = statusTone(node.status);
  return (
    <div className="usage">
      <div className="usage-bar">
        <div className={`fill ${tone}`} style={{ width: `${Math.min(100, node.usedPercent).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

function StatusCell({ status }: { status: FleetStatus }) {
  const tone = statusTone(status);
  return (
    <span className={`status-cell ${tone}`}>
      <span className={`sdot ${tone}${tone === "ok" ? " live" : ""}`} />
      <span className="mono">{labelStatus(status)}</span>
    </span>
  );
}

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
        <div className="brand auth-brand">
          <div className="brand-mark">T</div>
          <div className="brand-name">Traffic Monitor<small>allowance metering</small></div>
        </div>
        <h1>{SHARED_APP_NAME}</h1>
        <p className="auth-copy">
          Centralized allowance metering for Linux agents with quota cycles, manual corrections, alerts, and audit-ready counters.
        </p>
        <h2>{title}</h2>
        <form onSubmit={submit} className="auth-form">
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
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={10} required />
            </label>
          ) : null}
          {notice ? <div className={`notice ${notice.type}`}>{notice.message}</div> : null}
          <button disabled={busy} className="btn btn-primary auth-submit">
            {busy ? "Working..." : title}
          </button>
        </form>
        <div className="auth-links">
          {mode === "login" ? <button onClick={() => setMode("signup")}>Need an account? Sign up</button> : null}
          {mode === "login" ? <button onClick={() => setMode("forgot")}>Forgot password?</button> : null}
          {mode === "login" ? <button onClick={resendVerification} disabled={busy || !email}>Resend verification email</button> : null}
          {mode !== "login" ? <button onClick={() => setMode("login")}>Back to login</button> : null}
        </div>
      </section>
    </main>
  );
}

function AccountPanel({ user, onUserChanged }: { user: UserDto; onUserChanged: (user: UserDto) => void }) {
  const [threshold, setThreshold] = useState(String(user.defaultAlertThresholdPercent));
  const [joinCommand, setJoinCommand] = useState<JoinCommandResponse | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.joinCommand().then(setJoinCommand).catch((error) => setNotice({ type: "error", message: String(error) }));
  }, []);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function saveThreshold() {
    setNotice(null);
    try {
      const result = await api.updateAccount(Number(threshold));
      onUserChanged(result.user);
      setNotice({ type: "ok", message: "Default alert threshold saved." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to save threshold" });
    }
  }

  async function rotateToken() {
    if (!confirm("Rotate the join token? Existing agents continue working, but old install commands stop joining new nodes.")) {
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

  async function copyCommand() {
    if (!joinCommand?.command) {
      return;
    }
    setNotice(null);
    try {
      await navigator.clipboard.writeText(joinCommand.command);
      setCopied(true);
    } catch {
      setNotice({ type: "error", message: "Failed to copy install command." });
    }
  }

  async function handleExportConfig() {
    setExportLoading(true);
    setNotice(null);
    try {
      const data = await api.exportConfig();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeEmail = (user.email || "user").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `traffic-usage-monitor-config-${safeEmail}-${date}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setNotice({
        type: "ok",
        message: `Exported ${data.hosts.length} host configuration${data.hosts.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to export configuration" });
    } finally {
      setExportLoading(false);
    }
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (
      !confirm(
        "This will replace your account name, join token, default alert threshold, and host configurations with the uploaded backup. Continue?",
      )
    ) {
      return;
    }
    setImportLoading(true);
    setNotice(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const result = await api.importConfig(payload);
      setJoinCommand(await api.joinCommand());
      const refreshed = await api.me();
      onUserChanged(refreshed.user);
      setThreshold(String(refreshed.user.defaultAlertThresholdPercent));
      setNotice({ type: "ok", message: result.message });
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? "Invalid JSON file"
          : error instanceof Error
            ? error.message
            : "Failed to import configuration";
      setNotice({ type: "error", message });
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <section className="install-panel">
      <div className="panel-head">
        <div>
          <div className="section-kicker">Install</div>
          <h2>Join Linux nodes</h2>
          <p>Run the generated command on each Linux host. The agent reports interface counters; this server owns policy and alerting.</p>
        </div>
        <span className="chip static">{user.email}</span>
      </div>
      <pre className="command">{joinCommand?.command || "Loading install command..."}</pre>
      <div className="button-row">
        <button className="btn btn-primary" onClick={copyCommand} disabled={!joinCommand}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy command"}
        </button>
        <button className="btn" onClick={rotateToken}>Rotate join token</button>
        <button className="btn" onClick={sendTestEmail}>Send test email</button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          style={{ display: "none" }}
        />
        <button
          className="btn"
          onClick={handleExportConfig}
          disabled={exportLoading || importLoading}
          title="Download account, join token, and host configurations as JSON"
        >
          <Download size={14} />
          {exportLoading ? "Exporting" : "Export config"}
        </button>
        <button
          className="btn"
          onClick={handleImportClick}
          disabled={exportLoading || importLoading}
          title="Restore a JSON backup so agents can reconnect after DNS switch"
        >
          <Upload size={14} />
          {importLoading ? "Importing" : "Import config"}
        </button>
      </div>
      <div className="field-grid account-grid">
        <label className="field">
          Default alert threshold (% remaining)
          <input value={threshold} onChange={(event) => setThreshold(event.target.value)} type="number" min="0" max="100" step="0.01" />
        </label>
        <div className="field action-field">
          <span>Account policy</span>
          <button className="btn" onClick={saveThreshold}>Save default</button>
        </div>
      </div>
      {joinCommand ? <p className="muted-line">Token preview: {joinCommand.tokenPreview}</p> : null}
      {notice ? <div className={`notice ${notice.type}`}>{notice.message}</div> : null}
    </section>
  );
}

function Sidebar({
  active,
  setActive,
  counts,
  user,
}: {
  active: string;
  setActive: (active: string) => void;
  counts: Record<string, number>;
  user: UserDto;
}) {
  const main = [
    { id: "overview", label: "Overview" },
    { id: "nodes", label: "Nodes", count: counts.total },
    { id: "alerts", label: "Alerts", count: counts.alerts, dot: "crit" },
    { id: "install", label: "Install" },
    { id: "audit", label: "Audit log" },
  ];
  const saved = [
    { id: "sv-crit", label: "Critical <= 10%", count: counts.critical },
    { id: "sv-exc", label: "Exceeded quota", count: counts.exceeded },
    { id: "sv-off", label: "Missing > 1h", count: counts.missing },
    { id: "sv-edge", label: "tag:egress", count: counts.egress },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">T</div>
        <div className="brand-name">Traffic Monitor<small>allowance metering</small></div>
      </div>
      <div className="nav-group">
        {main.map((item) => (
          <button key={item.id} className={`nav-item${active === item.id ? " active" : ""}`} onClick={() => setActive(item.id)}>
            <span>{item.dot ? <span className={`sdot ${item.dot}`} /> : null}{item.label}</span>
            {item.count !== undefined ? <span className="count num">{item.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="nav-group">
        <div className="nav-label">Saved filters</div>
        {saved.map((item) => (
          <button key={item.id} className={`nav-item${active === item.id ? " active" : ""}`} onClick={() => setActive(item.id)}>
            <span>{item.label}</span>
            <span className="count num">{item.count}</span>
          </button>
        ))}
      </div>
      <div className="nav-group">
        <div className="nav-label">Groups</div>
        <button className="nav-item" onClick={() => setActive("group-provider")}>By provider</button>
        <button className="nav-item" onClick={() => setActive("group-region")}>By country</button>
        <button className="nav-item" onClick={() => setActive("group-tag")}>By tag</button>
      </div>
      <div className="sidebar-footer">
        <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <div className="footer-name">{user.name}</div>
          <div className="footer-email">{user.email}</div>
        </div>
      </div>
    </aside>
  );
}

function KpiStrip({ nodes }: { nodes: NodeView[] }) {
  const totals = useMemo(() => {
    const totalAllowance = nodes.reduce((sum, node) => sum + node.trafficAllowanceBytes, 0);
    const totalUsed = nodes.reduce((sum, node) => sum + node.usedBytes, 0);
    const totalRemaining = nodes.reduce((sum, node) => sum + node.remainingBytes, 0);
    return {
      total: nodes.length,
      online: nodes.filter((node) => node.status !== "missing" && node.status !== "disabled").length,
      critical: nodes.filter((node) => node.status === "critical").length,
      exceeded: nodes.filter((node) => node.status === "exceeded").length,
      warning: nodes.filter((node) => node.status === "warning").length,
      totalAllowance,
      totalUsed,
      totalRemaining,
      rate: nodes.reduce((sum, node) => sum + node.recentRateMbps, 0),
      spark: nodes.reduce<number[]>((spark, node) => {
        node.spark.forEach((value, index) => {
          spark[index] = (spark[index] || 0) + value;
        });
        return spark;
      }, []),
    };
  }, [nodes]);
  const usedPct = totals.totalAllowance > 0 ? (totals.totalUsed / totals.totalAllowance) * 100 : 0;
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="kpi-label">Fleet</div>
        <div className="kpi-value num">{totals.online}<span className="unit">/ {totals.total} online</span></div>
        <div className="kpi-meta"><span className="sdot ok live" /> {totals.online} up · <span className="sdot off" /> {totals.total - totals.online} missing/disabled</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Fleet throughput</div>
        <div className="kpi-value num">{formatRate(totals.rate)}</div>
        <div className="kpi-meta"><Sparkline data={totals.spark} width={110} height={16} /></div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Total used</div>
        <div className="kpi-value num">{formatBytes(String(totals.totalUsed))}<span className="unit">/ {formatBytes(String(totals.totalAllowance))}</span></div>
        <div className="kpi-meta"><span className="num">{usedPct.toFixed(1)}%</span> used · {formatBytes(String(totals.totalRemaining))} remaining</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Critical</div>
        <div className="kpi-value num crit-text">{totals.critical + totals.exceeded}</div>
        <div className="kpi-meta"><span className="crit-text">{totals.exceeded} exceeded</span> · {totals.critical} near limit</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Warning</div>
        <div className="kpi-value num warn-text">{totals.warning}</div>
        <div className="kpi-meta">nodes below threshold</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Policy</div>
        <div className="kpi-value num">{nodes.filter((node) => node.host.meteringType === "INGRESS_AND_EGRESS").length}<span className="unit">in+out</span></div>
        <div className="kpi-meta">{nodes.filter((node) => node.host.meteringType === "EGRESS_ONLY").length} egress-only nodes</div>
      </div>
    </div>
  );
}

function Toolbar({
  q,
  setQ,
  filters,
  setFilters,
  groupBy,
  setGroupBy,
  density,
  setDensity,
  showSpark,
  setShowSpark,
  onRefresh,
}: {
  q: string;
  setQ: (q: string) => void;
  filters: { status: FleetStatus[]; tag: string[] };
  setFilters: (filters: { status: FleetStatus[]; tag: string[] }) => void;
  groupBy: GroupBy;
  setGroupBy: (groupBy: GroupBy) => void;
  density: Density;
  setDensity: (density: Density) => void;
  showSpark: boolean;
  setShowSpark: (showSpark: boolean) => void;
  onRefresh: () => void;
}) {
  function toggleStatus(value: FleetStatus) {
    const next = new Set(filters.status);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    setFilters({ ...filters, status: [...next] });
  }

  return (
    <div className="toolbar">
      <div className="search">
        <Search size={13} />
        <input placeholder="Search host, id, machine id, tag..." value={q} onChange={(event) => setQ(event.target.value)} />
        <span className="kbd">/</span>
      </div>
      {statusOptions.map((option) => (
        <button
          key={option.value}
          className={`chip${filters.status.includes(option.value) ? " active" : ""}`}
          onClick={() => toggleStatus(option.value)}
        >
          <span className={`sdot ${statusTone(option.value)}`} /> {option.label}
        </button>
      ))}
      <div className="divider-v" />
      <span className="toolbar-label">Group</span>
      <div className="seg">
        {(["none", "provider", "region", "tag", "status"] as GroupBy[]).map((value) => (
          <button key={value} className={groupBy === value ? "on" : ""} onClick={() => setGroupBy(value)}>
            {labelGroupBy(value)}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className="seg">
        {(["comfy", "compact", "ultra"] as Density[]).map((value) => (
          <button key={value} className={density === value ? "on" : ""} onClick={() => setDensity(value)}>
            {value}
          </button>
        ))}
      </div>
      <button className="chip" onClick={() => setShowSpark(!showSpark)}><SlidersHorizontal size={13} /> {showSpark ? "Sparklines" : "No sparks"}</button>
      <button className="icon-btn" onClick={onRefresh} aria-label="Refresh hosts"><RefreshCw size={14} /></button>
    </div>
  );
}

function HostTable({
  groups,
  groupBy,
  showSpark,
  sort,
  setSort,
  selectedId,
  setSelectedId,
}: {
  groups: Array<{ key: string; label: string; items: NodeView[] }>;
  groupBy: GroupBy;
  showSpark: boolean;
  sort: { key: SortKey; dir: "asc" | "desc" };
  setSort: (sort: { key: SortKey; dir: "asc" | "desc" }) => void;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
}) {
  const columns: Array<{ key: SortKey | "tags"; label: string; sortable?: boolean; align?: "right" }> = [
    { key: "status", label: "Status" },
    { key: "hostname", label: "Host" },
    { key: "publicIp", label: "Public IP" },
    { key: "region", label: "Country" },
    { key: "tags", label: "Tags", sortable: false },
    { key: "usedBytes", label: "Used", align: "right" },
    { key: "remainingBytes", label: "Remaining", align: "right" },
    { key: "trafficAllowanceBytes", label: "Allowance", align: "right" },
    { key: "usedPercent", label: "Usage" },
    ...(showSpark ? [{ key: "last24hBytes" as const, label: "24h" }] : []),
    { key: "recentRateMbps", label: "Rate", align: "right" },
    { key: "lastSeenSort", label: "Seen" },
  ];

  function clickSort(key: SortKey | "tags", sortable?: boolean) {
    if (sortable === false || key === "tags") {
      return;
    }
    setSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  }

  const allRows = groups.flatMap((group) => group.items);

  return (
    <div className="table-wrap">
      <table className="nodes">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={sort.key === column.key ? "sorted" : ""}
                style={{ textAlign: column.align || "left" }}
                onClick={() => clickSort(column.key, column.sortable)}
              >
                {column.label}<span className="arr">{sort.key === column.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <MemoGroupRows
              key={group.key}
              group={group}
              groupBy={groupBy}
              columns={columns.length}
              showSpark={showSpark}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
            />
          ))}
          {allRows.length === 0 ? (
            <tr><td colSpan={columns.length}><div className="empty">No nodes match the current filters.</div></td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function MemoGroupRows({
  group,
  groupBy,
  columns,
  showSpark,
  selectedId,
  setSelectedId,
}: {
  group: { key: string; label: string; items: NodeView[] };
  groupBy: GroupBy;
  columns: number;
  showSpark: boolean;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
}) {
  return (
    <>
      {groupBy !== "none" ? (
        <tr className="group-row">
          <td colSpan={columns}>
            {group.label}<span className="gcount">{group.items.length} nodes</span>
            <span className="gstats">
              {formatBytes(String(group.items.reduce((sum, node) => sum + node.usedBytes, 0)))} used · {formatBytes(String(group.items.reduce((sum, node) => sum + node.remainingBytes, 0)))} remaining
            </span>
          </td>
        </tr>
      ) : null}
      {group.items.map((node) => {
        const tone = statusTone(node.status);
        return (
          <tr key={node.id} className={selectedId === node.id ? "selected" : ""} onClick={() => setSelectedId(node.id)}>
            <td><StatusCell status={node.status} /></td>
            <td>
              <div className="host-cell">
                <span className="name">{node.title}</span>
                <span className="sub">{node.hostname} · {node.host.machineId || "no machine id"}</span>
              </div>
            </td>
            <td className="mono subtle">{node.publicIp || "—"}</td>
            <td className="mono subtle">{node.region}</td>
            <td>{node.tags.slice(0, 3).map((tag) => <span key={tag} className="tag">{tag}</span>)}</td>
            <td className="num right">{formatBytes(node.host.usedBytes)}</td>
            <td className={`num right ${tone}-text`}>{formatBytes(node.host.remainingBytes)}</td>
            <td className="num right subtle">{formatBytes(node.host.trafficAllowanceBytes)}</td>
            <td><UsageBar node={node} /></td>
            {showSpark ? <td><Sparkline data={node.spark} tone={tone} /></td> : null}
            <td className="num right subtle">{formatRate(node.recentRateMbps)}</td>
            <td className={`mono ${node.status === "missing" ? "crit-text" : "subtle"}`}>{relTime(node.host.lastSeenAt || node.host.lastReportAt)}</td>
          </tr>
        );
      })}
    </>
  );
}

function Inspector({
  node,
  userDefaultThreshold,
  samples,
  throughputSeries,
  onChanged,
  onDeleted,
  onToast,
  onClose,
}: {
  node: NodeView | null;
  userDefaultThreshold: number;
  samples: TrafficSampleDto[];
  throughputSeries: number[];
  onChanged: (host: HostDto) => void;
  onDeleted: (hostId: string) => void;
  onToast: (notice: NonNullable<Notice>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [allowanceGiB, setAllowanceGiB] = useState("0");
  const [meteringType, setMeteringType] = useState<HostDto["meteringType"]>("EGRESS_ONLY");
  const [resetPeriod, setResetPeriod] = useState<HostDto["resetPeriod"]>("MONTHLY");
  const [resetDayOfMonth, setResetDayOfMonth] = useState("1");
  const [resetDayOfWeek, setResetDayOfWeek] = useState("1");
  const [resetMonth, setResetMonth] = useState("1");
  const [resetHourUtc, setResetHourUtc] = useState("0");
  const [resetMinuteUtc, setResetMinuteUtc] = useState("0");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [pollInterval, setPollInterval] = useState("60");
  const [countryCodeOverride, setCountryCodeOverride] = useState("");
  const [remainingGiB, setRemainingGiB] = useState("0");
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [suppressing, setSuppressing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setTab("overview");
  }, [node?.id]);

  useEffect(() => {
    if (!node) {
      return;
    }
    const host = node.host;
    setName(host.name || "");
    setNotes(host.notes || "");
    setAllowanceGiB(bytesToGiB(host.trafficAllowanceBytes));
    setMeteringType(host.meteringType);
    setResetPeriod(host.resetPeriod);
    setResetDayOfMonth(String(host.resetDayOfMonth));
    setResetDayOfWeek(String(host.resetDayOfWeek));
    setResetMonth(String(host.resetMonth));
    setResetHourUtc(String(host.resetHourUtc));
    setResetMinuteUtc(String(host.resetMinuteUtc));
    setAlertThreshold(host.alertThresholdOverridePercent === null ? "" : String(host.alertThresholdOverridePercent));
    setPollInterval(String(host.pollIntervalSeconds));
    setCountryCodeOverride(host.countryCodeOverride || "");
    setRemainingGiB(bytesToGiB(host.remainingBytes));
    setNotice(null);
    setSuppressing(false);
    setDeleting(false);
  }, [node?.id]);

  if (!node) {
    return (
      <>
        <div className="drawer-backdrop" />
        <div className="drawer"><div className="empty">No node selected</div></div>
      </>
    );
  }

  async function saveConfig() {
    setSaving(true);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        name,
        notes,
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
        countryCodeOverride: countryCodeOverride.trim().toUpperCase(),
        remainingBytes: gibToBytes(remainingGiB),
      };

      const response = await api.updateHost(node!.id, {
        ...payload,
      });
      onChanged(response.host);
      setRemainingGiB(bytesToGiB(response.host.remainingBytes));
      onToast({ type: "ok", message: "Host configuration saved." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to save host" });
    } finally {
      setSaving(false);
    }
  }

  async function suppressTrafficAlert() {
    setSuppressing(true);
    try {
      const response = await api.suppressTrafficAlert(node!.id);
      onChanged(response.host);
      const targetPercent = response.host.trafficAlertSuppressedUntilUsedPercent;
      onToast({
        type: "ok",
        message: `Traffic alerts ignored until usage reaches ${
          targetPercent === null ? "the next 1% step" : `${targetPercent.toFixed(2)}%`
        } or the next reset.`,
      });
    } catch (error) {
      onToast({ type: "error", message: error instanceof Error ? error.message : "Failed to ignore traffic alert" });
    } finally {
      setSuppressing(false);
    }
  }

  async function deleteNode() {
    const label = node!.title;
    if (
      !confirm(
        `Delete ${label}? This permanently removes the node and its traffic history. If the agent is still running, reinstall it to join again.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const response = await api.deleteHost(node!.id);
      onDeleted(response.deletedHostId);
      onToast({ type: "ok", message: `Deleted ${label}.` });
    } catch (error) {
      onToast({ type: "error", message: error instanceof Error ? error.message : "Failed to delete node" });
      setDeleting(false);
    }
  }

  const tone = statusTone(node.status);
  const series = throughputSeries.length ? throughputSeries : bucketedBytesToMbps(node.spark);
  const historyRows = samples.slice(0, 8);
  const isTrafficAlertStatus = node.status === "warning" || node.status === "critical" || node.status === "exceeded";
  const trafficAlertSuppressed = isTrafficAlertStatus && node.host.trafficAlertSuppressed;
  const suppressionTarget =
    node.host.trafficAlertSuppressedUntilUsedPercent === null
      ? null
      : `${node.host.trafficAlertSuppressedUntilUsedPercent.toFixed(2)}%`;

  return (
    <>
      <div className="drawer-backdrop on" onClick={onClose} />
      <aside className="drawer on">
        <div className="drawer-head">
          <div>
            <div className="drawer-kicker">HOST · {node.provider} · {node.region}</div>
            <h2>{node.title}</h2>
            <div className="drawer-sub">{node.id} · {node.publicIp || "no public IP observed"}</div>
            <div className="tag-row">
              <StatusCell status={node.status} />
              {node.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
              <span className="tag">poll {node.host.pollIntervalSeconds}s</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close inspector"><X size={15} /></button>
        </div>
        <div className="drawer-tabs">
          {["overview", "settings", "history", "alerts"].map((value) => (
            <button key={value} className={tab === value ? "on" : ""} onClick={() => setTab(value)}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="drawer-body">
          {tab === "overview" ? (
            <>
              <div className="stat-grid">
                <div className="stat"><span>Remaining</span><strong className={`mono ${tone}-text`}>{formatBytes(node.host.remainingBytes)}</strong></div>
                <div className="stat"><span>Used</span><strong className="mono">{formatBytes(node.host.usedBytes)}</strong></div>
                <div className="stat"><span>Allowance</span><strong className="mono">{formatBytes(node.host.trafficAllowanceBytes)}</strong></div>
                <div className="stat"><span>Remaining %</span><strong className={`mono ${tone}-text`}>{node.remainingPercent === null ? "—" : `${node.remainingPercent.toFixed(2)}%`}</strong></div>
              </div>
              <div className="chart-wrap">
                <div className="chart-title"><h4>Throughput · 24h</h4><span className="mono">peak {formatRate(Math.max(...series, 0))}</span></div>
                <TimeSeries data={series} tone={tone} />
              </div>
              <div className="stat-grid two">
                <div className="stat"><span>Current rate</span><strong className="mono">{formatRate(node.recentRateMbps)}</strong></div>
                <div className="stat"><span>Metering</span><strong>{node.host.meteringType === "EGRESS_ONLY" ? "Egress only" : "Ingress + egress"}</strong></div>
              </div>
              <div className="section-h">Cycle</div>
              <div className="field-grid readonly-grid">
                <div className="field"><span>Period</span><strong>{node.cycle}</strong></div>
                <div className="field"><span>Started</span><strong className="mono">{shortDate(node.host.currentCycleStartedAt)}</strong></div>
                <div className="field"><span>Joined</span><strong className="mono">{shortDate(node.host.createdAt)}</strong></div>
                <div className="field"><span>Last seen</span><strong className="mono">{relTime(node.host.lastSeenAt || node.host.lastReportAt)}</strong></div>
              </div>
              <div className="section-h">Network</div>
              <div className="field-grid readonly-grid">
                <div className="field"><span>Public IP</span><strong className="mono">{node.publicIp || "—"}</strong></div>
                <div className="field"><span>Hostname</span><strong className="mono">{node.hostname}</strong></div>
                <div className="field field-full"><span>Machine ID</span><strong className="mono">{node.host.machineId || "—"}</strong></div>
              </div>
            </>
          ) : null}
          {tab === "settings" ? (
            <>
              <div className="section-h">Identity</div>
              <div className="field-grid">
                <label className="field">Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
                <div className="field"><span>Hostname</span><strong className="mono">{node.hostname}</strong></div>
                <div className="field"><span>Public IP</span><strong className="mono">{node.publicIp || "—"}</strong></div>
                <label className="field">Country override<input value={countryCodeOverride} onChange={(event) => setCountryCodeOverride(event.target.value.toUpperCase())} placeholder={node.host.countryCodeAuto || "Auto"} maxLength={2} /></label>
                <div className="field"><span>Auto country</span><strong className="mono">{node.host.countryCodeAuto || "—"}</strong></div>
                <label className="field field-full">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Optional" /></label>
              </div>
              <div className="section-h">Quota</div>
              <div className="field-grid">
                <label className="field">Allowance (GiB)<input value={allowanceGiB} onChange={(event) => setAllowanceGiB(event.target.value)} type="number" min="0" step="0.01" /></label>
                <label className="field">Remaining (GiB)<input value={remainingGiB} onChange={(event) => setRemainingGiB(event.target.value)} type="number" min="0" step="0.01" /></label>
                <label className="field">Metering<select value={meteringType} onChange={(event) => setMeteringType(event.target.value as HostDto["meteringType"])}><option value="EGRESS_ONLY">Egress only</option><option value="INGRESS_AND_EGRESS">Ingress + egress</option></select></label>
                <label className="field">Alert threshold (% remaining)<input value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value)} placeholder={`Default ${userDefaultThreshold}%`} type="number" min="0" max="100" step="0.01" /></label>
                <label className="field">Poll interval (s)<input value={pollInterval} onChange={(event) => setPollInterval(event.target.value)} type="number" min="10" max="3600" /></label>
              </div>
              <div className="section-h">Reset schedule</div>
              <div className="field-grid">
                <label className="field">Period<select value={resetPeriod} onChange={(event) => setResetPeriod(event.target.value as HostDto["resetPeriod"])}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label>
                {resetPeriod === "WEEKLY" ? (
                  <label className="field">Day of week<select value={resetDayOfWeek} onChange={(event) => setResetDayOfWeek(event.target.value)}>{weekDayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
                ) : null}
                {resetPeriod === "MONTHLY" || resetPeriod === "YEARLY" ? (
                  <label className="field">Day of month<input value={resetDayOfMonth} onChange={(event) => setResetDayOfMonth(event.target.value)} type="number" min="1" max="31" /></label>
                ) : null}
                {resetPeriod === "YEARLY" ? (
                  <label className="field">Month<input value={resetMonth} onChange={(event) => setResetMonth(event.target.value)} type="number" min="1" max="12" /></label>
                ) : null}
                <label className="field">Hour UTC<input value={resetHourUtc} onChange={(event) => setResetHourUtc(event.target.value)} type="number" min="0" max="23" /></label>
                <label className="field">Minute UTC<input value={resetMinuteUtc} onChange={(event) => setResetMinuteUtc(event.target.value)} type="number" min="0" max="59" /></label>
              </div>
              {notice ? <div className={`notice ${notice.type}`}>{notice.message}</div> : null}
            </>
          ) : null}
          {tab === "history" ? (
            <>
              <div className="chart-wrap">
                <div className="chart-title"><h4>Traffic samples</h4><span className="mono">{historyRows.length} recent</span></div>
                <TimeSeries data={series} tone={tone} />
              </div>
              <div className="section-h">Recent events</div>
              <div className="event-list">
                {historyRows.length ? historyRows.map((sample) => (
                  <div key={sample.id} className="event-row">
                    <span className="mono">{relTime(sample.observedAt)}</span>
                    <span className="sdot ok" />
                    <span>{sample.interface} · {formatBytes(sample.meteredBytes)} metered</span>
                  </div>
                )) : <div className="empty small-empty">No samples reported yet.</div>}
              </div>
            </>
          ) : null}
          {tab === "alerts" ? (
            <>
              <div className="section-h">Active alerts</div>
              {node.status === "active" ? (
                <div className="empty small-empty">No active alerts.</div>
              ) : (
                <div className={`alert-card${trafficAlertSuppressed ? " muted" : ""}`}>
                  <strong>
                    {trafficAlertSuppressed
                      ? "Traffic alert ignored"
                      : node.status === "missing"
                      ? "Node missing"
                      : node.status === "exceeded"
                        ? "Quota exceeded"
                        : node.status === "critical"
                          ? "Quota critical"
                          : "Attention required"}
                  </strong>
                  <span>
                    {node.status === "missing"
                      ? `Last contact was ${relTime(node.host.lastSeenAt || node.host.lastReportAt)}. Missing-node emails are sent separately and throttled to one every 3 hours.`
                      : trafficAlertSuppressed
                        ? `Traffic email alerts are ignored until usage reaches ${suppressionTarget || "the next 1% step"} or the next reset.`
                      : `Remaining traffic is ${node.remainingPercent === null ? "unknown" : `${node.remainingPercent.toFixed(2)}%`} with a ${node.host.alertThresholdPercent}% alert threshold.`}
                  </span>
                  {isTrafficAlertStatus ? (
                    <div className="button-row alert-actions">
                      {trafficAlertSuppressed ? (
                        <span className="chip static"><BellOff size={13} /> Ignored until {suppressionTarget || "next step"}</span>
                      ) : (
                        <button className="btn" onClick={suppressTrafficAlert} disabled={suppressing}>
                          <BellOff size={14} />
                          {suppressing ? "Updating..." : "I have switched traffic away"}
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className="drawer-actions">
          <button className="btn btn-danger" onClick={deleteNode} disabled={deleting || saving}>
            <Trash2 size={14} />
            {deleting ? "Deleting..." : "Delete node"}
          </button>
          {tab === "settings" ? (
            <button className="btn btn-primary" onClick={saveConfig} disabled={saving}><Save size={14} /> {saving ? "Saving..." : "Save config"}</button>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function getSortValue(node: NodeView, key: SortKey): string | number {
  if (key === "status") {
    return statusRank(node.status);
  }
  return node[key] ?? -1;
}

function Dashboard({ user, onUserChanged, onLogout }: { user: UserDto; onUserChanged: (user: UserDto) => void; onLogout: () => void }) {
  const [hosts, setHosts] = useState<HostDto[]>([]);
  const [samples, setSamples] = useState<TrafficSampleDto[]>([]);
  const [throughputSeries, setThroughputSeries] = useState<number[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [toast, setToast] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("nodes");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<{ status: FleetStatus[]; tag: string[] }>({ status: [], tag: [] });
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [density, setDensity] = useState<Density>("comfy");
  const [showSpark, setShowSpark] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "usedPercent", dir: "desc" });

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

  useEffect(() => {
    document.body.classList.remove("d-comfy", "d-compact", "d-ultra");
    document.body.classList.add(`d-${density}`);
  }, [density]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (active === "sv-crit") {
      setFilters({ status: ["critical"], tag: [] });
    } else if (active === "sv-exc") {
      setFilters({ status: ["exceeded"], tag: [] });
    } else if (active === "sv-off") {
      setFilters({ status: ["missing"], tag: [] });
    } else if (active === "sv-edge") {
      setFilters({ status: [], tag: ["egress"] });
    } else if (active === "alerts") {
      setFilters({ status: ["warning", "critical", "exceeded", "missing"], tag: [] });
    } else if (active === "group-provider") {
      setGroupBy("provider");
    } else if (active === "group-region") {
      setGroupBy("region");
    } else if (active === "group-tag") {
      setGroupBy("tag");
    }
  }, [active]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      }
      if (event.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!selectedId) {
      setSamples([]);
      setThroughputSeries([]);
      return () => {
        ignore = true;
      };
    }
    api.hostSamples(selectedId)
      .then((response) => {
        if (ignore) {
          return;
        }
        setSamples(response.samples);
        setThroughputSeries(response.throughputSeries || []);
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setSamples([]);
        setThroughputSeries([]);
      });
    return () => {
      ignore = true;
    };
  }, [selectedId]);

  function replaceHost(nextHost: HostDto) {
    setHosts((current) => current.map((host) => (host.id === nextHost.id ? nextHost : host)));
  }

  function removeHost(hostId: string) {
    setHosts((current) => current.filter((host) => host.id !== hostId));
    setSelectedId(null);
  }

  const nodes = useMemo(() => hosts.map(toNodeView), [hosts]);
  const selectedNode = nodes.find((node) => node.id === selectedId) || null;
  const counts = useMemo(
    () => ({
      total: nodes.length,
      alerts: nodes.filter((node) => ["warning", "critical", "exceeded", "missing"].includes(node.status)).length,
      critical: nodes.filter((node) => node.status === "critical").length,
      exceeded: nodes.filter((node) => node.status === "exceeded").length,
      missing: nodes.filter((node) => node.status === "missing").length,
      egress: nodes.filter((node) => node.tags.includes("egress")).length,
    }),
    [nodes],
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return nodes.filter((node) => {
      if (filters.status.length && !filters.status.includes(node.status)) {
        return false;
      }
      if (filters.tag.length && !filters.tag.some((tag) => node.tags.includes(tag))) {
        return false;
      }
      if (!query) {
        return true;
      }
      return `${node.title} ${node.hostname} ${node.publicIp} ${node.host.notes || ""} ${node.id} ${node.host.machineId || ""} ${node.provider} ${node.region} ${node.tags.join(" ")}`
        .toLowerCase()
        .includes(query);
    });
  }, [filters, nodes, q]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((left, right) => {
      const leftValue = getSortValue(left, sort.key);
      const rightValue = getSortValue(right, sort.key);
      const direction = sort.dir === "asc" ? 1 : -1;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    });
    return rows;
  }, [filtered, sort]);

  const groups = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: "All nodes", items: sorted }];
    }
    const grouped = new Map<string, NodeView[]>();
    for (const node of sorted) {
      const key = groupBy === "tag" ? node.tags[0] || "untagged" : groupBy === "status" ? node.status : String(node[groupBy]);
      grouped.set(key, [...(grouped.get(key) || []), node]);
    }
    return [...grouped.entries()]
      .sort((left, right) => right[1].length - left[1].length)
      .map(([key, items]) => ({ key, label: key, items }));
  }, [groupBy, sorted]);

  return (
    <div className="app">
      <Sidebar active={active} setActive={setActive} counts={counts} user={user} />
      <main className="main">
        <div className="topbar">
          <div className="breadcrumb"><span>Fleet</span><span className="sep">/</span><strong>{active === "install" ? "Install" : "Nodes"}</strong></div>
          <span className="chip static"><span className="sdot ok live" /> Live · updates every 30s</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setActive("install")}><TerminalSquare size={14} /> Install node</button>
          <button className="icon-btn" onClick={() => setActive("install")} aria-label="Account settings"><Settings size={14} /></button>
          <button className="btn" onClick={onLogout}><LogOut size={14} /> Log out</button>
        </div>
        <KpiStrip nodes={nodes} />
        {active === "install" ? (
          <div className="content-pad"><AccountPanel user={user} onUserChanged={onUserChanged} /></div>
        ) : (
          <>
            <Toolbar
              q={q}
              setQ={setQ}
              filters={filters}
              setFilters={setFilters}
              groupBy={groupBy}
              setGroupBy={setGroupBy}
              density={density}
              setDensity={setDensity}
              showSpark={showSpark}
              setShowSpark={setShowSpark}
              onRefresh={loadHosts}
            />
            {notice ? <div className={`notice page-notice ${notice.type}`}>{notice.message}</div> : null}
            {loading ? <div className="empty">Loading hosts...</div> : null}
            {!loading && hosts.length === 0 ? <div className="empty">No hosts have joined yet. Open Install and run the command on a Linux server.</div> : null}
            {!loading && hosts.length > 0 ? (
              <HostTable
                groups={groups}
                groupBy={groupBy}
                showSpark={showSpark}
                sort={sort}
                setSort={setSort}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
              />
            ) : null}
          </>
        )}
        <div className="statusbar">
          <span className="item"><span className="sdot ok live" /> agent protocol · poll median 60s</span>
          <span className="item">showing {sorted.length} of {nodes.length}</span>
          <span className="item">grouped by {groupBy}</span>
          <div className="spacer" />
          <span className="item mono">/ search</span>
          <span className="item mono">esc close</span>
        </div>
      </main>
      <Inspector
        node={selectedNode}
        userDefaultThreshold={user.defaultAlertThresholdPercent}
        samples={samples}
        throughputSeries={throughputSeries}
        onChanged={replaceHost}
        onDeleted={removeHost}
        onToast={setToast}
        onClose={() => setSelectedId(null)}
      />
      {toast ? <div className={`toast ${toast.type}`} role="status" aria-live="polite">{toast.message}</div> : null}
    </div>
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
    return <main className="auth-shell"><div className="auth-card">Loading...</div></main>;
  }

  if (!user) {
    return <AuthPage onAuthed={setUser} />;
  }

  return <Dashboard user={user} onUserChanged={setUser} onLogout={logout} />;
}
