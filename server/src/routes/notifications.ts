import { Router, type Request, type Response } from "express";
import prisma from "../prisma";
import { asyncHandler, HttpError, requireBodyString, sendJson } from "../lib/http";
import { parseWebhookConfig } from "../lib/webhook";
import { requireUser } from "../middleware/auth";
import { sendNotification, testNotification } from "../services/notificationService";

const router = Router();
router.use(requireUser);

function targetId(req: Request): string {
  return requireBodyString(req.params.id, "Webhook ID");
}

router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const webhooks = await prisma.webhookTarget.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        enabled: true,
        url: true,
        method: true,
        headers: true,
        bodyTemplate: true,
      },
    });
    sendJson(res, {
      email: { address: req.user!.email, enabled: req.user!.notificationEmailEnabled },
      webhooks,
    });
  }),
);

router.put(
  "/email",
  asyncHandler(async (req, res) => {
    if (typeof req.body?.enabled !== "boolean")
      throw new HttpError(400, "Email enabled must be a boolean");
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { notificationEmailEnabled: req.body.enabled },
    });
    sendJson(res, { address: user.email, enabled: user.notificationEmailEnabled });
  }),
);

router.post(
  "/webhooks",
  asyncHandler(async (req, res) => {
    const config = parseWebhookConfig(req.body);
    const webhook = await prisma.webhookTarget.create({
      data: { ...config, userId: req.user!.id },
    });
    sendJson(res, { webhook }, 201);
  }),
);

router.put(
  "/webhooks/:id",
  asyncHandler(async (req, res) => {
    const config = parseWebhookConfig(req.body);
    const result = await prisma.webhookTarget.updateMany({
      where: { id: targetId(req), userId: req.user!.id },
      data: config,
    });
    if (!result.count) throw new HttpError(404, "Webhook not found");
    sendJson(res, { success: true });
  }),
);

router.delete(
  "/webhooks/:id",
  asyncHandler(async (req, res) => {
    const result = await prisma.webhookTarget.deleteMany({
      where: { id: targetId(req), userId: req.user!.id },
    });
    if (!result.count) throw new HttpError(404, "Webhook not found");
    sendJson(res, { success: true });
  }),
);

async function sendTest(req: Request, res: Response, individual: boolean) {
  if (!req.user!.emailVerifiedAt)
    throw new HttpError(403, "Verify your email before sending test notifications");
  const webhook = individual
    ? await prisma.webhookTarget.findFirst({ where: { id: targetId(req), userId: req.user!.id } })
    : undefined;
  if (individual && !webhook) throw new HttpError(404, "Webhook not found");
  const result = await sendNotification(testNotification(req.user!), webhook ?? undefined);
  sendJson(
    res,
    {
      success: result.sent,
      ...result,
      ...(!result.sent
        ? {
            error: result.deliveries.length
              ? "All notification deliveries failed. See delivery history for details."
              : "No notification targets are enabled",
          }
        : {}),
    },
    result.sent ? 200 : 502,
  );
}

router.post(
  "/test",
  asyncHandler((req, res) => sendTest(req, res, false)),
);
router.post(
  "/webhooks/:id/test",
  asyncHandler((req, res) => sendTest(req, res, true)),
);

router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const rawLimit = Number(req.query.limit ?? 25);
    const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 25;
    const logs = await prisma.notificationLog.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    sendJson(res, {
      entries: logs.map((log) => ({
        id: log.id,
        channel: log.channel,
        target: log.target,
        requestedAt: log.requestedAt,
        sentAt: log.sentAt,
        status: log.status,
        purpose: log.purpose,
        subject: log.subject,
        preview: log.preview,
        error: log.error,
      })),
    });
  }),
);

export default router;
