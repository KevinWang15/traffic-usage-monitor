import { Router } from "express";
import prisma from "../prisma";
import { env } from "../config";
import { asyncHandler, requireBodyString, sendJson } from "../lib/http";
import { percentToBasisPoints } from "../lib/bytes";
import { sendEmail } from "../lib/email";
import { randomToken } from "../lib/security";
import { requireUser } from "../middleware/auth";
import { userDto } from "./auth";

const router = Router();

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildJoinCommand(publicUrl: string, joinToken: string): string {
  const baseUrl = publicUrl.replace(/\/$/, "");
  return `curl -fsSL ${shellQuote(`${baseUrl}/api/agent/install.sh`)} | sudo bash -s -- --server ${shellQuote(baseUrl)} --token ${shellQuote(joinToken)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

router.use(requireUser);

router.get(
  "/join-command",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    sendJson(res, {
      serverUrl: env.publicUrl,
      tokenPreview: `${user.joinToken.slice(0, 8)}…${user.joinToken.slice(-6)}`,
      command: buildJoinCommand(env.publicUrl, user.joinToken),
    });
  }),
);

router.patch(
  "/",
  asyncHandler(async (req, res) => {
    const updates: { defaultAlertThresholdBasisPts?: number; name?: string } = {};
    if (req.body.defaultAlertThresholdPercent !== undefined) {
      updates.defaultAlertThresholdBasisPts = percentToBasisPoints(
        req.body.defaultAlertThresholdPercent,
        "defaultAlertThresholdPercent",
      );
    }
    if (req.body.name !== undefined) {
      const name = requireBodyString(req.body.name, "name");
      updates.name = name;
    }

    const user = await prisma.user.update({ where: { id: req.user!.id }, data: updates });
    sendJson(res, { user: userDto(user) });
  }),
);

router.post(
  "/join-token/rotate",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { joinToken: randomToken(32) },
    });
    sendJson(res, {
      user: userDto(user),
      tokenPreview: `${user.joinToken.slice(0, 8)}…${user.joinToken.slice(-6)}`,
      command: buildJoinCommand(env.publicUrl, user.joinToken),
    });
  }),
);

router.post(
  "/test-email",
  asyncHandler(async (req, res) => {
    const name = escapeHtml(req.user!.name);
    await sendEmail({
      to: req.user!.email,
      subject: "Traffic Usage Monitor test email",
      html: `<p>Hello ${name},</p><p>This is a test email from Traffic Usage Monitor.</p><p>If you received this, email delivery is configured correctly.</p>`,
    });
    sendJson(res, { ok: true, message: "Test email sent." });
  }),
);

export default router;
