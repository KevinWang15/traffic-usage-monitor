import { Router } from "express";
import prisma from "../prisma";
import { env } from "../config";
import { asyncHandler, HttpError, requireBodyString, sendJson } from "../lib/http";
import { sendEmail } from "../lib/email";
import { createSessionToken, hashPassword, hashSecret, randomToken, verifyPassword } from "../lib/security";
import { percentBasisPointsToPercent } from "../lib/bytes";
import { requireUser } from "../middleware/auth";

const router = Router();

function userDto(user: {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  defaultAlertThresholdBasisPts: number;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerifiedAt),
    defaultAlertThresholdPercent: percentBasisPointsToPercent(user.defaultAlertThresholdBasisPts),
    createdAt: user.createdAt,
  };
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function buildUrl(path: string, token: string): string {
  const url = new URL(path, `${env.publicUrl}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

async function sendVerificationEmail(user: { email: string; name: string }, token: string): Promise<void> {
  const link = buildUrl("/verify-email", token);
  const name = escapeHtml(user.name);
  await sendEmail({
    to: user.email,
    subject: "Verify your Traffic Usage Monitor account",
    html: `<p>Hello ${name},</p><p>Please verify your email address to activate your Traffic Usage Monitor account.</p><p><a href="${link}">Verify email address</a></p><p>This link expires in ${env.emailVerificationTokenTtlMinutes} minutes.</p>`,
  });
}

async function sendPasswordResetEmail(user: { email: string; name: string }, token: string): Promise<void> {
  const link = buildUrl("/reset-password", token);
  const name = escapeHtml(user.name);
  await sendEmail({
    to: user.email,
    subject: "Reset your Traffic Usage Monitor password",
    html: `<p>Hello ${name},</p><p>Use this link to reset your Traffic Usage Monitor password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in ${env.passwordResetTokenTtlMinutes} minutes. If you did not request this, you can ignore this email.</p>`,
  });
}

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const email = requireBodyString(req.body.email, "email").toLowerCase();
    const password = requireBodyString(req.body.password, "password");
    const name = requireBodyString(req.body.name, "name");

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

    const verificationToken = randomToken(32);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        joinToken: randomToken(32),
        emailVerificationTokenHash: hashSecret(verificationToken),
        emailVerificationExpiresAt: minutesFromNow(env.emailVerificationTokenTtlMinutes),
      },
    });

    await sendVerificationEmail(user, verificationToken);
    sendJson(res, { ok: true, message: "Account created. Check your email to activate your account." }, 201);
  }),
);

router.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const token = requireBodyString(req.body.token, "token");
    const tokenHash = hashSecret(token);
    const user = await prisma.user.findUnique({ where: { emailVerificationTokenHash: tokenHash } });
    if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      throw new HttpError(400, "Verification link is invalid or expired");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    sendJson(res, { token: createSessionToken(updated.id), user: userDto(updated) });
  }),
);

router.post(
  "/verification-email/resend",
  asyncHandler(async (req, res) => {
    const email = requireBodyString(req.body.email, "email").toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) {
      sendJson(res, { ok: true });
      return;
    }

    const verificationToken = randomToken(32);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationTokenHash: hashSecret(verificationToken),
        emailVerificationExpiresAt: minutesFromNow(env.emailVerificationTokenTtlMinutes),
      },
    });
    await sendVerificationEmail(updated, verificationToken);
    sendJson(res, { ok: true });
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
    if (!user.emailVerifiedAt) {
      throw new HttpError(403, "Verify your email before logging in");
    }

    sendJson(res, { token: createSessionToken(user.id), user: userDto(user) });
  }),
);

router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const email = requireBodyString(req.body.email, "email").toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (user?.emailVerifiedAt) {
      const resetToken = randomToken(32);
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: hashSecret(resetToken),
          passwordResetExpiresAt: minutesFromNow(env.passwordResetTokenTtlMinutes),
        },
      });
      await sendPasswordResetEmail(updated, resetToken);
    }
    sendJson(res, { ok: true, message: "If that email exists, a password reset link has been sent." });
  }),
);

router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const token = requireBodyString(req.body.token, "token");
    const password = requireBodyString(req.body.password, "password");
    if (password.length < 10) {
      throw new HttpError(400, "password must be at least 10 characters");
    }

    const user = await prisma.user.findUnique({ where: { passwordResetTokenHash: hashSecret(token) } });
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw new HttpError(400, "Password reset link is invalid or expired");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });

    sendJson(res, { token: createSessionToken(updated.id), user: userDto(updated) });
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
