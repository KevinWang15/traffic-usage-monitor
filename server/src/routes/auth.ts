import { Router } from "express";
import prisma from "../prisma";
import { asyncHandler, HttpError, requireBodyString, sendJson } from "../lib/http";
import { createSessionToken, hashPassword, randomToken, verifyPassword } from "../lib/security";
import { percentBasisPointsToPercent } from "../lib/bytes";
import { requireUser } from "../middleware/auth";

const router = Router();

function userDto(user: {
  id: string;
  email: string;
  name: string | null;
  defaultAlertThresholdBasisPts: number;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    defaultAlertThresholdPercent: percentBasisPointsToPercent(user.defaultAlertThresholdBasisPts),
    createdAt: user.createdAt,
  };
}

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const email = requireBodyString(req.body.email, "email").toLowerCase();
    const password = requireBodyString(req.body.password, "password");
    const name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : null;

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new HttpError(400, "email must be valid");
    }
    if (password.length < 10) {
      throw new HttpError(400, "password must be at least 10 characters");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "A user with this email already exists");
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        joinToken: randomToken(32),
      },
    });

    sendJson(res, { token: createSessionToken(user.id), user: userDto(user) }, 201);
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = requireBodyString(req.body.email, "email").toLowerCase();
    const password = requireBodyString(req.body.password, "password");
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password");
    }

    sendJson(res, { token: createSessionToken(user.id), user: userDto(user) });
  }),
);

router.get(
  "/me",
  requireUser,
  asyncHandler(async (req, res) => {
    sendJson(res, { user: userDto(req.user!) });
  }),
);

export default router;
export { userDto };
