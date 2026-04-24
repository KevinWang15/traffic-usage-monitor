import type { Host, User } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import prisma from "../prisma";
import { HttpError } from "../lib/http";
import { readBearerToken, verifySecret, verifySessionToken } from "../lib/security";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      agentHost?: Host & { user: User };
    }
  }
}

export async function requireUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readBearerToken(req.header("Authorization"));
    const payload = verifySessionToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new HttpError(401, "User not found");
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAgent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const agentId = req.header("X-Agent-Id");
    if (!agentId) {
      throw new HttpError(401, "Missing X-Agent-Id header");
    }
    const token = readBearerToken(req.header("Authorization"));
    const host = await prisma.host.findUnique({
      where: { id: agentId },
      include: { user: true },
    });
    if (!host || host.status === "DISABLED") {
      throw new HttpError(401, "Agent is not registered");
    }
    if (!verifySecret(token, host.agentKeyHash)) {
      throw new HttpError(401, "Invalid agent key");
    }
    req.agentHost = host;
    next();
  } catch (error) {
    next(error);
  }
}
