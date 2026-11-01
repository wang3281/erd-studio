import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  clearBrowserDraft,
  loadBrowserDraft,
  saveBrowserDraft,
  setDraftStorageFactory,
} from "../draft";
import { createColumn, createEntity, createSchema } from "../../model/factory";
import type { ERDSchema } from "../../model/types";

function sampleSchema(): ERDSchema {
  const users = createEntity({ name: "users", position: { x: 40, y: 60 } });
  users.columns.push(createColumn({ name: "id", type: "bigint", isPrimaryKey: true }));
  return { ...createSchema({ name: "shop" }), entities: [users], viewport: { x: 10, y: 20, zoom: 0.5 } };
}

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
  setDraftStorageFactory(factory);
});

afterEach(() => {
  setDraftStorageFactory(undefined);
});

describe("browser draft storage", () => {
  it("returns null when no draft exists", async () => {
    expect(await loadBrowserDraft()).toBeNull();
  });

  it("round-trips the schema, timestamp and origin", async () => {
    const schema = sampleSchema();
    const now = new Date("2026-11-01T13:00:00.000Z");
    expect(await saveBrowserDraft(schema, { fromServerProject: true, now })).toBe(true);

    const draft = await loadBrowserDraft();
    expect(draft).not.toBeNull();
    expect(draft!.savedAt).toBe("2026-11-01T13:00:00.000Z");
    expect(draft!.fromServerProject).toBe(true);
    expect(draft!.schema.name).toBe("shop");
    expect(draft!.schema.viewport).toEqual({ x: 10, y: 20, zoom: 0.5 });
    expect(draft!.schema.entities[0].columns[0].name).toBe("id");
  });

  it("keeps only the latest write", async () => {
    await saveBrowserDraft(sampleSchema(), { fromServerProject: false });
    await saveBrowserDraft({ ...sampleSchema(), name: "second" }, { fromServerProject: false });
    expect((await loadBrowserDraft())!.schema.name).toBe("second");
  });

  it("clears the slot", async () => {
    await saveBrowserDraft(sampleSchema(), { fromServerProject: false });
    expect(await clearBrowserDraft()).toBe(true);
    expect(await loadBrowserDraft()).toBeNull();
  });

  it("survives a new connection, as after a page reload", async () => {
    await saveBrowserDraft(sampleSchema(), { fromServerProject: false });
    // Re-inject the same factory to drop the cached connection.
    setDraftStorageFactory(factory);
    expect((await loadBrowserDraft())!.schema.name).toBe("shop");
  });

  it("discards corrupt or invalid records instead of restoring them", async () => {
    await saveBrowserDraft(sampleSchema(), { fromServerProject: false });
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open("erd-studio", 1);
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(
        { format: 1, schemaJSON: JSON.stringify({ version: 1, name: "", entities: "nope" }), savedAt: "x", fromServerProject: false },
        "current",
      );
      tx.oncomplete = () => resolve();
    });
    db.close();
    setDraftStorageFactory(factory);

    expect(await loadBrowserDraft()).toBeNull();
    // The invalid record was removed.
    setDraftStorageFactory(factory);
    expect(await loadBrowserDraft()).toBeNull();
  });

  it("degrades to a no-op when IndexedDB is unavailable", async () => {
    setDraftStorageFactory(null);
    expect(await saveBrowserDraft(sampleSchema(), { fromServerProject: false })).toBe(false);
    expect(await loadBrowserDraft()).toBeNull();
    expect(await clearBrowserDraft()).toBe(false);
  });

  it("degrades to a no-op when opening the database throws", async () => {
    setDraftStorageFactory({
      open: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(await saveBrowserDraft(sampleSchema(), { fromServerProject: false })).toBe(false);
    expect(await loadBrowserDraft()).toBeNull();
  });
});
