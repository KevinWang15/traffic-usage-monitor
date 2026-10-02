import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Mail, Plus, RefreshCw, Save, Webhook } from "lucide-react";
import {
  WEBHOOK_METHODS,
  type NotificationHistoryEntry,
  type NotificationResult,
  type NotificationSettings,
  type WebhookMethod,
  type WebhookTarget,
} from "@shared/types/notifications";
import { api } from "./api";

type WebhookForm = {
  id?: string;
  name: string;
  enabled: boolean;
  url: string;
  method: WebhookMethod;
  headers: string;
  bodyTemplate: string;
};
const emptyForm: WebhookForm = {
  name: "",
  enabled: true,
  url: "",
  method: "POST",
  headers: "{}",
  bodyTemplate: "",
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

export function NotificationsPanel() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);
  const [tab, setTab] = useState<"targets" | "history">("targets");
  const [form, setForm] = useState<WebhookForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    const [settings, history] = await Promise.all([
      api.get<NotificationSettings>("/notifications/settings"),
      api.get<{ entries: NotificationHistoryEntry[] }>("/notifications/history?limit=50"),
    ]);
    return { settings, entries: history.entries };
  }, []);

  useEffect(() => {
    let active = true;
    void load()
      .then((data) => {
        if (active) {
          setSettings(data.settings);
          setEntries(data.entries);
        }
      })
      .catch((error) => {
        if (active) setNotice({ error: true, message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function act(action: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ error: false, message: await action() });
    } catch (error) {
      setNotice({ error: true, message: errorMessage(error) });
    } finally {
      try {
        const data = await load();
        setSettings(data.settings);
        setEntries(data.entries);
      } catch (error) {
        setNotice({ error: true, message: errorMessage(error) });
      }
      setBusy(false);
    }
  }

  function test(id?: string) {
    return act(async () => {
      const result = await api.post<NotificationResult>(
        id ? `/notifications/webhooks/${id}/test` : "/notifications/test",
      );
      const sent = result.deliveries.filter((item) => item.status === "SENT").length;
      const failed = result.deliveries.length - sent;
      return `Test delivered to ${sent} target${sent === 1 ? "" : "s"}.${failed ? ` ${failed} failed; see delivery history.` : ""}`;
    });
  }

  function saveWebhook(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    void act(async () => {
      let headers: unknown;
      try {
        headers = JSON.parse(form.headers);
      } catch {
        throw new Error("Headers must be a valid JSON object");
      }
      const payload = { ...form, headers, bodyTemplate: form.bodyTemplate || null };
      if (form.id) await api.put(`/notifications/webhooks/${form.id}`, payload);
      else await api.post("/notifications/webhooks", payload);
      setForm(null);
      return "Webhook saved.";
    });
  }

  function edit(target: WebhookTarget) {
    setNotice(null);
    setForm({
      ...target,
      headers: JSON.stringify(target.headers, null, 2),
      bodyTemplate: target.bodyTemplate ?? "",
    });
  }

  return (
    <section className="install-panel notifications-panel">
      <div className="panel-head">
        <div>
          <div className="section-kicker">Delivery</div>
          <h2>Notifications</h2>
          <p>Choose targets for traffic allowance and missing-node alerts.</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={busy || !settings}
          onClick={() => void test()}
        >
          {busy ? <RefreshCw size={14} /> : <Mail size={14} />} Send test to enabled targets
        </button>
      </div>
      <div className="button-row" role="tablist" aria-label="Notifications">
        <button
          className="btn"
          role="tab"
          aria-selected={tab === "targets"}
          onClick={() => setTab("targets")}
        >
          Targets
        </button>
        <button
          className="btn"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
        >
          Delivery history
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void act(async () => "Notifications refreshed.")}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {notice ? (
        <div role="status" className={`notice ${notice.error ? "error" : "ok"}`}>
          {notice.message}
        </div>
      ) : null}
      {tab === "targets" ? (
        <>
          {!settings ? (
            <p className="muted-line">Loading targets…</p>
          ) : (
            <>
              <div className="notification-card">
                <div className="notification-target-head">
                  <div>
                    <strong>
                      <Mail size={14} /> Email
                    </strong>
                    <p>{settings.email.address}</p>
                    <p className="muted-line">
                      Verification and password reset messages always use email.
                    </p>
                  </div>
                  <label className="notification-toggle">
                    <input
                      type="checkbox"
                      checked={settings.email.enabled}
                      disabled={busy}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        void act(async () => {
                          await api.put("/notifications/email", { enabled });
                          return `Email notifications ${enabled ? "enabled" : "disabled"}.`;
                        });
                      }}
                    />{" "}
                    Enabled
                  </label>
                </div>
              </div>
              {settings.webhooks.map((target) => (
                <div className="notification-card" key={target.id}>
                  <div className="notification-target-head">
                    <div>
                      <strong>
                        <Webhook size={14} /> {target.name}
                      </strong>
                      <p className="mono">
                        {target.method} · {target.url}
                      </p>
                    </div>
                    <label className="notification-toggle">
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        disabled={busy}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          void act(async () => {
                            await api.put(`/notifications/webhooks/${target.id}`, {
                              ...target,
                              enabled,
                            });
                            return "Webhook updated.";
                          });
                        }}
                      />{" "}
                      Enabled
                    </label>
                  </div>
                  <div className="button-row">
                    <button className="btn" disabled={busy} onClick={() => edit(target)}>
                      Edit
                    </button>
                    <button className="btn" disabled={busy} onClick={() => void test(target.id)}>
                      Send test
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api.delete(`/notifications/webhooks/${target.id}`);
                          if (form?.id === target.id) setForm(null);
                          return "Webhook removed.";
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {!settings.email.enabled && !settings.webhooks.some((target) => target.enabled) ? (
                <p className="muted-line">No targets are enabled for monitoring notifications.</p>
              ) : null}
              {!form ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setNotice(null);
                    setForm({ ...emptyForm });
                  }}
                >
                  <Plus size={14} /> Add webhook
                </button>
              ) : null}
            </>
          )}
          {form ? (
            <form onSubmit={saveWebhook} className="notification-card">
              <h3>{form.id ? "Edit webhook" : "Add webhook"}</h3>
              <fieldset disabled={busy} className="field-grid notification-form">
                <label className="field">
                  Name
                  <input
                    required
                    maxLength={191}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
                <label className="field">
                  HTTP method
                  <select
                    value={form.method}
                    onChange={(event) =>
                      setForm({ ...form, method: event.target.value as WebhookMethod })
                    }
                  >
                    {WEBHOOK_METHODS.map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                </label>
                <label className="field field-full">
                  URL
                  <input
                    required
                    type="url"
                    maxLength={2048}
                    value={form.url}
                    placeholder="https://example.com/webhook?message=$SHORT_TEXT"
                    onChange={(event) => setForm({ ...form, url: event.target.value })}
                  />
                </label>
                <label className="field field-full">
                  Headers (JSON object)
                  <textarea
                    rows={3}
                    value={form.headers}
                    maxLength={16384}
                    spellCheck={false}
                    onChange={(event) => setForm({ ...form, headers: event.target.value })}
                  />
                </label>
                {!["GET", "HEAD"].includes(form.method) ? (
                  <label className="field field-full">
                    Body template (optional)
                    <textarea
                      rows={4}
                      value={form.bodyTemplate}
                      maxLength={65535}
                      placeholder={'{"text":"$SHORT_TEXT"}'}
                      spellCheck={false}
                      onChange={(event) => setForm({ ...form, bodyTemplate: event.target.value })}
                    />
                  </label>
                ) : null}
                <p className="muted-line field-full">
                  Templates support $SUBJECT, $TEXT, $SHORT_TEXT, $HTML, $PURPOSE, $DETAILS, and
                  $TIMESTAMP in the URL, headers, and body. URL values are encoded automatically;
                  JSON string values are escaped automatically. Leave the body blank to send the
                  full notification as JSON. GET and HEAD send no body.
                </p>
                <label className="notification-toggle field-full">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                  />{" "}
                  Enabled
                </label>
                <div className="button-row field-full">
                  <button type="submit" className="btn btn-primary">
                    <Save size={14} /> Save webhook
                  </button>
                  <button type="button" className="btn" onClick={() => setForm(null)}>
                    Cancel
                  </button>
                </div>
              </fieldset>
            </form>
          ) : null}
        </>
      ) : (
        <div className="notification-history">
          {entries.length === 0 ? (
            <p className="muted-line">No delivery history.</p>
          ) : (
            entries.map((entry) => (
              <div className="notification-card" key={entry.id}>
                <div className="notification-target-head">
                  <strong>{entry.subject}</strong>
                  <span className="chip static">{entry.status}</span>
                </div>
                <p className="muted-line">
                  {new Date(entry.requestedAt).toLocaleString()} ·{" "}
                  {entry.channel === "EMAIL" ? "Email" : "Webhook"} · {entry.target} ·{" "}
                  {entry.purpose}
                </p>
                {entry.preview ? <p className="notification-preview">{entry.preview}</p> : null}
                {entry.error ? <p className="notification-error">{entry.error}</p> : null}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
