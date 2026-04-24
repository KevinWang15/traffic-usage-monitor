import type { Host, User } from "@prisma/client";
import prisma from "../prisma";
import { formatBytes } from "../lib/bytes";
import { sendEmail } from "../lib/email";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

type HostWithUser = Host & { user: User };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
