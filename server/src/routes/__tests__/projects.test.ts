import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAuth } from "../../auth.js";
import { registerProjectRoutes } from "../projects.js";
import type {
  EditorSessionStore,
  ProjectStore,
  ProjectMetaRow,
  ProjectRow,
  UpsertProjectResult,
} from "../../db.js";

const EDITOR_HEADERS = {
  cookie: "erd-editor-session=test-editor-session",
  host: "localhost:3001",
  origin: "http://localhost:3001",
};

const editorSessionStore: EditorSessionStore = {
  createEditorSession(role, _sessionHash, expiresAt) {
    return { id: "test-session", role, expiresAt };
  },
  getEditorSessionByHash() {
    return { id: "test-session", role: "editor", expiresAt: "2099-01-01T00:00:00.000Z" };
  },
  deleteEditorSessionByHash() {
    return true;
  },
};

function createMemoryDb(): ProjectStore {
  const rows = new Map<string, ProjectRow>();
  let version = 1;

  return {
    listProjects(): ProjectMetaRow[] {
      return [...rows.values()].map(({ name, updatedAt, version }) => ({ name, updatedAt, version }));
    },
    getProject(name: string): ProjectRow | null {
      return rows.get(name) ?? null;
    },
    upsertProject(name: string, schemaJson: string, expectedValidator?: string): UpsertProjectResult {
      const current = rows.get(name);
      const currentValidator = current ? `${current.updatedAt}:${current.version}` : null;
      if (expectedValidator !== undefined && currentValidator !== expectedValidator) {
        return { ok: false, currentUpdatedAt: current?.updatedAt ?? null, currentVersion: current?.version ?? null };
      }
      const rowVersion = current ? current.version + 1 : version++;
      const updatedAt = `2026-01-01T00:00:00.${rowVersion}Z`;
      rows.set(name, { name, schemaJson, updatedAt, version: rowVersion });
      return { ok: true, updatedAt, version: rowVersion };
    },
    deleteProject(name: string): boolean {
      return rows.delete(name);
    },
  };
}

async function makeApp(
  maxSchemaBytes = 5_000_000,
  readAccess: "private" | "public" = "public",
) {
  const app = Fastify();
  registerAuth(app, {
    editPassword: "edit",
    adminPassword: "admin",
    editorSessionStore,
  });
  registerProjectRoutes(app, { db: createMemoryDb(), maxSchemaBytes, readAccess });
  await app.ready();
  return app;
}

test("project routes handle percent characters in decoded route params without 500", async () => {
  const app = await makeApp();
  try {
    const put = await app.inject({
      method: "PUT",
      url: "/projects/a%25b",
      headers: EDITOR_HEADERS,
      payload: { schema: { name: "a%b" } },
    });
    assert.equal(put.statusCode, 400);
    assert.match(put.body, /invalid name/);

    const get = await app.inject({ method: "GET", url: "/projects/a%25b" });
    assert.notEqual(get.statusCode, 500);
  } finally {
    await app.close();
  }
});

