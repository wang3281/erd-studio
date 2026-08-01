import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../db.js";
import { ensureEditor, ensureSameOriginRequest } from "../auth.js";

interface RouteOptions {
  db: ProjectStore;
  maxSchemaBytes?: number;
  readAccess?: "private" | "public";
  appBaseUrl?: string;
}

interface PutBody {
  schema: unknown;
  expectedUpdatedAt?: unknown;
}

const NAME_RE = /^[\w가-힣 .,_\-()[\]]{1,120}$/u;

function validatorFor(updatedAt: string, version: number): string {
  return `${updatedAt}:${version}`;
}

function etagFor(updatedAt: string, version: number): string {
  const validator = validatorFor(updatedAt, version);
  return `"${validator.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseIfMatch(value: string | string[] | undefined): string[] | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part === "*") return "*";
      return part.startsWith('"') && part.endsWith('"')
        ? part.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : part;
    });
  return values.length > 0 ? values : undefined;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  { db, maxSchemaBytes = 5_000_000, readAccess = "private", appBaseUrl }: RouteOptions,
): void {
  app.get("/projects", async (req, reply) => {
    if (readAccess === "private" && !ensureEditor(req, reply)) return;
    return { projects: db.listProjects() };
  });

  app.get<{ Params: { name: string } }>("/projects/:name", async (req, reply) => {
    if (readAccess === "private" && !ensureEditor(req, reply)) return;
    const name = req.params.name;
    const row = db.getProject(name);
    if (!row) {
      return reply.code(404).send({ ok: false, error: "not found" });
    }
    let schema: unknown;
    try {
      schema = JSON.parse(row.schemaJson);
    } catch {
      return reply.code(500).send({ ok: false, error: "corrupt schema" });
    }
    reply.header("ETag", etagFor(row.updatedAt, row.version));
    return { schema, updatedAt: row.updatedAt, version: row.version };
  });

  app.put<{ Params: { name: string }; Body: PutBody }>(
    "/projects/:name",
    async (req, reply) => {
      if (!ensureSameOriginRequest(req, reply, appBaseUrl)) return;
      if (!ensureEditor(req, reply)) return;

      const name = req.params.name;
      if (!NAME_RE.test(name)) {
        return reply.code(400).send({ ok: false, error: "invalid name" });
      }

      const body = req.body;
      if (!body || typeof body !== "object" || body.schema === undefined) {
        return reply.code(400).send({ ok: false, error: "schema required" });
      }

      const schemaValue = body.schema;
      if (schemaValue === null || typeof schemaValue !== "object" || Array.isArray(schemaValue)) {
        return reply.code(400).send({ ok: false, error: "invalid schema" });
      }
      if (schemaValue && typeof schemaValue === "object" && "name" in schemaValue) {
        const schemaName = (schemaValue as { name?: unknown }).name;
        if (typeof schemaName === "string" && schemaName !== name) {
          return reply.code(400).send({ ok: false, error: "schema name does not match project name" });
        }
      }

      const schemaJson = JSON.stringify(schemaValue);
      if (Buffer.byteLength(schemaJson, "utf8") > maxSchemaBytes) {
        return reply.code(413).send({ ok: false, error: "schema too large" });
      }

      const ifMatchValues = parseIfMatch(req.headers["if-match"]);
      const wildcardIfMatch = ifMatchValues?.includes("*") ?? false;
      const createOnly = parseIfMatch(req.headers["if-none-match"])?.includes("*") ?? false;
      const currentProject = db.getProject(name);
      if (createOnly && currentProject) {
        return reply.code(409).send({
          ok: false,
          error: "project already exists",
          currentUpdatedAt: currentProject.updatedAt,
          currentVersion: currentProject.version,
        });
      }
      if (wildcardIfMatch && !currentProject) {
        return reply.code(409).send({
          ok: false,
          error: "project was modified by another editor",
          currentUpdatedAt: null,
          currentVersion: null,
        });
      }
      const currentValidator = currentProject ? validatorFor(currentProject.updatedAt, currentProject.version) : null;
      const matchedIfMatchValidator = ifMatchValues?.find((value) => value !== "*" && value === currentValidator);
      const expectedValidator = wildcardIfMatch
        ? undefined
        : matchedIfMatchValidator
          ?? (ifMatchValues ? "__if_match_precondition_failed__" : undefined)
          ?? (typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined);
      const result = db.upsertProject(name, schemaJson, expectedValidator);
      if (!result.ok) {
        return reply.code(409).send({
          ok: false,
          error: "project was modified by another editor",
          currentUpdatedAt: result.currentUpdatedAt,
          currentVersion: result.currentVersion,
        });
      }
      reply.header("ETag", etagFor(result.updatedAt, result.version));
      return { ok: true, updatedAt: result.updatedAt, version: result.version };
    },
  );

  app.delete<{ Params: { name: string } }>(
    "/projects/:name",
    async (req, reply) => {
      if (!ensureSameOriginRequest(req, reply, appBaseUrl)) return;
      if (!ensureEditor(req, reply)) return;
      const name = req.params.name;
      if (!NAME_RE.test(name)) {
        return reply.code(400).send({ ok: false, error: "invalid name" });
      }
      const currentProject = db.getProject(name);
      if (!currentProject) {
        return reply.code(404).send({ ok: false, error: "not found" });
      }
      const ifMatchValues = parseIfMatch(req.headers["if-match"]);
      if (!ifMatchValues || ifMatchValues.includes("*")) {
        return reply.code(428).send({ ok: false, error: "specific If-Match required" });
      }
      const currentValidator = validatorFor(currentProject.updatedAt, currentProject.version);
      if (!ifMatchValues.includes("*") && !ifMatchValues.includes(currentValidator)) {
        return reply.code(409).send({
          ok: false,
          error: "project was modified by another editor",
          currentUpdatedAt: currentProject.updatedAt,
          currentVersion: currentProject.version,
        });
      }
      const ok = db.deleteProject(name);
      if (!ok) {
        return reply.code(404).send({ ok: false, error: "not found" });
      }
      return { ok: true };
    },
  );
}
