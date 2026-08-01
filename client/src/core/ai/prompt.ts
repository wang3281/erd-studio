import type { Entity, Relation } from "../model/types";

export function serializeSchemaForPrompt(
  entities: Entity[],
  relations: Relation[],
): string {
  const lines: string[] = [];

  for (const entity of entities) {
    const cols = entity.columns.map((c) => {
      const parts = [c.name, c.type];
      if (c.isPrimaryKey) parts.push("PK");
      if (c.isForeignKey) parts.push("FK");
      if (!c.nullable) parts.push("NOT NULL");
      return parts.join(" ");
    });
    const comment = entity.comment ? ` -- ${entity.comment}` : "";
    lines.push(`TABLE ${entity.name} (${cols.join(", ")})${comment}`);
  }

  if (relations.length > 0) {
    lines.push("");
    lines.push("EXISTING RELATIONS:");
    for (const rel of relations) {
      const src = entities.find((e) => e.id === rel.sourceEntityId);
      const tgt = entities.find((e) => e.id === rel.targetEntityId);
      if (!src || !tgt) continue;
      const srcCol = src.columns.find((c) => c.id === rel.sourceColumnId);
      const tgtCol = tgt.columns.find((c) => c.id === rel.targetColumnId);
      if (!srcCol || !tgtCol) continue;
      lines.push(
        `  ${src.name}.${srcCol.name} -> ${tgt.name}.${tgtCol.name} (${rel.cardinality})`,
      );
    }
  }

  return lines.join("\n");
}

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

export function buildPromptMessages(schemaText: string): PromptMessage[] {
  const system = `You are a database modeling expert. Analyze the given database schema and identify potential foreign key relationships that are NOT already listed in EXISTING RELATIONS.

Look for:
- Column naming patterns (e.g. user_id, dept_code matching another table's PK)
- Semantic relationships between tables based on domain knowledge
- Common FK patterns even when column names differ slightly

Rules:
- Do NOT suggest relations that already exist in EXISTING RELATIONS
- Only suggest relations between columns that actually exist in the schema
- Be conservative: only suggest relationships you are reasonably confident about
- Respond ONLY with valid JSON in the exact format specified`;

  const user = `Analyze this database schema and suggest missing foreign key relationships.

${schemaText}

Respond with this exact JSON format:
{
  "summary": "Brief summary of findings",
  "suggestions": [
    {
      "sourceEntityName": "child_table",
      "sourceColumnName": "fk_column",
      "targetEntityName": "parent_table",
      "targetColumnName": "pk_column",
      "cardinality": "N:1",
      "reasoning": "Why this relationship exists",
      "confidence": "high"
    }
  ]
}

cardinality must be one of: "1:1", "1:N", "N:1", "N:M"
confidence must be one of: "high", "medium", "low"
If no relationships are found, return an empty suggestions array.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
