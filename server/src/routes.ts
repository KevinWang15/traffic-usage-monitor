import { Router } from "express";
import { buildHealthPayload, SHARED_APP_NAME } from "@shared/config/runtime";
import { env } from "./config";
import authRoutes from "./routes/auth";
import accountRoutes from "./routes/account";
import configRoutes from "./routes/config";
import hostRoutes from "./routes/hosts";
import agentRoutes from "./routes/agent";
import prisma from "./prisma";

const router = Router();

router.get("/health", (_req, res) => {
  res.json(buildHealthPayload("server"));
});

router.get("/config", (_req, res) => {
  res.json({ app: SHARED_APP_NAME, version: env.appVersion });
});

router.get("/metrics", async (_req, res, next) => {
  try {
    const [hostStatusCounts, trafficTotals, alertStatusCounts, userCount] = await Promise.all([
      prisma.host.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.host.aggregate({
        _sum: {
          trafficAllowanceBytes: true,
          usedBytes: true,
          remainingBytes: true,
        },
      }),
      prisma.alertEvent.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.user.count(),
    ]);

    const lines = [
      "# HELP traffic_usage_monitor_info Application info.",
      "# TYPE traffic_usage_monitor_info gauge",
      `traffic_usage_monitor_info{version="${escapeMetricLabel(env.appVersion)}"} 1`,
      "# HELP traffic_usage_monitor_users_total Registered users.",
      "# TYPE traffic_usage_monitor_users_total gauge",
      `traffic_usage_monitor_users_total ${userCount}`,
      "# HELP traffic_usage_monitor_hosts_total Hosts by stored lifecycle status.",
      "# TYPE traffic_usage_monitor_hosts_total gauge",
      ...hostStatusCounts.map((item) => `traffic_usage_monitor_hosts_total{status="${escapeMetricLabel(item.status)}"} ${item._count._all}`),
      "# HELP traffic_usage_monitor_traffic_bytes Traffic counters summed across hosts.",
      "# TYPE traffic_usage_monitor_traffic_bytes gauge",
      `traffic_usage_monitor_traffic_bytes{kind="allowance"} ${trafficTotals._sum.trafficAllowanceBytes ?? 0n}`,
      `traffic_usage_monitor_traffic_bytes{kind="used"} ${trafficTotals._sum.usedBytes ?? 0n}`,
      `traffic_usage_monitor_traffic_bytes{kind="remaining"} ${trafficTotals._sum.remainingBytes ?? 0n}`,
      "# HELP traffic_usage_monitor_alert_events_total Alert events by delivery status.",
      "# TYPE traffic_usage_monitor_alert_events_total counter",
      ...alertStatusCounts.map((item) => `traffic_usage_monitor_alert_events_total{status="${escapeMetricLabel(item.status)}"} ${item._count._all}`),
      "",
    ];

    res.type("text/plain; version=0.0.4").send(lines.join("\n"));
  } catch (error) {
    next(error);
  }
});

function escapeMetricLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

router.use("/auth", authRoutes);
router.use("/account", accountRoutes);
router.use("/config", configRoutes);
router.use("/hosts", hostRoutes);
router.use("/agent", agentRoutes);

export default router;
