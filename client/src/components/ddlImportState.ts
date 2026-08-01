import type { parseDDL } from "../core/parser/index";

type DDLPreview = ReturnType<typeof parseDDL>;

export function canApplyDDLImport(isEditor: boolean, preview: DDLPreview | null): boolean {
  return Boolean(
    isEditor &&
    preview &&
    preview.errors.length === 0 &&
    (preview.schema.entities.length > 0 || preview.alters.length > 0),
  );
}
