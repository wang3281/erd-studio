import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffPreviewModal } from "../DiffPreviewModal";
import { toggleHardDeleteId } from "../diffPreviewState";
import type { EntityDiff, RelationDiff, SchemaDiff } from "../../core/merge";
import { createColumn, createEntity, createSchema } from "../../core/model/factory";

function buildDiff(): SchemaDiff {
  const addedEntity = createEntity({
    name: "invoices",
    columns: [createColumn({ name: "id", type: "BIGINT", nullable: false, isPrimaryKey: true })],
  });
  const modifiedCurrent = createEntity({
    name: "users",
    columns: [createColumn({ name: "email", type: "VARCHAR(255)", nullable: false })],
  });
  const modifiedIncoming = {
    ...modifiedCurrent,
    columns: [createColumn({ name: "email", type: "TEXT", nullable: false })],
  };
  const removedEntity = createEntity({
    name: "orders",
    columns: [createColumn({ name: "id", type: "BIGINT", nullable: false, isPrimaryKey: true })],
  });

  const entities: EntityDiff[] = [
    {
      kind: "added",
      key: "invoices",
      displayName: "invoices",
      incomingEntity: addedEntity,
      columns: [{ kind: "added", incoming: addedEntity.columns[0] }],
    },
    {
      kind: "modified",
      key: "users",
      displayName: "users",
      currentEntity: modifiedCurrent,
      incomingEntity: modifiedIncoming,
      columns: [{
        kind: "modified",
        current: modifiedCurrent.columns[0],
        incoming: modifiedIncoming.columns[0],
        changedFields: ["type"],
      }],
    },
    {
      kind: "removed",
      key: "orders",
      displayName: "orders",
      currentEntity: removedEntity,
      columns: [{ kind: "removed", current: removedEntity.columns[0] }],
    },
  ];
  const relations: RelationDiff[] = [
    { kind: "added", key: "invoices.user_id->users.id|N:1" },
    { kind: "removed", key: "orders.user_id->users.id|N:1" },
  ];

  return {
    mode: "full",
    entities,
    relations,
    warnings: ["Duplicate table in DDL: \"users\" - only the first occurrence is used."],
    stats: {
      entitiesAdded: 1,
      entitiesModified: 1,
      entitiesRemoved: 1,
      entitiesUnchanged: 0,
      relationsAdded: 1,
      relationsRemoved: 1,
      relationsUnchanged: 0,
      relationsUnmapped: 0,
    },
  };
}

describe("DiffPreviewModal", () => {
  it("renders section counts and delete-from-canvas affordance", () => {
    const html = renderToStaticMarkup(
      <DiffPreviewModal
        current={createSchema({ name: "Current" })}
        incoming={createSchema({ name: "Incoming" })}
        diff={buildDiff()}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(html).toContain("Smart Merge");
    expect(html).toContain("Added (1)");
    expect(html).toContain("Modified (1)");
    expect(html).toContain("Removed (1)");
    expect(html).toMatch(/Relations \(\+1 \/ .1\)/);
    expect(html).toContain("Delete from canvas");
    expect(html).toContain("Apply Smart Merge");
  });

  it("toggles hard-delete ids without mutating the previous selection", () => {
    const initial = new Set(["orders"]);
    const removed = toggleHardDeleteId(initial, "orders");
    const added = toggleHardDeleteId(removed, "users");

    expect(initial.has("orders")).toBe(true);
    expect(removed.has("orders")).toBe(false);
    expect(added.has("users")).toBe(true);
  });

  it("renders partial-import removed protection without hard-delete affordance", () => {
    const diff = {
      ...buildDiff(),
      mode: "partial" as const,
    };
    const html = renderToStaticMarkup(
      <DiffPreviewModal
        current={createSchema({ name: "Current" })}
        incoming={createSchema({ name: "Incoming" })}
        diff={diff}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(html).toContain("Removed (1) - protected during partial import");
    expect(html).not.toContain("Delete from canvas");
  });

  it("replaces every relation-key delimiter before rendering", () => {
    const diff = {
      ...buildDiff(),
      relations: [{ kind: "added" as const, key: "invoices.user|region->users.id|N:1" }],
    };
    const html = renderToStaticMarkup(
      <DiffPreviewModal
        current={createSchema({ name: "Current" })}
        incoming={createSchema({ name: "Incoming" })}
        diff={diff}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(html).toContain("invoices.user  region-&gt;users.id  N:1");
    expect(html).not.toContain("invoices.user  region-&gt;users.id|N:1");
  });
});
