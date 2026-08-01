import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeRequestForLog } from "../logging.js";

test("request logger strips query-string secrets while preserving request metadata", () => {
  const serialized = serializeRequestForLog({
    method: "GET",
    url: "/api/auth/oauth/github/callback?code=SECRETCODE&state=SECRETSTATE",
    headers: { "accept-version": "1.0" },
    host: "erd.example.com",
    ip: "203.0.113.10",
    socket: { remotePort: 43210 },
  });

  assert.deepEqual(serialized, {
    method: "GET",
    url: "/api/auth/oauth/github/callback",
    version: "1.0",
    host: "erd.example.com",
    remoteAddress: "203.0.113.10",
    remotePort: 43210,
  });
  assert.doesNotMatch(serialized.url, /SECRETCODE|SECRETSTATE/);
});
