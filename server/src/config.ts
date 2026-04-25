import dotenv from "dotenv";

dotenv.config();

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  const numericValue = Number(normalized);
  if (Number.isInteger(numericValue) && numericValue >= 0) {
    return numericValue;
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, ""),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  appVersion: process.env.APP_VERSION || "0.1.0",
  jwtSecret: requiredEnv("JWT_SECRET", "replace-with-a-long-random-secret"),
  emailVerificationTokenTtlMinutes: Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || 1440),
  passwordResetTokenTtlMinutes: Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 60),
  missingNodeGraceMinutes: Number(process.env.MISSING_NODE_GRACE_MINUTES || 60),
};

if (env.nodeEnv === "production" && env.jwtSecret === "replace-with-a-long-random-secret") {
  throw new Error("Set a strong JWT_SECRET before running in production.");
}
