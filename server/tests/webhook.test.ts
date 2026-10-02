import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEBHOOK_METHODS } from "../../shared/types/notifications";
import { parseWebhookConfig, WebhookValidationError } from "../src/lib/webhook";
import {
  expandWebhookTemplate,
  isPublicWebhookAddress,
  renderWebhookBody,
  type WebhookPayload,
} from "../src/services/webhookService";

const payload: WebhookPayload = {
  app: "traffic-usage-monitor",
  purpose: "TRAFFIC_ALERT",
  subject: 'Node "東京" / edge?x=1&other=2#test + 50%',
  html: '<p>"Quoted" & text</p>',
  text: 'Line one\n"Line two" \\ end',
  shortText: "Traffic: 5% remaining",
  details: ["edge", "203.0.113.5"],
  requestedAt: "2026-10-02T00:00:00.000Z",
};
const config = (overrides: Record<string, unknown> = {}) => ({
  name: "Relay",
  url: "https://example.com/$PURPOSE?message=$TEXT",
  ...overrides,
});

describe("webhook templates", () => {
  it("encodes each substituted URL component without changing literal URL syntax", () => {
    const rendered = expandWebhookTemplate(
      "https://example.com/$SUBJECT?text=$TEXT&fixed=1&again=$SUBJECT",
      payload,
      true,
    );
    const url = new URL(rendered);
    assert.equal(url.pathname, `/${encodeURIComponent(payload.subject)}`);
    assert.equal(url.searchParams.get("text"), payload.text);
    assert.equal(url.searchParams.get("again"), payload.subject);
    assert.equal(url.searchParams.get("fixed"), "1");
    assert.equal(url.hash, "");
    assert.equal([...url.searchParams].length, 3);
  });
  it("preserves JSON quotes, newlines, backslashes, and nested string values", () => {
    const body = renderWebhookBody(
      '{"subject":"$SUBJECT","nested":[{"text":"$TEXT"}],"number":5}',
      payload,
    );
    assert.deepEqual(JSON.parse(body), {
      subject: payload.subject,
      nested: [{ text: payload.text }],
      number: 5,
    });
    assert.deepEqual(JSON.parse(renderWebhookBody(null, payload)), payload);
  });
  it("expands raw text once and preserves unknown placeholders", () => {
    assert.equal(
      expandWebhookTemplate("$PURPOSE $DETAILS $TIMESTAMP $UNKNOWN $SUBJECT_extra", payload),
      `TRAFFIC_ALERT edge, 203.0.113.5 ${payload.requestedAt} $UNKNOWN $SUBJECT_extra`,
    );
    assert.equal(renderWebhookBody("$TEXT", payload), payload.text);
    assert.equal(expandWebhookTemplate("$SUBJECT", { ...payload, subject: "$TEXT" }), "$TEXT");
  });
});

describe("webhook validation", () => {
  it("supports all configured methods and normalizes header names", () => {
    for (const method of WEBHOOK_METHODS)
      assert.equal(parseWebhookConfig(config({ method })).method, method);
    assert.deepEqual(
      parseWebhookConfig(config({ headers: { Authorization: "Bearer token" } })).headers,
      { authorization: "Bearer token" },
    );
    assert.equal(parseWebhookConfig(config()).method, "POST");
  });
  it("rejects malformed destinations and unsafe headers", () => {
    for (const overrides of [
      { method: "TRACE" },
      { enabled: "true" },
      { url: "file:///etc/passwd" },
      { url: "https://user:pass@example.com" },
      { url: "https://example.com/#fragment" },
      { headers: { Host: "localhost" } },
      { headers: { "X-Header": "first\r\nInjected: second" } },
      { headers: { "X-Header": "one", "x-header": "two" } },
      { headers: { nested: {} } },
      { bodyTemplate: "界".repeat(22000) },
    ])
      assert.throws(() => parseWebhookConfig(config(overrides)), WebhookValidationError);
  });
  it("blocks private and reserved addresses across IPv4 and IPv6", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "203.0.113.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "2001:db8::1",
    ])
      assert.equal(isPublicWebhookAddress(address), false, address);
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
      assert.equal(isPublicWebhookAddress(address), true, address);
  });
});
