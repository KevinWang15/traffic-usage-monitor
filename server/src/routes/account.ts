import { Router } from "express";
import prisma from "../prisma";
import { env } from "../config";
import { asyncHandler, HttpError, sendJson } from "../lib/http";
import { percentToBasisPoints } from "../lib/bytes";
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
    const updates: { defaultAlertThresholdBasisPts?: number; name?: string | null } = {};
    if (req.body.defaultAlertThresholdPercent !== undefined) {
      updates.defaultAlertThresholdBasisPts = percentToBasisPoints(
        req.body.defaultAlertThresholdPercent,
        "defaultAlertThresholdPercent",
      );
    }
    if (req.body.name !== undefined) {
      if (req.body.name === null || req.body.name === "") {
        updates.name = null;
      } else if (typeof req.body.name === "string") {
        updates.name = req.body.name.trim();
      } else {
        throw new HttpError(400, "name must be a string or null");
      }
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

export default router;
