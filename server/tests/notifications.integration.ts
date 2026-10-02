import assert from "node:assert/strict";
import { after, test } from "node:test";
import { writeFileSync } from "node:fs";
import prisma from "../src/prisma";
import { runResetSweep } from "../src/services/resetScheduler";
import { maybeSendMissingHostAlert, maybeSendTrafficAlert } from "../src/services/alerts";
import { sendWebhook } from "../src/services/webhookService";

const base = process.env.APP_URL!;
const emailBase = process.env.EMAIL_URL!;
const webhookBase = process.env.WEBHOOK_URL!;
assert.equal(
  new URL(process.env.DATABASE_URL!).pathname,
  "/traffic_notifications",
  "Use the dedicated container test database",
);
assert.equal(new URL(base).hostname, "app", "Run through tests/containers/run.sh");
const password = "container-test-password-only";
let owner: { id: string; email: string; token: string; joinToken: string };
let stranger: typeof owner;
const completed: string[] = [];

async function request(path: string, method = "GET", body?: unknown, account = owner) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as any;
  return { status: res.status, data };
}
async function ok(path: string, method = "GET", body?: unknown, account = owner, status = 200) {
  const result = await request(path, method, body, account);
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}
async function mockRequests(service = webhookBase) {
  return ((await (await fetch(`${service}/__admin/requests`)).json()) as any).requests as any[];
}
async function mockState(service: string, status: number) {
  await fetch(`${service}/__admin/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
async function createAccount(label: string) {
  const email = `${label}-${Date.now()}@example.test`;
  await ok(
    "/auth/signup",
    "POST",
    { email, password, name: 'Container "東京" & User' },
    undefined,
    201,
  );
  const sent = (await mockRequests(emailBase)).find((item) => item.body.to.includes(email));
  assert.ok(sent, "Signup used mock HTTPS email provider");
  const html: string = sent.body.body.content.html;
  const link = html.match(/href="([^"]*verify-email[^"]*)"/)![1];
  const { token, user } = await ok(
    "/auth/verify-email",
    "POST",
    { token: new URL(link).searchParams.get("token") },
    undefined,
  );
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  return { id: user.id, email, token, joinToken: record.joinToken };
}
const config = (overrides: any = {}) => ({
  name: "Relay",
  enabled: true,
  url: `${webhookBase}/ok`,
  method: "POST",
  headers: {},
  bodyTemplate: null,
  ...overrides,
});
async function createTarget(overrides: any = {}) {
  return (await ok("/notifications/webhooks", "POST", config(overrides), owner, 201)).webhook;
}
async function clearTargets() {
  await prisma.webhookTarget.deleteMany({ where: { userId: owner.id } });
}
async function emailEnabled(enabled: boolean) {
  await ok("/notifications/email", "PUT", { enabled });
}
async function hostRecord(id: string) {
  return prisma.host.findUniqueOrThrow({ where: { id }, include: { user: true } });
}
async function newHost(name: string) {
  const res = await fetch(`${base}/api/agent/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.joinToken}` },
    body: JSON.stringify({
      hostname: `${name}.example.test`,
      name,
      machineId: `${name}-${Date.now()}`,
      publicIp: "203.0.113.25",
      bootId: "boot-test",
    }),
  });
  assert.equal(res.status, 200);
  const agent = (await res.json()) as any;
  await ok(`/hosts/${agent.agentId}`, "PATCH", {
    trafficAllowanceBytes: "1000",
    notes: 'Host notes: "quoted"\nline two & 東京',
  });
  const report = async (txBytes: number) => {
    const res = await fetch(`${base}/api/agent/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agent.agentKey}`,
        "X-Agent-Id": agent.agentId,
      },
      body: JSON.stringify({
        host: { bootId: "boot-test", publicIp: "203.0.113.25" },
        interfaces: [{ name: "eth0", rxBytes: "0", txBytes: String(txBytes) }],
      }),
    });
    assert.equal(res.status, 200, await res.text());
  };
  return { id: agent.agentId as string, report };
}
after(async () => prisma.$disconnect());

test("webhook notification container integration", async (t) => {
  for (const service of [emailBase, webhookBase])
    await fetch(`${service}/__admin/reset`, { method: "POST" });
  owner = await createAccount("owner");
  stranger = await createAccount("stranger");
  const check = async (name: string, run: () => Promise<void>) => {
    await t.test(name, async () => {
      await run();
      completed.push(name);
    });
  };

  await check("defaults, validation, account isolation and target CRUD", async () => {
    assert.equal((await fetch(`${base}/api/notifications/settings`)).status, 401);
    assert.deepEqual(await ok("/notifications/settings"), {
      email: { address: owner.email, enabled: true },
      webhooks: [],
    });
    const target = await createTarget();
    for (const [method, suffix, body] of [
      ["PUT", "", config()],
      ["DELETE", "", undefined],
      ["POST", "/test", undefined],
    ] as const)
      assert.equal(
        (await request(`/notifications/webhooks/${target.id}${suffix}`, method, body, stranger))
          .status,
        404,
      );
    assert.deepEqual(
      (await ok("/notifications/settings", "GET", undefined, stranger)).webhooks,
      [],
    );
    assert.equal((await request("/notifications/email", "PUT", { enabled: "false" })).status, 400);
    for (const override of [
      { url: "ftp://example.test" },
      { method: "TRACE" },
      { headers: { Host: "other" } },
      { headers: { "X-Test": "line\r\nnext" } },
      { bodyTemplate: "界".repeat(22000) },
    ])
      assert.equal(
        (await request("/notifications/webhooks", "POST", config(override))).status,
        400,
      );
    await ok(
      `/notifications/webhooks/${target.id}`,
      "PUT",
      config({ name: "Updated", enabled: false }),
    );
    assert.equal((await ok("/notifications/settings")).webhooks[0].name, "Updated");
    await ok(`/notifications/webhooks/${target.id}`, "DELETE");
    assert.equal((await request(`/notifications/webhooks/${target.id}/test`, "POST")).status, 404);
  });

  await check(
    "GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS; URL, header and JSON substitution",
    async () => {
      await emailEnabled(false);
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        const target = await createTarget({
          name: method,
          method,
          url: `${webhookBase}/receive/$PURPOSE?subject=$SUBJECT&text=$TEXT&html=$HTML&short=$SHORT_TEXT&details=$DETAILS&at=$TIMESTAMP&fixed=yes`,
          headers: { "X-Purpose": "$PURPOSE", "X-Subject": "$SUBJECT" },
          bodyTemplate:
            '{"subject":"$SUBJECT","nested":{"text":"$TEXT","html":"$HTML"},"short":"$SHORT_TEXT","purpose":"$PURPOSE","details":"$DETAILS","at":"$TIMESTAMP"}',
        });
        const before = (await mockRequests()).length;
        const result = await ok(`/notifications/webhooks/${target.id}/test`, "POST");
        assert.equal(result.deliveries.length, 1);
        assert.equal(result.deliveries[0].status, "SENT");
        const received = (await mockRequests())[before];
        assert.equal(received.method, method);
        const url = new URL(received.url, webhookBase);
        assert.equal(url.pathname, "/receive/TEST");
        assert.equal(url.searchParams.get("fixed"), "yes");
        assert.equal([...url.searchParams].length, 7);
        assert.match(url.searchParams.get("text")!, /"東京" & User,\n/);
        assert.equal(received.headers["x-purpose"], "TEST");
        assert.equal(received.headers["x-subject"], url.searchParams.get("subject"));
        if (["GET", "HEAD"].includes(method)) assert.equal(received.rawBody, "");
        else {
          assert.equal(received.body.nested.text, url.searchParams.get("text"));
          assert.equal(received.body.nested.html, url.searchParams.get("html"));
          assert.equal(received.body.subject, url.searchParams.get("subject"));
          assert.equal(received.body.short, url.searchParams.get("short"));
          assert.equal(received.body.at, url.searchParams.get("at"));
          assert.equal(received.headers["content-type"], "application/json");
        }
        await ok(`/notifications/webhooks/${target.id}`, "DELETE");
      }
      const plain = await createTarget({
        bodyTemplate: "$TEXT",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
      await ok(`/notifications/webhooks/${plain.id}/test`, "POST");
      assert.match((await mockRequests()).at(-1).rawBody, /"東京" & User,\n/);
      await clearTargets();
      const defaultTarget = await createTarget();
      await ok(`/notifications/webhooks/${defaultTarget.id}/test`, "POST");
      const body = (await mockRequests()).at(-1).body;
      assert.equal(body.app, "traffic-usage-monitor");
      assert.equal(body.purpose, "TEST");
      assert.ok(body.text && body.html && body.shortText && body.requestedAt);
    },
  );

  await check(
    "enabled targets, explicit tests of disabled targets and email-only legacy test",
    async () => {
      await clearTargets();
      const disabled = await createTarget({ enabled: false });
      assert.equal((await request("/notifications/test", "POST")).status, 502);
      await ok(`/notifications/webhooks/${disabled.id}/test`, "POST");
      await emailEnabled(true);
      const before = (await mockRequests()).length;
      const result = await ok("/notifications/test", "POST");
      assert.deepEqual(
        result.deliveries.map((d: any) => d.channel),
        ["EMAIL"],
      );
      assert.equal((await mockRequests()).length, before);
      await emailEnabled(false);
      await ok("/account/test-email", "POST");
      assert.equal((await ok("/notifications/history")).entries[0].channel, "EMAIL");
    },
  );

  await check(
    "partial failures, all failures, redirects and ten-second deadline are recorded",
    async () => {
      await clearTargets();
      await emailEnabled(true);
      await mockState(emailBase, 503);
      await createTarget({ name: "Good" });
      const failed = await createTarget({
        name: "Fail",
        url: `${webhookBase}/fail?secret=never-store-me`,
      });
      const result = await ok("/notifications/test", "POST");
      assert.equal(result.deliveries.filter((d: any) => d.status === "SENT").length, 1);
      assert.equal(result.deliveries.filter((d: any) => d.status === "FAILED").length, 2);
      assert.equal(
        (await request(`/notifications/webhooks/${failed.id}/test`, "POST")).status,
        502,
      );
      const redirect = await createTarget({ name: "Redirect", url: `${webhookBase}/redirect` });
      const before = (await mockRequests()).length;
      assert.equal(
        (await request(`/notifications/webhooks/${redirect.id}/test`, "POST")).status,
        502,
      );
      assert.equal((await mockRequests()).length, before + 1);
      const slow = await createTarget({ name: "Slow", url: `${webhookBase}/slow` });
      const start = Date.now();
      assert.equal((await request(`/notifications/webhooks/${slow.id}/test`, "POST")).status, 502);
      assert.ok(Date.now() - start >= 9000 && Date.now() - start < 14000);
      const history = (await ok("/notifications/history?limit=100")).entries;
      assert.ok(
        history.some((e: any) => e.status === "FAILED" && e.error === "Webhook returned HTTP 503"),
      );
      assert.ok(
        history.some((e: any) => e.status === "FAILED" && e.error === "Webhook returned HTTP 302"),
      );
      assert.ok(!JSON.stringify(history).includes("never-store-me"));
      assert.ok(!JSON.stringify(history).includes("container-email-key"));
      assert.equal(
        (await ok("/notifications/history", "GET", undefined, stranger)).entries.length,
        0,
      );
      await mockState(emailBase, 200);
      await emailEnabled(false);
      await clearTargets();
    },
  );

  await check(
    "private literal IPs and private DNS destinations are blocked by default",
    async () => {
      const target = await createTarget();
      const stored = await prisma.webhookTarget.findUniqueOrThrow({ where: { id: target.id } });
      const payload = {
        app: "traffic-usage-monitor" as const,
        purpose: "TEST" as const,
        subject: "Test",
        html: "",
        text: "",
        shortText: "",
        details: null,
        requestedAt: new Date().toISOString(),
      };
      const before = (await mockRequests()).length;
      process.env.WEBHOOK_ALLOW_PRIVATE_IPS = "false";
      try {
        for (const url of [
          "http://127.0.0.1/",
          "http://[::1]/",
          "http://169.254.169.254/",
          `${webhookBase}/blocked`,
        ])
          await assert.rejects(
            sendWebhook({ ...stored, url }, payload),
            /private or reserved|ENOTFOUND/,
          );
      } finally {
        process.env.WEBHOOK_ALLOW_PRIVATE_IPS = "true";
      }
      assert.equal((await mockRequests()).length, before);
    },
  );

  await check(
    "real agent traffic alert includes host details, then respects cooldown and suppression",
    async () => {
      await clearTargets();
      await createTarget({ name: "Traffic receiver" });
      const host = await newHost("traffic-node");
      await host.report(0);
      const before = (await mockRequests()).length;
      await host.report(905);
      const received = (await mockRequests())[before].body;
      assert.equal(received.purpose, "TRAFFIC_ALERT");
      assert.match(received.text, /9.50%/);
      assert.match(received.text, /203.0.113.25/);
      assert.match(received.text, /"quoted"\nline two & 東京/);
      assert.match(received.html, /&quot;quoted&quot;/);
      assert.deepEqual(received.details, [
        "traffic-node",
        "traffic-node.example.test",
        "203.0.113.25",
      ]);
      await host.report(906);
      assert.equal((await mockRequests()).length, before + 1);
      assert.ok((await hostRecord(host.id)).lastAlertSentAt);
      assert.equal(
        await prisma.alertEvent.count({ where: { hostId: host.id, status: "SENT" } }),
        1,
      );
      await ok(`/hosts/${host.id}/suppress-traffic-alert`, "POST");
      await prisma.host.update({ where: { id: host.id }, data: { lastAlertSentAt: null } });
      await host.report(910);
      assert.equal((await mockRequests()).length, before + 1);
      await host.report(916);
      assert.equal((await mockRequests()).length, before + 2);
    },
  );

  await check(
    "all-failed and no-target traffic alerts do not advance the successful cooldown",
    async () => {
      await clearTargets();
      const host = await newHost("retry-node");
      await ok(`/hosts/${host.id}/correct-remaining`, "POST", { remainingBytes: "50" });
      const before = (await mockRequests()).length;
      await host.report(0);
      assert.equal(await prisma.alertEvent.count({ where: { hostId: host.id } }), 0);
      assert.equal((await mockRequests()).length, before);
      await createTarget({ url: `${webhookBase}/fail` });
      await host.report(1);
      assert.equal(
        await prisma.alertEvent.count({ where: { hostId: host.id, status: "ERROR" } }),
        1,
      );
      assert.equal((await hostRecord(host.id)).lastAlertSentAt, null);
      await clearTargets();
      await createTarget({ name: "Recovery receiver" });
      await host.report(2);
      assert.equal(
        await prisma.alertEvent.count({ where: { hostId: host.id, status: "SENT" } }),
        1,
      );
      assert.ok((await hostRecord(host.id)).lastAlertSentAt);
    },
  );

  await check(
    "missing-node sweep, separate cooldown, mute, no targets and failed delivery throttle",
    async () => {
      const host = await newHost("missing-node");
      await prisma.host.update({
        where: { id: host.id },
        data: { lastSeenAt: new Date(Date.now() - 2 * 3600000) },
      });
      const before = (await mockRequests()).length;
      await runResetSweep();
      const received = (await mockRequests())[before].body;
      assert.equal(received.purpose, "MISSING_HOST");
      assert.match(received.text, /Last contact:/);
      assert.match(received.text, /203.0.113.25/);
      assert.equal((await hostRecord(host.id)).status, "STALE");
      await runResetSweep();
      assert.equal((await mockRequests()).length, before + 1);
      await ok(`/hosts/${host.id}/suppress-missing-alert`, "POST");
      await maybeSendMissingHostAlert(
        await hostRecord(host.id),
        new Date(Date.now() + 4 * 3600000),
      );
      assert.equal((await mockRequests()).length, before + 1);
      await host.report(0);
      assert.equal((await hostRecord(host.id)).missingAlertSuppressedAt, null);
      assert.equal((await hostRecord(host.id)).status, "ACTIVE");
      const failure = await newHost("missing-failure");
      await clearTargets();
      await maybeSendMissingHostAlert(await hostRecord(failure.id));
      assert.equal(await prisma.alertEvent.count({ where: { hostId: failure.id } }), 0);
      await createTarget({ url: `${webhookBase}/fail` });
      await maybeSendMissingHostAlert(await hostRecord(failure.id));
      const count = (await mockRequests()).length;
      await maybeSendMissingHostAlert(await hostRecord(failure.id));
      assert.equal((await mockRequests()).length, count);
      assert.equal(
        await prisma.alertEvent.count({ where: { hostId: failure.id, status: "MISSING_ERROR" } }),
        1,
      );
      // Existing traffic suppression also returns before notification work.
      const current = await hostRecord(failure.id);
      await maybeSendTrafficAlert({
        ...current,
        remainingBytes: 50n,
        trafficAlertSuppressedUntilUsedBytes: 1000n,
      });
      assert.equal((await mockRequests()).length, count);
    },
  );

  await check(
    "backup round-trip and old-format compatibility; auth mail remains enabled",
    async () => {
      await clearTargets();
      await createTarget({
        name: "Persistent relay",
        method: "PUT",
        url: `${webhookBase}/persistent?message=$SHORT_TEXT`,
        headers: { "X-Test": "$PURPOSE" },
        bodyTemplate: '{"text":"$TEXT"}',
      });
      const exported = await ok("/config/export");
      assert.equal(exported.user.notificationEmailEnabled, false);
      assert.equal(exported.webhooks.length, 1);
      const before = (await ok("/notifications/settings")).webhooks[0].id;
      await ok("/config/import", "POST", exported);
      const settings = await ok("/notifications/settings");
      assert.equal(settings.email.enabled, false);
      assert.equal(settings.webhooks[0].name, "Persistent relay");
      assert.notEqual(settings.webhooks[0].id, before);
      const old = structuredClone(exported);
      delete old.webhooks;
      delete old.user.notificationEmailEnabled;
      await ok("/config/import", "POST", old);
      assert.deepEqual(await ok("/notifications/settings"), settings);
      const invalid = structuredClone(exported);
      invalid.webhooks[0].method = "TRACE";
      assert.equal((await request("/config/import", "POST", invalid)).status, 400);
      assert.deepEqual(await ok("/notifications/settings"), settings);
      const count = (await mockRequests(emailBase)).length;
      await ok("/auth/forgot-password", "POST", { email: owner.email });
      assert.equal((await mockRequests(emailBase)).length, count + 1);
      assert.match((await mockRequests(emailBase)).at(-1).body.body.subject, /Reset/);
      assert.ok((await ok("/notifications/history?limit=100")).entries.length > 10);
      await ok(`/notifications/webhooks/${settings.webhooks[0].id}/test`, "POST");
      assert.equal(completed.length, 8, "All preceding container checks must pass");
      writeFileSync(
        "/artifacts/report.json",
        JSON.stringify(
          {
            status: "PASS",
            completed: [
              ...completed,
              "backup round-trip and old-format compatibility; auth mail remains enabled",
            ],
            email: owner.email,
            password,
            userId: owner.id,
            settings,
            historyCount: await prisma.notificationLog.count({ where: { userId: owner.id } }),
            appUrl: process.env.PUBLIC_URL,
          },
          null,
          2,
        ),
      );
    },
  );
});
