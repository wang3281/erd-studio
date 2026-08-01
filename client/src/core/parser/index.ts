import { tokenize } from "./tokenizer";
import { parse } from "./parser";
import { inferRelations } from "./inferRelations";
import type { ParseResult } from "../model/types";
import { createSchema } from "../model/factory";

export { tokenize } from "./tokenizer";

export function parseDDL(ddl: string): ParseResult {
  const tokens = tokenize(ddl);
  const { entities, relations, alters, foreignKeys, errors, warnings } = parse(tokens, ddl);

  const inferred = inferRelations(entities, relations);

  const schema = createSchema({ name: "Imported" });
  schema.entities = entities;
  schema.relations = [...relations, ...inferred];

  return { schema, alters, foreignKeys, errors, warnings };
}
