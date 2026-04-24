import fs from "node:fs";
import path from "node:path";

export function readAgentAsset(name: "install.sh" | "traffic-agent.sh"): string {
  const candidates = [
    path.resolve(process.cwd(), "..", "agent", name),
    path.resolve(process.cwd(), "agent", name),
    path.resolve(__dirname, "..", "..", "agent", name),
    path.resolve(__dirname, "..", "..", "..", "agent", name),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Unable to find agent asset ${name}. Checked: ${candidates.join(", ")}`);
  }
  return fs.readFileSync(found, "utf8");
}
