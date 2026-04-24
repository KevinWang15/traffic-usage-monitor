import type { Host, User } from "@prisma/client";
import prisma from "../prisma";
import { formatBytes } from "../lib/bytes";
import { sendEmail } from "../lib/email";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
export const MISSING_ALERT_SENT_STATUS = "MISSING_SENT";
export const MISSING_ALERT_ERROR_STATUS = "MISSING_ERROR";

type HostWithUser = Host & { user: User };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hostNotesHtml(host: Host): string {
  const notes = host.notes?.trim();
  if (!notes) {
    return "";
  }
  return `<p><strong>Host notes:</strong><br>${escapeHtml(notes).replace(/\r?\n/g, "<br>")}</p>`;
}

export async function maybeSendTrafficAlert(host: HostWithUser): Promise<void> {
  if (host.trafficAllowanceBytes <= 0n) {
    return;
  }

  const thresholdBasisPoints = host.alertThresholdBasisPts ?? host.user.defaultAlertThresholdBasisPts;
  if (thresholdBasisPoints <= 0) {
    return;
  }

  const remainingBasisPoints = Number((host.remainingBytes * 10000n) / host.trafficAllowanceBytes);
  if (remainingBasisPoints > thresholdBasisPoints) {
    return;
  }

  const now = new Date();
  if (host.lastAlertSentAt && now.getTime() - host.lastAlertSentAt.getTime() < THREE_HOURS_MS) {
    return;
  }

  const hostLabel = host.name || host.hostname;
  const remainingPercent = (remainingBasisPoints / 100).toFixed(2);
  const thresholdPercent = (thresholdBasisPoints / 100).toFixed(2);
  const subject = `Traffic allowance alert: ${hostLabel} has ${remainingPercent}% remaining`;
  const html = `
    <h2>Traffic allowance alert</h2>
    <p>Host <strong>${escapeHtml(hostLabel)}</strong> is below its alert threshold.</p>
    <ul>
      <li>Remaining: <strong>${formatBytes(host.remainingBytes)}</strong> (${remainingPercent}%)</li>
      <li>Allowance: ${formatBytes(host.trafficAllowanceBytes)}</li>
      <li>Threshold: ${thresholdPercent}%</li>
      <li>Metering: ${escapeHtml(host.meteringType)}</li>
      <li>Cycle: ${escapeHtml(host.currentCycleId || "not initialized")}</li>
    </ul>
    ${hostNotesHtml(host)}
    <p>Alerts for this host are throttled to at most one email every 3 hours.</p>
  `;

  try {
    await sendEmail({ to: host.user.email, subject, html });
    await prisma.$transaction([
      prisma.alertEvent.create({
        data: {
          hostId: host.id,
          userId: host.userId,
          remainingBytes: host.remainingBytes,
          allowanceBytes: host.trafficAllowanceBytes,
          thresholdBasisPts: thresholdBasisPoints,
          status: "SENT",
        },
      }),
      prisma.host.update({
        where: { id: host.id },
        data: {
          lastAlertSentAt: now,
          lastAlertCycleId: host.currentCycleId,
        },
      }),
    ]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to send traffic alert for host ${host.id}: ${errorMessage}`);
    await prisma.alertEvent.create({
      data: {
        hostId: host.id,
        userId: host.userId,
        remainingBytes: host.remainingBytes,
        allowanceBytes: host.trafficAllowanceBytes,
        thresholdBasisPts: thresholdBasisPoints,
        status: "ERROR",
        errorMessage,
      },
    });
  }
}

export async function maybeSendMissingHostAlert(host: HostWithUser, now = new Date()): Promise<void> {
  const lastContactAt = host.lastSeenAt ?? host.lastReportAt ?? host.joinedAt ?? host.createdAt;
  const recentMissingAlert = await prisma.alertEvent.findFirst({
    where: {
      hostId: host.id,
      status: { in: [MISSING_ALERT_SENT_STATUS, MISSING_ALERT_ERROR_STATUS] },
      createdAt: { gte: new Date(now.getTime() - THREE_HOURS_MS) },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentMissingAlert) {
    return;
  }

  const hostLabel = host.name || host.hostname;
  const lastContactText = lastContactAt ? lastContactAt.toISOString() : "never";
  const subject = `Node missing: ${hostLabel} has not reported`;
  const html = `
    <h2>Node missing</h2>
    <p>Host <strong>${escapeHtml(hostLabel)}</strong> has not reported within the missing-node grace period.</p>
    <ul>
      <li>Last contact: <strong>${escapeHtml(lastContactText)}</strong></li>
      <li>Hostname: ${escapeHtml(host.hostname)}</li>
      <li>Machine ID: ${escapeHtml(host.machineId || "unknown")}</li>
      <li>Poll interval: ${host.pollIntervalSeconds} seconds</li>
    </ul>
    ${hostNotesHtml(host)}
    <p>This alert is separate from traffic allowance alerts and is throttled to at most one email every 3 hours per host.</p>
  `;

  try {
    await sendEmail({ to: host.user.email, subject, html });
    await prisma.alertEvent.create({
      data: {
        hostId: host.id,
        userId: host.userId,
        remainingBytes: host.remainingBytes,
        allowanceBytes: host.trafficAllowanceBytes,
        thresholdBasisPts: 0,
        status: MISSING_ALERT_SENT_STATUS,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to send missing-node alert for host ${host.id}: ${errorMessage}`);
    await prisma.alertEvent.create({
      data: {
        hostId: host.id,
        userId: host.userId,
        remainingBytes: host.remainingBytes,
        allowanceBytes: host.trafficAllowanceBytes,
        thresholdBasisPts: 0,
        status: MISSING_ALERT_ERROR_STATUS,
        errorMessage,
      },
    });
  }
}
