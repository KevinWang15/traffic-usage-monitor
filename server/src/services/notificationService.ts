import type { WebhookTarget } from "@prisma/client";
import type { NotificationDelivery, NotificationPurpose } from "@shared/types/notifications";
import prisma from "../prisma";
import { sendEmail, type EmailPayload } from "../lib/email";
import { sendTrackedWebhook, type WebhookPayload } from "./webhookService";

export interface NotificationPayload extends EmailPayload {
  userId: string;
  purpose: NotificationPurpose;
  text: string;
  shortText: string;
  details?: string[] | string | null;
}

export function buildWebhookPayload(
  payload: NotificationPayload,
  requestedAt: Date,
): WebhookPayload {
  return {
    app: "traffic-usage-monitor",
    purpose: payload.purpose,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    shortText: payload.shortText,
    details: payload.details ?? null,
    requestedAt: requestedAt.toISOString(),
  };
}

export async function sendTrackedEmail(payload: NotificationPayload, requestedAt: Date) {
  const log = await prisma.notificationLog.create({
    data: {
      userId: payload.userId,
      channel: "EMAIL",
      target: payload.to,
      purpose: payload.purpose,
      subject: payload.subject,
      preview: payload.shortText.slice(0, 500),
      requestedAt,
    },
  });
  try {
    await sendEmail(payload);
    return await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date(), error: null },
    });
  } catch {
    // Provider errors can contain credentials and request bodies.
    return await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        error: "Email delivery failed. Check the email provider configuration.",
      },
    });
  }
}

export async function sendNotification(payload: NotificationPayload, onlyWebhook?: WebhookTarget) {
  const requestedAt = new Date();
  const user = onlyWebhook
    ? null
    : await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          notificationEmailEnabled: true,
          webhookTargets: { where: { enabled: true }, orderBy: { createdAt: "asc" } },
        },
      });
  if (!onlyWebhook && !user) throw new Error("Notification user not found");
  const webhookPayload = buildWebhookPayload(payload, requestedAt);
  const tasks = [
    ...(user?.notificationEmailEnabled
      ? [
          {
            channel: "EMAIL" as const,
            target: payload.to,
            run: () => sendTrackedEmail(payload, requestedAt),
          },
        ]
      : []),
    ...(onlyWebhook ? [onlyWebhook] : (user?.webhookTargets ?? [])).map((target) => ({
      channel: "WEBHOOK" as const,
      target: target.name,
      run: () => sendTrackedWebhook(target, webhookPayload),
    })),
  ];
  const deliveries: NotificationDelivery[] = [];
  for (let index = 0; index < tasks.length; index += 5) {
    const batch = tasks.slice(index, index + 5);
    const results = await Promise.allSettled(batch.map((task) => task.run()));
    for (const [offset, result] of results.entries()) {
      const task = batch[offset];
      deliveries.push({
        channel: task.channel,
        target: task.target,
        status: result.status === "fulfilled" ? result.value.status : "FAILED",
        error:
          result.status === "fulfilled" ? result.value.error : "Delivery could not be recorded",
      });
    }
  }
  return {
    requestedAt,
    sent: deliveries.some((delivery) => delivery.status === "SENT"),
    deliveries,
  };
}

export function testNotification(user: {
  id: string;
  email: string;
  name: string;
}): NotificationPayload {
  const name = user.name.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]!,
  );
  return {
    userId: user.id,
    to: user.email,
    purpose: "TEST",
    subject: "Traffic Usage Monitor test notification",
    shortText: "Traffic Usage Monitor: Test notification to confirm delivery is configured.",
    text: `Hello ${user.name},\nThis is a test notification from Traffic Usage Monitor to confirm delivery is configured.`,
    html: `<p>Hello ${name},</p><p>This is a test notification from Traffic Usage Monitor.</p><p>If you received this, delivery is configured correctly.</p>`,
  };
}