test("If-Match wildcard requires an existing project before saving", async () => {
  const app = await makeApp();
  try {
    const createMissing = await app.inject({
      method: "PUT",
      url: "/projects/new-project",
      headers: { ...EDITOR_HEADERS, "if-match": "*" },
      payload: { schema: { name: "new-project" } },
    });
    assert.equal(createMissing.statusCode, 409);

    const create = await app.inject({
      method: "PUT",
      url: "/projects/existing",
      headers: EDITOR_HEADERS,
      payload: { schema: { name: "existing" } },
    });
    assert.equal(create.statusCode, 200);

    const updateExisting = await app.inject({
      method: "PUT",
      url: "/projects/existing",
      headers: { ...EDITOR_HEADERS, "if-match": "*" },
      payload: { schema: { name: "existing", updated: true } },
    });
    assert.equal(updateExisting.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("If-Match entity-tag lists allow update when one tag matches", async () => {
  const app = await makeApp();
  try {
    const create = await app.inject({
      method: "PUT",
      url: "/projects/list-match",
      headers: EDITOR_HEADERS,
      payload: { schema: { name: "list-match" } },
    });
    assert.equal(create.statusCode, 200);
    const currentTag = create.headers.etag;
    assert.equal(typeof currentTag, "string");

    const update = await app.inject({
      method: "PUT",
      url: "/projects/list-match",
      headers: { ...EDITOR_HEADERS, "if-match": `"stale", ${currentTag}` },
      payload: { schema: { name: "list-match", updated: true } },
    });
    assert.equal(update.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("If-None-Match wildcard creates only when the project does not exist", async () => {
  const app = await makeApp();
  try {
    const create = await app.inject({
      method: "PUT",
      url: "/projects/create-only",
      headers: { ...EDITOR_HEADERS, "if-none-match": "*" },
      payload: { schema: { name: "create-only", value: 1 } },
    });
    assert.equal(create.statusCode, 200);

    const overwrite = await app.inject({
      method: "PUT",
      url: "/projects/create-only",
      headers: { ...EDITOR_HEADERS, "if-none-match": "*" },
      payload: { schema: { name: "create-only", value: 2 } },
    });
    assert.equal(overwrite.statusCode, 409);

    const stored = await app.inject({ method: "GET", url: "/projects/create-only" });
    assert.equal(stored.json().schema.value, 1);
  } finally {
    await app.close();
  }
});

test("project schema size limit is enforced by UTF-8 byte length", async () => {
  const app = await makeApp(35);
  try {
    const res = await app.inject({
      method: "PUT",
      url: "/projects/한글",
      headers: EDITOR_HEADERS,
      payload: { schema: { name: "한글", note: "🙂🙂🙂" } },
    });
    assert.equal(res.statusCode, 413);
  } finally {
    await app.close();
  }
});

test("project routes reject null and primitive schemas", async () => {
  const app = await makeApp();
  try {
    for (const schema of [null, "broken", 42]) {
      const res = await app.inject({
        method: "PUT",
        url: "/projects/invalid-schema",
        headers: EDITOR_HEADERS,
        payload: { schema },
      });
      assert.equal(res.statusCode, 400);
    }
  } finally {
    await app.close();
  }
});

test("DELETE rejects missing and stale If-Match validators", async () => {
  const app = await makeApp();
  try {
    const create = await app.inject({
      method: "PUT",
      url: "/projects/delete-race",
      headers: EDITOR_HEADERS,
      payload: { schema: { name: "delete-race", value: 1 } },
    });
    const staleTag = create.headers.etag;
    assert.equal(typeof staleTag, "string");
    const update = await app.inject({
      method: "PUT",
      url: "/projects/delete-race",
      headers: { ...EDITOR_HEADERS, "if-match": staleTag },
      payload: { schema: { name: "delete-race", value: 2 } },
    });
    assert.equal(update.statusCode, 200);

    const missing = await app.inject({
      method: "DELETE",
      url: "/projects/delete-race",
      headers: EDITOR_HEADERS,
    });
    assert.equal(missing.statusCode, 428);
    const wildcard = await app.inject({
      method: "DELETE",
      url: "/projects/delete-race",
      headers: { ...EDITOR_HEADERS, "if-match": "*" },
    });
    assert.equal(wildcard.statusCode, 428);
    const stale = await app.inject({
      method: "DELETE",
      url: "/projects/delete-race",
      headers: { ...EDITOR_HEADERS, "if-match": staleTag },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((await app.inject({ method: "GET", url: "/projects/delete-race" })).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("private project reads require an editor session while public mode is explicit", async () => {
  const privateApp = await makeApp(5_000_000, "private");
  const publicApp = await makeApp(5_000_000, "public");
  try {
    const anonymousPrivate = await privateApp.inject({ method: "GET", url: "/projects" });
    assert.equal(anonymousPrivate.statusCode, 401);

    const authenticatedPrivate = await privateApp.inject({
      method: "GET",
      url: "/projects",
      headers: { cookie: EDITOR_HEADERS.cookie },
    });
    assert.equal(authenticatedPrivate.statusCode, 200);

    const anonymousPublic = await publicApp.inject({ method: "GET", url: "/projects" });
    assert.equal(anonymousPublic.statusCode, 200);
  } finally {
    await privateApp.close();
    await publicApp.close();
  }
});

test("cross-origin project writes are rejected even with an editor session", async () => {
  const app = await makeApp();
  try {
    const response = await app.inject({
      method: "PUT",
      url: "/projects/csrf-target",
      headers: {
        cookie: EDITOR_HEADERS.cookie,
        host: "localhost:3001",
        origin: "https://attacker.example",
      },
      payload: { schema: { name: "csrf-target" } },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});
