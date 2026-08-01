import type { Cardinality, Column, Entity, ERDSchema } from "../model/types";

// Mermaid erDiagram identifiers must be alphanumeric/underscore; anything else
// is replaced so the diagram still renders (e.g. on GitHub). Empty results fall
// back to a stable placeholder.
function safeIdentifier(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned : "unnamed";
}

// Attribute types render as a single token; whitespace would split the line.
function safeType(type: string): string {
  const cleaned = type.trim().replace(/\s+/g, "_");
  return cleaned.length > 0 ? cleaned : "unknown";
}

function attributeLine(col: Column): string {
  const keys: string[] = [];
  if (col.isPrimaryKey) keys.push("PK");
  if (col.isForeignKey) keys.push("FK");
  if (col.isUnique && !col.isPrimaryKey) keys.push("UK");
  const parts = [`    ${safeType(col.type)}`, safeIdentifier(col.name)];
  if (keys.length > 0) parts.push(keys.join(","));
  if (col.comment) parts.push(`"${col.comment.replace(/"/g, "'")}"`);
  return parts.join(" ");
}

// source:target cardinality → mermaid crow's-foot (source side, then target side).
function relationSymbol(cardinality: Cardinality): string {
  const [srcSide, tgtSide] = cardinality.split(":");
  // "1" is the one side; anything else ("N", or "M" in N:M) is a many side.
  const left = srcSide === "1" ? "||" : "}o";
  const right = tgtSide === "1" ? "||" : "o{";
  return `${left}--${right}`;
}

export function generateMermaid(schema: ERDSchema): string {
  const lines: string[] = ["erDiagram"];

  for (const entity of schema.entities) {
    lines.push(`  ${safeIdentifier(entity.name)} {`);
    for (const col of entity.columns) {
      lines.push(attributeLine(col));
    }
    lines.push("  }");
  }

  const entityById = new Map<string, Entity>(schema.entities.map((e) => [e.id, e]));
  for (const rel of schema.relations) {
    const src = entityById.get(rel.sourceEntityId);
    const tgt = entityById.get(rel.targetEntityId);
    if (!src || !tgt) continue;
    const srcCol = src.columns.find((c) => c.id === rel.sourceColumnId);
    const label = rel.name || (srcCol ? srcCol.name : "relates");
    lines.push(
      `  ${safeIdentifier(src.name)} ${relationSymbol(rel.cardinality)} ${safeIdentifier(tgt.name)} : "${label.replace(/"/g, "'")}"`,
    );
  }

  return lines.join("\n") + "\n";
}
