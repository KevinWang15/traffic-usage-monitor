export const WEBHOOK_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];
export type NotificationPurpose = "TEST" | "TRAFFIC_ALERT" | "MISSING_HOST";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED";

export interface WebhookConfig {
  name: string;
  enabled: boolean;
  url: string;
  method: WebhookMethod;
  headers: Record<string, string>;
  bodyTemplate: string | null;
}
export interface WebhookTarget extends WebhookConfig {
  id: string;
}
export interface NotificationSettings {
  email: { address: string; enabled: boolean };
  webhooks: WebhookTarget[];
}
export interface NotificationDelivery {
  channel: "EMAIL" | "WEBHOOK";
  target: string;
  status: NotificationStatus;
  error: string | null;
}
export interface NotificationHistoryEntry extends NotificationDelivery {
  id: string;
  requestedAt: string;
  sentAt: string | null;
  purpose: NotificationPurpose;
  subject: string;
  preview: string | null;
}
export interface NotificationResult {
  requestedAt: string;
  sent: boolean;
  deliveries: NotificationDelivery[];
}
