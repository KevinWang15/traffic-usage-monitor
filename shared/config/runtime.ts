export const SHARED_APP_NAME = "Traffic Usage Monitor";
export const API_PREFIX = "/api";

export function buildHealthPayload(service: string) {
  return {
    ok: true,
    service,
    app: SHARED_APP_NAME,
    timestamp: new Date().toISOString(),
  };
}
