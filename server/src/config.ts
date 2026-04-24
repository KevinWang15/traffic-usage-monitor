import dotenv from "dotenv";

dotenv.config();

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, ""),
  appVersion: process.env.APP_VERSION || "0.1.0",
  jwtSecret: requiredEnv("JWT_SECRET", "replace-with-a-long-random-secret"),
};

if (env.nodeEnv === "production" && env.jwtSecret === "replace-with-a-long-random-secret") {
  throw new Error("Set a strong JWT_SECRET before running in production.");
}
