import crypto from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config";
import { HttpError } from "./http";

const scrypt = promisify(crypto.scrypt);
const PASSWORD_PREFIX = "scrypt";

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function hmac(input: string): string {
  return crypto.createHmac("sha256", env.jwtSecret).update(input).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomToken(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${PASSWORD_PREFIX}:${salt}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, salt, hash] = stored.split(":");
  if (prefix !== PASSWORD_PREFIX || !salt || !hash) {
    return false;
  }
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuffer = decodeBase64Url(hash);
  if (derived.length !== storedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, storedBuffer);
}

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function verifySecret(secret: string, expectedHash: string): boolean {
  return safeEqual(hashSecret(secret), expectedHash);
}

type SessionPayload = {
  sub: string;
  iat: number;
  exp: number;
};

export function createSessionToken(userId: string, ttlSeconds = 60 * 60 * 24 * 30): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: userId, iat: now, exp: now + ttlSeconds }));
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${hmac(signingInput)}`;
}

export function verifySessionToken(token: string): SessionPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "Invalid session token");
  }
  const [header, payload, signature] = parts;
  const signingInput = `${header}.${payload}`;
  if (!safeEqual(hmac(signingInput), signature)) {
    throw new HttpError(401, "Invalid session token");
  }
  const parsed = JSON.parse(decodeBase64Url(payload).toString("utf8")) as SessionPayload;
  if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, "Session expired");
  }
  return parsed;
}

export function readBearerToken(headerValue: string | undefined): string {
  if (!headerValue) {
    throw new HttpError(401, "Missing Authorization header");
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpError(401, "Authorization header must use Bearer token format");
  }
  return match[1].trim();
}
