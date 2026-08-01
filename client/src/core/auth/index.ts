const LEGACY_EDIT_TOKEN_KEY = "erd-edit-token";
const LEGACY_ROLE_KEYS = ["erd-auth-role", "erd-edit-role"] as const;
let sessionGeneration = 0;

export type AuthRole = "admin" | "editor";

function getLocalStorage(): Pick<Storage, "removeItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    if (typeof localStorage.removeItem !== "function") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

export function clearLegacyAuthStorage(): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(LEGACY_EDIT_TOKEN_KEY);
    for (const key of LEGACY_ROLE_KEYS) {
      storage.removeItem(key);
    }
  } catch {
    return;
  }
}

clearLegacyAuthStorage();

export interface LoginResult {
  ok: boolean;
  role?: AuthRole;
}

export interface SessionInfo {
  ok: boolean;
  /**
   * false when no functioning server answered /api/auth/me: the request failed
   * (no server at all) or returned 5xx — the vite dev proxy answers 500 when
   * the backend is down, so dev-without-server must count as unreachable too.
   */
  serverReachable: boolean;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl?: string | null;
  } | null;
  aiAccessGrant: {
    status: string;
    label: string;
    expiresAt?: string | null;
  } | null;
  canUseAI: boolean;
  canEdit: boolean;
  editorRole: AuthRole | null;
}

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export async function getSessionInfo(): Promise<SessionInfo> {
  const fallback: SessionInfo = {
    ok: false,
    serverReachable: true,
    user: null,
    aiAccessGrant: null,
    canUseAI: false,
    canEdit: false,
    editorRole: null,
  };
  let res: Response;
  try {
    res = await fetch("/api/auth/me", { credentials: "same-origin" });
  } catch {
    // No server responded — treat as local/offline mode rather than an error.
    return { ...fallback, serverReachable: false };
  }
  // 5xx means no functioning auth backend answered (e.g. the vite dev proxy
  // returns 500 on ECONNREFUSED when `server/` is not running). Writes stay
  // server-gated either way, so local editable mode is safe to enter.
  if (res.status >= 500) return { ...fallback, serverReachable: false };
  if (!res.ok) return fallback;
  const data = (await res.json().catch(() => null)) as Partial<SessionInfo> | null;
  return {
    ok: data?.ok === true,
    serverReachable: true,
    user: data?.user ?? null,
    aiAccessGrant: data?.aiAccessGrant ?? null,
    canUseAI: data?.canUseAI === true,
    canEdit: data?.canEdit === true,
    editorRole: data?.editorRole === "admin"
      ? "admin"
      : data?.editorRole === "editor"
        ? "editor"
        : null,
  };
}

export function startOAuthLogin(provider = "github"): void {
  window.location.assign(`/api/auth/oauth/${encodeURIComponent(provider)}/start`);
}

export async function logoutSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) return false;
    sessionGeneration += 1;
    return true;
  } catch {
    return false;
  }
}

export async function logoutEditorSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/editor/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) return false;
    sessionGeneration += 1;
    return true;
  } catch {
    return false;
  }
}

export async function login(password: string, signal?: AbortSignal): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password }),
    signal,
  });
  if (signal?.aborted) return { ok: false };
  if (!res.ok) return { ok: false };
  const data = (await res.json().catch(() => null)) as { ok?: boolean; role?: string } | null;
  if (!data?.ok || (data.role !== "admin" && data.role !== "editor")) return { ok: false };
  if (signal?.aborted) return { ok: false };
  return { ok: true, role: data.role };
}
