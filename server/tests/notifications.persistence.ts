import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("webhook settings and history persist across a production container restart", async () => {
  const report = JSON.parse(readFileSync("/artifacts/report.json", "utf8"));
  const base = process.env.APP_URL!;
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: report.email, password: report.password }),
  });
  assert.equal(response.status, 200);
  const { token } = (await response.json()) as any;
  const get = async (path: string) => {
    const response = await fetch(`${base}/api${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  assert.deepEqual(await get("/notifications/settings"), report.settings);
  assert.equal((await get("/notifications/history?limit=100")).entries.length, report.historyCount);
  const target = report.settings.webhooks[0];
  const sent = await fetch(`${base}/api/notifications/webhooks/${target.id}/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(sent.status, 200);
  assert.equal(((await sent.json()) as any).deliveries[0].status, "SENT");
});
