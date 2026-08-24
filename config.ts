import { parseYaml, stringifyYaml } from "obsidian";
import type { AutoArchiveConfig, BoardConfig, CardLink, TableColumn } from "./types";

export const DEFAULT_STATUS_FIELD = "Статус";
export const DEFAULT_ORDER_FIELD = "Порядок";
export const DEFAULT_BASE_TASK_FIELD = "BaseTask";

export function parseBoardConfig(source: string): BoardConfig {
  const raw = (parseYaml(source) ?? {}) as Record<string, any>;
  const asStringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const vocab: Record<string, string[]> = {};
  if (raw.vocab && typeof raw.vocab === "object") {
    for (const key of Object.keys(raw.vocab)) {
      const value = raw.vocab[key];
      vocab[key] = Array.isArray(value) ? value.map(String) : [];
    }
  }

  const cardRaw = raw.card && typeof raw.card === "object" ? raw.card : {};
  const tableRaw = raw.table && typeof raw.table === "object" ? raw.table : {};
  const tableColumns: TableColumn[] = Array.isArray(tableRaw.columns)
    ? tableRaw.columns
        .filter((column: any) => column && column.field)
        .map((column: any) => ({
          field: String(column.field),
          label: column.label ? String(column.label) : undefined,
        }))
    : [];
  const cardLinks: CardLink[] = Array.isArray(cardRaw.links)
    ? cardRaw.links
        .filter((link: any) => link && link.field)
        .map((link: any) => ({
          field: String(link.field),
          label: link.label ? String(link.label) : undefined,
        }))
    : [];
  const cardLabels: Record<string, string> =
    cardRaw.labels && typeof cardRaw.labels === "object"
      ? Object.fromEntries(Object.entries(cardRaw.labels).map(([key, value]) => [key, String(value)]))
      : {};

  const archiveRaw = raw.autoArchive && typeof raw.autoArchive === "object" ? raw.autoArchive : null;
  const afterDays = Number(archiveRaw?.afterDays);
  const autoArchive: AutoArchiveConfig | undefined =
    archiveRaw?.source && archiveRaw?.target && Number.isFinite(afterDays) && afterDays >= 0
      ? {
          source: String(archiveRaw.source),
          target: String(archiveRaw.target),
          afterDays,
          statusChangedField: archiveRaw.statusChangedField
            ? String(archiveRaw.statusChangedField)
            : "Статус изменён",
        }
      : undefined;

  return {
    tag: raw.tag ? String(raw.tag) : "",
    statusField: raw.statusField ? String(raw.statusField) : DEFAULT_STATUS_FIELD,
    orderField: raw.orderField ? String(raw.orderField) : DEFAULT_ORDER_FIELD,
    columns: asStringList(raw.columns),
    folder: raw.folder ? String(raw.folder) : undefined,
    template: raw.template ? String(raw.template) : undefined,
    nameField: raw.nameField ? String(raw.nameField) : undefined,
    exclude: asStringList(raw.exclude),
    facets: asStringList(raw.facets),
    vocab,
    single: asStringList(raw.single),
    meta: asStringList(raw.meta),
    coverField: raw.coverField ? String(raw.coverField) : undefined,
    showTags: raw.showTags !== false,
    flat: raw.flat === true,
    view: raw.view === "table" ? "table" : "kanban",
    table: { columns: tableColumns },
    raw: source,
    cardFields: asStringList(cardRaw.fields),
    cardLinks,
    cardLabels,
    cardRatingField: cardRaw.ratingField ? String(cardRaw.ratingField) : undefined,
    cardRecField: cardRaw.recField ? String(cardRaw.recField) : undefined,
    autoArchive,
    baseTaskField: raw.baseTaskField ? String(raw.baseTaskField) : DEFAULT_BASE_TASK_FIELD,
  };
}

export function serializeBoardConfig(cfg: BoardConfig): string {
  const obj: Record<string, any> = { tag: cfg.tag };
  if (cfg.folder) obj.folder = cfg.folder;
  if (cfg.template) obj.template = cfg.template;
  if (cfg.nameField) obj.nameField = cfg.nameField;
  if (cfg.exclude.length) obj.exclude = cfg.exclude;
  if (cfg.statusField !== DEFAULT_STATUS_FIELD) obj.statusField = cfg.statusField;
  if (cfg.orderField !== DEFAULT_ORDER_FIELD) obj.orderField = cfg.orderField;
  if (cfg.baseTaskField !== DEFAULT_BASE_TASK_FIELD) obj.baseTaskField = cfg.baseTaskField;
  if (!cfg.showTags) obj.showTags = false;
  if (cfg.flat) obj.flat = true;
  if (cfg.view === "table") obj.view = "table";
  if (cfg.coverField) obj.coverField = cfg.coverField;
  if (cfg.meta.length) obj.meta = cfg.meta;
  if (cfg.facets.length) obj.facets = cfg.facets;
  if (Object.keys(cfg.vocab).length) obj.vocab = cfg.vocab;
  if (cfg.single.length) obj.single = cfg.single;
  if (cfg.columns.length) obj.columns = cfg.columns;
  if (cfg.table.columns.length) {
    obj.table = {
      columns: cfg.table.columns.map((column) =>
        column.label ? { field: column.field, label: column.label } : { field: column.field }
      ),
    };
  }
  if (cfg.autoArchive) obj.autoArchive = cfg.autoArchive;

  const card: Record<string, any> = {};
  if (cfg.cardFields.length) card.fields = cfg.cardFields;
  if (cfg.cardLinks.length) {
    card.links = cfg.cardLinks.map((link) =>
      link.label ? { field: link.field, label: link.label } : { field: link.field }
    );
  }
  if (Object.keys(cfg.cardLabels).length) card.labels = cfg.cardLabels;
  if (cfg.cardRatingField) card.ratingField = cfg.cardRatingField;
  if (cfg.cardRecField) card.recField = cfg.cardRecField;
  if (Object.keys(card).length) obj.card = card;

  return stringifyYaml(obj).trimEnd();
}
