#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function lstatIfExists(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

const serverDir = path.resolve(__dirname, "..");
const rootEnv = path.resolve(serverDir, "..", ".env");
const target = path.resolve(serverDir, ".env");
const relativeTarget = path.relative(serverDir, rootEnv);

if (!fs.existsSync(rootEnv)) {
  console.error("Missing root .env file at " + rootEnv);
  process.exit(1);
}

const current = lstatIfExists(target);
if (current?.isSymbolicLink()) {
  const linkedPath = path.resolve(serverDir, fs.readlinkSync(target));
  if (linkedPath === rootEnv) {
    process.exit(0);
  }
  fs.unlinkSync(target);
} else if (current) {
  console.error("Refusing to replace non-symlink " + target + ". Remove it and rerun npm run env:setup.");
  process.exit(1);
}

fs.symlinkSync(relativeTarget, target);
console.log("Linked " + target + " -> " + relativeTarget);
