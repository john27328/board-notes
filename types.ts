import type { TFile } from "obsidian";

export interface CardLink {
  field: string;
  label?: string;
}

export interface AutoArchiveConfig {
  source: string;
  target: string;
  afterDays: number;
  statusChangedField: string;
}

export interface TableColumn {
  /** `__title` is a virtual column backed by `nameField`/`Название`. */
  field: string;
  label?: string;
}

export interface TableConfig {
  columns: TableColumn[];
}

export interface BoardConfig {
  tag: string;
  statusField: string;
  orderField: string;
  columns: string[];
  folder?: string;
  template?: string;
  nameField?: string;
  exclude: string[];
  facets: string[];
  vocab: Record<string, string[]>;
  single: string[];
  meta: string[];
  coverField?: string;
  showTags: boolean;
  flat: boolean;
  view: "kanban" | "table";
  table: TableConfig;
  raw: string;
  cardFields: string[];
  cardLinks: CardLink[];
  cardLabels: Record<string, string>;
  cardRatingField?: string;
  cardRecField?: string;
  autoArchive?: AutoArchiveConfig;
  baseTaskField: string;
}

export interface Card {
  file: TFile;
  fm: Record<string, any>;
  tags: string[];
}

export interface BoardState {
  hiddenColumns: Set<string>;
  activeTags: Set<string>;
  tagFilterMode: "include" | "exclude";
  activeFacets: Map<string, Set<string>>;
  facetFilterModes: Map<string, "include" | "exclude">;
  openEditor: string | null;
  searchQuery: string;
  onlyBaseTasks: boolean;
  view: "kanban" | "table";
  tableFilters: Map<string, string>;
  tableSort: { field: string; direction: "asc" | "desc" } | null;
  onSettings: (() => void) | null;
}

export interface MatchedBoard {
  cfg: BoardConfig;
  boardPath: string;
}

export interface BoardViewState {
  hiddenColumns: string[];
}
