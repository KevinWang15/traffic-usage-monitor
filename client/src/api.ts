import type { HostDto, UserDto } from "@shared/types/traffic";

export type AuthResponse = {
  token: string;
  user: UserDto;
};

export type MessageResponse = {
  ok: boolean;
  message?: string;
};

export type JoinCommandResponse = {
  serverUrl: string;
  tokenPreview: string;
  command: string;
};

const TOKEN_KEY = "traffic-monitor-token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : response.statusText;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  signup(email: string, password: string, name: string) {
    return apiFetch<MessageResponse>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
  },
  login(email: string, password: string) {
    return apiFetch<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  me() {
    return apiFetch<{ user: UserDto }>("/api/auth/me");
  },
  verifyEmail(token: string) {
    return apiFetch<AuthResponse>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },
  resendVerificationEmail(email: string) {
    return apiFetch<MessageResponse>("/api/auth/verification-email/resend", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  forgotPassword(email: string) {
    return apiFetch<MessageResponse>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  resetPassword(token: string, password: string) {
    return apiFetch<AuthResponse>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  },
  updateAccount(defaultAlertThresholdPercent: number) {
    return apiFetch<{ user: UserDto }>("/api/account", {
      method: "PATCH",
      body: JSON.stringify({ defaultAlertThresholdPercent }),
    });
  },
  joinCommand() {
    return apiFetch<JoinCommandResponse>("/api/account/join-command");
  },
  rotateJoinToken() {
    return apiFetch<JoinCommandResponse>("/api/account/join-token/rotate", { method: "POST" });
  },
  sendTestEmail() {
    return apiFetch<MessageResponse>("/api/account/test-email", { method: "POST" });
  },
  hosts() {
    return apiFetch<{ hosts: HostDto[] }>("/api/hosts");
  },
  updateHost(id: string, payload: Record<string, unknown>) {
    return apiFetch<{ host: HostDto }>(`/api/hosts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  correctRemaining(id: string, remainingBytes: string, reason?: string) {
    return apiFetch<{ host: HostDto }>(`/api/hosts/${id}/correct-remaining`, {
      method: "POST",
      body: JSON.stringify({ remainingBytes, reason }),
    });
  },
};
