import type { Cardinality, Column, Entity, ERDSchema } from "../model/types";

// DBML (dbdiagram.io) identifiers may be quoted when they contain characters
// outside the bare-identifier grammar.
function dbmlIdentifier(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeNote(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function columnLine(col: Column): string {
  const settings: string[] = [];
  if (col.isPrimaryKey) settings.push("pk");
  if (col.isAutoIncrement) settings.push("increment");
  if (!col.nullable && !col.isPrimaryKey) settings.push("not null");
  if (col.isUnique && !col.isPrimaryKey) settings.push("unique");
  if (col.defaultValue !== undefined && col.defaultValue !== "") {
    settings.push(`default: \`${col.defaultValue}\``);
  }
  if (col.comment) settings.push(`note: '${escapeNote(col.comment)}'`);
  const type = col.type.trim().length > 0 ? col.type.trim() : "unknown";
  const base = `  ${dbmlIdentifier(col.name)} ${type}`;
  return settings.length > 0 ? `${base} [${settings.join(", ")}]` : base;
}

// source:target cardinality → DBML ref operator (left = source, right = target).
function refOperator(cardinality: Cardinality): string {
  switch (cardinality) {
    case "1:1":
      return "-";
    case "1:N":
      return "<";
    case "N:1":
      return ">";
    case "N:M":
      return "<>";
  }
}

export function generateDBML(schema: ERDSchema): string {
  const blocks: string[] = [];

  for (const entity of schema.entities) {
    const lines = [`Table ${dbmlIdentifier(entity.name)} {`];
    for (const col of entity.columns) {
      lines.push(columnLine(col));
    }
    if (entity.comment) {
      lines.push(`  Note: '${escapeNote(entity.comment)}'`);
    }
    lines.push("}");
    blocks.push(lines.join("\n"));
  }

  const entityById = new Map<string, Entity>(schema.entities.map((e) => [e.id, e]));
  const refs: string[] = [];
  for (const rel of schema.relations) {
    const src = entityById.get(rel.sourceEntityId);
    const tgt = entityById.get(rel.targetEntityId);
    if (!src || !tgt) continue;
    const srcCol = src.columns.find((c) => c.id === rel.sourceColumnId);
    const tgtCol = tgt.columns.find((c) => c.id === rel.targetColumnId);
    if (!srcCol || !tgtCol) continue;
    refs.push(
      `Ref: ${dbmlIdentifier(src.name)}.${dbmlIdentifier(srcCol.name)} ${refOperator(rel.cardinality)} ${dbmlIdentifier(tgt.name)}.${dbmlIdentifier(tgtCol.name)}`,
    );
  }

  return [...blocks, ...refs].join("\n\n") + "\n";
}
