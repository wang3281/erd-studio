import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyAuthStorage,
  getSessionGeneration,
  getSessionInfo,
  login,
  logoutEditorSession,
  logoutSession,
} from "../index";

const storage = new Map<string, string>();

beforeEach(() => {
  vi.restoreAllMocks();
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

describe("cookie auth", () => {
  it("removes legacy password-token storage without creating replacements", () => {
    storage.set("erd-edit-token", "legacy-password");
    storage.set("erd-auth-role", "admin");
    storage.set("erd-edit-role", "editor");

    clearLegacyAuthStorage();

    expect(storage.has("erd-edit-token")).toBe(false);
    expect(storage.has("erd-auth-role")).toBe(false);
    expect(storage.has("erd-edit-role")).toBe(false);
    expect(storage.size).toBe(0);
  });

  it("ignores blocked localStorage while removing legacy auth", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    expect(() => clearLegacyAuthStorage()).not.toThrow();
  });

  it("ignores localStorage removal failures", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        removeItem() {
          throw new DOMException("blocked", "SecurityError");
        },
      },
    });

    expect(() => clearLegacyAuthStorage()).not.toThrow();
  });

  it("loads OAuth AI access session info from the server", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      user: { id: "usr_1", email: "sub@example.com", displayName: "OSS Contributor" },
      aiAccessGrant: { status: "enabled", label: "default" },
      canUseAI: true,
      canEdit: true,
      editorRole: "admin",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const info = await getSessionInfo();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", { credentials: "same-origin" });
    expect(info.canUseAI).toBe(true);
    expect(info.user?.email).toBe("sub@example.com");
    expect(info.aiAccessGrant?.status).toBe("enabled");
    expect(info.canEdit).toBe(true);
    expect(info.editorRole).toBe("admin");
  });

  it("reports the server as reachable on a non-5xx HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const info = await getSessionInfo();
    expect(info.serverReachable).toBe(true);
    expect(info.ok).toBe(false);
  });

  it("reports the server as unreachable when the request fails (no server)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const info = await getSessionInfo();
    expect(info.serverReachable).toBe(false);
    expect(info.ok).toBe(false);
  });

  it.each([500, 502, 503])(
    "reports the server as unreachable on a %d response (dev proxy with backend down)",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
      const info = await getSessionInfo();
      expect(info.serverReachable).toBe(false);
      expect(info.ok).toBe(false);
    },
  );

  it("reports whether OAuth logout reached the server", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logoutSession()).resolves.toBe(true);
    await expect(logoutSession()).resolves.toBe(false);
    await expect(logoutSession()).resolves.toBe(false);
  });

  it("reports whether editor logout reached the server", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logoutEditorSession()).resolves.toBe(true);
    await expect(logoutEditorSession()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/editor/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("invalidates session info requests only after a successful logout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const initialGeneration = getSessionGeneration();

    await expect(logoutSession()).resolves.toBe(false);
    expect(getSessionGeneration()).toBe(initialGeneration);
    await expect(logoutSession()).resolves.toBe(true);
    expect(getSessionGeneration()).toBe(initialGeneration + 1);
  });

  it("does not persist a successful login response after the request is aborted", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify({ ok: true, role: "editor" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const result = await login("password", controller.signal);

    expect(result.ok).toBe(false);
    expect(storage.size).toBe(0);
  });

  it("uses the HttpOnly cookie contract without persisting the login response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      role: "editor",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("password")).resolves.toEqual({ ok: true, role: "editor" });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      credentials: "same-origin",
    }));
    expect(storage.size).toBe(0);
  });
});
