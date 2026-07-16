import {
  App,
  MarkdownPostProcessorContext,
  Modal,
  Plugin,
  TFile,
  parseYaml,
  stringifyYaml,
  Notice,
} from "obsidian";

interface CardLink {
  field: string;
  label?: string;
}

interface BoardConfig {
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
  showTags: boolean;
  flat: boolean;
  raw: string;
  // Centralized ```card``` display config — used by cards whose own
  // ```card``` block is empty, so the layout only has to be defined once
  // on the board instead of copy-pasted into every note/template.
  cardFields: string[];
  cardLinks: CardLink[];
  cardLabels: Record<string, string>;
  cardRatingField?: string;
  cardRecField?: string;
}

interface Card {
  file: TFile;
  fm: Record<string, any>;
  tags: string[];
}

interface BoardState {
  hiddenColumns: Set<string>;
  activeTags: Set<string>;
  activeFacets: Map<string, Set<string>>;
  openEditor: string | null;
  searchQuery: string;
}

interface MatchedBoard {
  cfg: BoardConfig;
  boardPath: string;
}

const DEFAULT_STATUS_FIELD = "Статус";
const DEFAULT_ORDER_FIELD = "Порядок";
const EMPTY_FACET_VALUE = " __bn_empty__";

interface BoardViewState {
  hiddenColumns: string[];
}

export default class BoardNotesPlugin extends Plugin {
  viewState: Record<string, BoardViewState> = {};

  async onload() {
    this.viewState = ((await this.loadData()) as Record<string, BoardViewState>) ?? {};

    this.registerMarkdownCodeBlockProcessor("board", (source, el, ctx) => {
      this.renderBoard(source, el, ctx);
    });

    this.registerMarkdownCodeBlockProcessor("tags", (source, el, ctx) => {
      this.renderInlineVocab(el, ctx);
    });

    this.registerMarkdownCodeBlockProcessor("card", (source, el, ctx) => {
      this.renderCard(source, el, ctx);
    });

    this.addCommand({
      id: "edit-vocab-fields",
      name: "Редактировать теги/жанры по словарю доски",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.openVocabEditorForFile(file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) return;
        menu.addItem((item) =>
          item
            .setTitle("Теги/жанры по словарю")
            .setIcon("tags")
            .onClick(() => this.openVocabEditorForFile(file))
        );
      })
    );

    this.addCommand({
      id: "create-new-board",
      name: "Создать новую доску",
      callback: () => new NewBoardModal(this.app, this).open(),
    });
  }

  async findVocabForFile(file: TFile): Promise<{
    vocab: Record<string, string[]>;
    single: string[];
    sources: { tag: string; boardPath: string }[];
  }> {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const inlineTags = (cache?.tags ?? []).map((t) => t.tag);
    const fmTagsRaw = fm.tags;
    const fmTags = Array.isArray(fmTagsRaw) ? fmTagsRaw : fmTagsRaw ? [fmTagsRaw] : [];
    const fileTags = [
      ...inlineTags,
      ...fmTags.map((t: string) => (t.startsWith("#") ? t : "#" + t)),
    ];

    const vocab: Record<string, string[]> = {};
    const single = new Set<string>();
    const sources: { tag: string; boardPath: string }[] = [];

    for (const f of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(f);
      const matches = content.matchAll(/```board\n([\s\S]*?)\n```/g);
      for (const m of matches) {
        const cfg = this.parseConfig(m[1]);
        if (!cfg.tag || !fileTags.includes(cfg.tag)) continue;
        sources.push({ tag: cfg.tag, boardPath: f.path });
        for (const key of Object.keys(cfg.vocab)) {
          vocab[key] = Array.from(new Set([...(vocab[key] ?? []), ...cfg.vocab[key]]));
        }
        cfg.single.forEach((s) => single.add(s));
      }
    }
    return { vocab, single: Array.from(single), sources };
  }

  fileTagsFor(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const inlineTags = (cache?.tags ?? []).map((t) => t.tag);
    const fmTagsRaw = fm.tags;
    const fmTags = Array.isArray(fmTagsRaw) ? fmTagsRaw : fmTagsRaw ? [fmTagsRaw] : [];
    return [
      ...inlineTags,
      ...fmTags.map((t: string) => (t.startsWith("#") ? t : "#" + t)),
    ];
  }

  async findMatchingBoardConfig(
    file: TFile,
    opts?: { excludeFlat?: boolean }
  ): Promise<MatchedBoard | null> {
    const fileTags = this.fileTagsFor(file);
    if (!fileTags.length) return null;

    for (const f of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(f);
      const matches = content.matchAll(/```board\n([\s\S]*?)\n```/g);
      for (const m of matches) {
        const cfg = this.parseConfig(m[1]);
        if (!cfg.tag || !fileTags.includes(cfg.tag)) continue;
        if (opts?.excludeFlat && cfg.flat) continue;
        return { cfg, boardPath: f.path };
      }
    }
    return null;
  }

  statusColumnsFor(cfg: BoardConfig, boardPath: string): string[] {
    return cfg.columns.length
      ? cfg.columns
      : Array.from(
          new Set(
            this.getCards(cfg, boardPath)
              .map((c) => c.fm[cfg.statusField])
              .filter(Boolean)
              .map((v) => String(v))
          )
        );
  }

  async openVocabEditorForFile(file: TFile) {
    const { vocab, single } = await this.findVocabForFile(file);
    if (!Object.keys(vocab).length) {
      new Notice("board-notes: не найдена доска со словарём для этой заметки");
      return;
    }
    new VocabModal(this.app, this, file, vocab, single).open();
  }

  renderInlineVocab(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const container = el.createDiv({ cls: "bn-inline-vocab" });

    const draw = async () => {
      container.empty();
      const { vocab, single, sources } = await this.findVocabForFile(file);
      if (!Object.keys(vocab).length) {
        container.createDiv({
          cls: "bn-error",
          text: "board-notes: не найдена доска со словарём для этого тега",
        });
        return;
      }

      const source = container.createDiv({ cls: "bn-vocab-source" });
      const boardNames = Array.from(new Set(sources.map((s) => s.boardPath)))
        .map((p) => p.split("/").pop()?.replace(/\.md$/, ""))
        .join(", ");
      const tagList = Array.from(new Set(sources.map((s) => s.tag))).join(", ");
      source.setText(`словарь: ${boardNames} · по тегу ${tagList}`);

      const panel = container.createDiv({ cls: "bn-edit-panel bn-edit-panel-inline" });
      this.renderVocabEditor(panel, file, vocab, single);
    };

    draw();

    const evtRef = this.app.metadataCache.on("changed", (changed) => {
      if (changed.path === file.path) draw();
    });
    this.registerEvent(evtRef);
  }

  renderCard(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const raw = (parseYaml(source) ?? {}) as Record<string, any>;
    const hasLocalFields = Array.isArray(raw.fields);
    const hasLocalLabels = raw.labels && typeof raw.labels === "object";
    const showStatus = raw.showStatus !== false;

    let board: MatchedBoard | null = null;

    const fields = (): string[] =>
      hasLocalFields
        ? raw.fields.map((f: any) => String(f))
        : board?.cfg.cardFields.length
        ? board.cfg.cardFields
        : ["Оценка", "Кинопоиск", "Описание", "Рекомендация"];

    const links = (): CardLink[] => {
      if (Array.isArray(raw.links)) {
        return raw.links
          .filter((l: any) => l && l.field)
          .map((l: any) => ({ field: String(l.field), label: l.label ? String(l.label) : undefined }));
      }
      if (raw.linkField) {
        const field = String(raw.linkField);
        return [{ field, label: raw.linkLabel ? String(raw.linkLabel) : undefined }];
      }
      if (board?.cfg.cardLinks.length) return board.cfg.cardLinks;
      return hasLocalFields ? [] : [{ field: "Кинопоиск" }];
    };

    const labels = (): Record<string, string> => {
      const local = hasLocalLabels
        ? Object.fromEntries(Object.entries(raw.labels).map(([k, v]) => [k, String(v)]))
        : {};
      return { ...(board?.cfg.cardLabels ?? {}), ...local };
    };

    const ratingField = () =>
      raw.ratingField ? String(raw.ratingField) : board?.cfg.cardRatingField ?? "Оценка";
    const recField = () =>
      raw.recField ? String(raw.recField) : board?.cfg.cardRecField ?? "Рекомендация";

    const container = el.createDiv({ cls: "bn-card-view" });

    const draw = () => {
      container.empty();
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const currentLabels = labels();
      const currentLinks = links();
      const linkFieldNames = new Set(currentLinks.map((l) => l.field));
      const rating = ratingField();
      const rec = recField();

      if (board) {
        const info = container.createDiv({ cls: "bn-card-board-info" });
        const boardName = board.boardPath.split("/").pop()?.replace(/\.md$/, "") ?? board.boardPath;
        const link = info.createSpan({ cls: "bn-card-board-link", text: boardName });
        link.addEventListener("click", () => {
          const boardFile = this.app.vault.getAbstractFileByPath(board!.boardPath);
          if (boardFile instanceof TFile) this.app.workspace.getLeaf(false).openFile(boardFile);
        });
        info.createSpan({ cls: "bn-card-board-tag", text: board.cfg.tag });
        const settingsBtn = info.createSpan({ cls: "bn-card-settings-btn", text: "⚙" });
        settingsBtn.setAttr("aria-label", "Настройки доски");
        settingsBtn.addEventListener("click", () => {
          new BoardSettingsModal(this.app, this, board!.cfg, board!.boardPath).open();
        });
      }

      if (showStatus && board && !board.cfg.flat) {
        const columns = this.statusColumnsFor(board.cfg, board.boardPath);
        if (columns.length) {
          const current = fm[board.cfg.statusField];
          const row = container.createDiv({ cls: "bn-card-status-row" });
          columns.forEach((col) => {
            const chip = row.createSpan({
              cls: "bn-chip bn-status-chip" + (col === current ? " active" : ""),
              text: col,
            });
            chip.addEventListener("click", async () => {
              if (col === current) return;
              await this.app.fileManager.processFrontMatter(file, (fm2) => {
                fm2[board!.cfg.statusField] = col;
              });
            });
          });
        }
      }

      if (currentLinks.length) {
        const row = container.createDiv({ cls: "bn-card-link-row" });
        currentLinks.forEach((linkCfg) => {
          const field = linkCfg.field;
          const value = fm[field];
          const hasValue = value != null && value !== "";
          const label =
            linkCfg.label ??
            (field === "Кинопоиск" ? "Открыть на Кинопоиске ↗" : `Открыть (${field}) ↗`);
          if (hasValue && typeof value === "string" && /^https?:\/\//.test(value)) {
            const item = row.createSpan({ cls: "bn-card-link-item" });
            item.createEl("a", { cls: "bn-card-link", text: label, href: value });
            const copyBtn = item.createSpan({ cls: "bn-card-link-copy", text: "⧉" });
            copyBtn.setAttr("aria-label", "Скопировать ссылку");
            copyBtn.addEventListener("click", async (e) => {
              e.preventDefault();
              e.stopPropagation();
              await navigator.clipboard.writeText(value);
              const prev = copyBtn.getText();
              copyBtn.setText("✓");
              setTimeout(() => copyBtn.setText(prev), 1000);
            });
            const editBtn = item.createSpan({ cls: "bn-card-link-edit", text: "✎" });
            this.makeFieldEditable(editBtn, file, field, String(value), false, draw);
          } else {
            const item = row.createSpan({ cls: "bn-card-link-item" });
            const placeholder = item.createSpan({
              cls: "bn-card-link bn-card-placeholder",
              text: `+ ${(currentLabels[field] ?? field).toLowerCase()}`,
            });
            this.makeFieldEditable(placeholder, file, field, "", false, draw);
          }
        });
      }

      fields().forEach((field) => {
        if (linkFieldNames.has(field)) return;
        const value = fm[field];
        const hasValue = value != null && value !== "";

        if (field === rating) {
          const el = container.createDiv({ cls: "bn-card-rating" });
          el.setText(hasValue ? `★ ${value}` : `+ ${(currentLabels[field] ?? field).toLowerCase()}`);
          if (!hasValue) el.addClass("bn-card-placeholder");
          this.makeFieldEditable(el, file, field, hasValue ? String(value) : "", false, draw);
          return;
        }

        if (field === rec) {
          const el = container.createDiv({ cls: "bn-card-rec" });
          el.setText(hasValue ? String(value) : `+ ${(currentLabels[field] ?? field).toLowerCase()}`);
          if (!hasValue) el.addClass("bn-card-placeholder");
          this.makeFieldEditable(el, file, field, hasValue ? String(value) : "", true, draw);
          return;
        }

        if (currentLabels[field]) {
          const meta = container.createDiv({ cls: "bn-card-labeled" });
          meta.createSpan({ cls: "bn-card-label", text: currentLabels[field] });
          const valueEl = meta.createSpan({
            cls: "bn-card-label-value",
            text: hasValue ? String(value) : "—",
          });
          if (!hasValue) valueEl.addClass("bn-card-placeholder");
          this.makeFieldEditable(valueEl, file, field, hasValue ? String(value) : "", false, draw);
          return;
        }

        const el = container.createDiv({ cls: "bn-card-desc" });
        el.setText(hasValue ? String(value) : `+ ${field.toLowerCase()}`);
        if (!hasValue) el.addClass("bn-card-placeholder");
        this.makeFieldEditable(el, file, field, hasValue ? String(value) : "", true, draw);
      });
    };

    draw();

    this.findMatchingBoardConfig(file).then((found) => {
      if (!found) return;
      board = found;
      draw();
    });

    const evtRef = this.app.metadataCache.on("changed", (changed) => {
      if (changed.path === file.path) draw();
      if (board && changed.path === board.boardPath) {
        this.findMatchingBoardConfig(file).then((found) => {
          board = found;
          draw();
        });
      }
    });
    this.registerEvent(evtRef);
  }

  makeFieldEditable(
    el: HTMLElement,
    file: TFile,
    field: string,
    currentValue: string,
    multiline: boolean,
    onCancel: () => void
  ) {
    el.addClass("bn-card-editable");
    el.setAttr("tabindex", "0");

    const startEdit = () => {
      if (el.querySelector("input,textarea")) return;
      el.empty();
      el.removeClass("bn-card-placeholder");

      const inputEl = multiline
        ? (el.createEl("textarea", { cls: "bn-card-edit-input" }) as HTMLTextAreaElement)
        : (el.createEl("input", { cls: "bn-card-edit-input", type: "text" }) as HTMLInputElement);
      inputEl.value = currentValue;
      inputEl.addEventListener("click", (e) => e.stopPropagation());
      inputEl.addEventListener("dragstart", (e) => e.stopPropagation());
      inputEl.focus();
      if (!multiline) (inputEl as HTMLInputElement).select();

      let settled = false;
      const save = async () => {
        if (settled) return;
        settled = true;
        const v = inputEl.value;
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          fm[field] = v;
        });
      };

      inputEl.addEventListener("blur", save);
      inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          inputEl.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          settled = true;
          onCancel();
        }
      });
    };

    el.addEventListener("click", startEdit);
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !el.querySelector("input,textarea")) {
        e.preventDefault();
        startEdit();
      }
    });
  }

  renderVocabEditor(
    panel: HTMLElement,
    file: TFile,
    vocab: Record<string, string[]>,
    single: string[] = [],
    onChange?: () => void
  ) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    Object.keys(vocab).forEach((field) => {
      if (!vocab[field].length) return;
      const isSingle = single.includes(field);
      const currentRaw = fm[field];
      const current = isSingle
        ? new Set(currentRaw != null && currentRaw !== "" ? [String(currentRaw)] : [])
        : new Set(this.fieldValues(fm, field));

      const fieldRow = panel.createDiv({ cls: "bn-edit-field" });
      fieldRow.createDiv({ cls: "bn-edit-field-label", text: field });
      const chipsRow = fieldRow.createDiv({ cls: "bn-edit-chips" });
      const sorted = [...vocab[field]].sort((a, b) => {
        const aActive = current.has(a) ? 0 : 1;
        const bActive = current.has(b) ? 0 : 1;
        return aActive - bActive;
      });
      sorted.forEach((opt) => {
        const chip = chipsRow.createSpan({
          cls: "bn-chip" + (current.has(opt) ? " active" : ""),
          text: opt,
        });
        chip.setAttr("draggable", "false");
        chip.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (isSingle) {
            await this.setSingleValue(file, field, opt, current.has(opt));
          } else {
            await this.toggleFieldValue(file, field, opt);
          }
          onChange?.();
        });
      });
    });
  }

  async setSingleValue(file: TFile, field: string, value: string, alreadyActive: boolean) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[field] = alreadyActive ? "" : value;
    });
  }

  parseConfig(source: string): BoardConfig {
    const raw = (parseYaml(source) ?? {}) as Record<string, any>;
    const columns = Array.isArray(raw.columns)
      ? raw.columns.map((c: any) => String(c))
      : [];
    const exclude = Array.isArray(raw.exclude)
      ? raw.exclude.map((e: any) => String(e))
      : raw.exclude
      ? [String(raw.exclude)]
      : [];
    const facets = Array.isArray(raw.facets)
      ? raw.facets.map((f: any) => String(f))
      : raw.facets
      ? [String(raw.facets)]
      : [];
    const vocab: Record<string, string[]> = {};
    if (raw.vocab && typeof raw.vocab === "object") {
      for (const key of Object.keys(raw.vocab)) {
        const v = raw.vocab[key];
        vocab[key] = Array.isArray(v) ? v.map((x: any) => String(x)) : [];
      }
    }
    const single = Array.isArray(raw.single)
      ? raw.single.map((f: any) => String(f))
      : raw.single
      ? [String(raw.single)]
      : [];
    const meta = Array.isArray(raw.meta)
      ? raw.meta.map((f: any) => String(f))
      : raw.meta
      ? [String(raw.meta)]
      : [];

    const cardRaw = raw.card && typeof raw.card === "object" ? raw.card : {};
    const cardFields = Array.isArray(cardRaw.fields)
      ? cardRaw.fields.map((f: any) => String(f))
      : [];
    const cardLinks: CardLink[] = Array.isArray(cardRaw.links)
      ? cardRaw.links
          .filter((l: any) => l && l.field)
          .map((l: any) => ({
            field: String(l.field),
            label: l.label ? String(l.label) : undefined,
          }))
      : [];
    const cardLabels: Record<string, string> =
      cardRaw.labels && typeof cardRaw.labels === "object"
        ? Object.fromEntries(
            Object.entries(cardRaw.labels).map(([k, v]) => [k, String(v)])
          )
        : {};

    return {
      tag: raw.tag ? String(raw.tag) : "",
      statusField: raw.statusField ? String(raw.statusField) : DEFAULT_STATUS_FIELD,
      orderField: raw.orderField ? String(raw.orderField) : DEFAULT_ORDER_FIELD,
      columns,
      folder: raw.folder ? String(raw.folder) : undefined,
      template: raw.template ? String(raw.template) : undefined,
      nameField: raw.nameField ? String(raw.nameField) : undefined,
      exclude,
      facets,
      vocab,
      single,
      meta,
      showTags: raw.showTags === false ? false : true,
      flat: raw.flat === true,
      raw: source,
      cardFields,
      cardLinks,
      cardLabels,
      cardRatingField: cardRaw.ratingField ? String(cardRaw.ratingField) : undefined,
      cardRecField: cardRaw.recField ? String(cardRaw.recField) : undefined,
    };
  }

  fieldValues(fm: Record<string, any>, field: string): string[] {
    const v = fm[field];
    if (v == null) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((x) => String(x)).filter((x) => x.length > 0);
  }

  getCards(cfg: BoardConfig, sourcePath: string): Card[] {
    const files = this.app.vault.getMarkdownFiles();
    const result: Card[] = [];

    for (const file of files) {
      if (file.path === sourcePath) continue;
      if (cfg.exclude.includes(file.path)) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;
      const fm = cache.frontmatter ?? {};

      const inlineTags = (cache.tags ?? []).map((t) => t.tag);
      const fmTagsRaw = fm.tags;
      const fmTags = Array.isArray(fmTagsRaw)
        ? fmTagsRaw
        : fmTagsRaw
        ? [fmTagsRaw]
        : [];
      const allTags = [
        ...inlineTags,
        ...fmTags.map((t: string) => (t.startsWith("#") ? t : "#" + t)),
      ];

      if (cfg.tag && !allTags.includes(cfg.tag)) continue;
      result.push({ file, fm, tags: allTags });
    }
    return result;
  }

  renderBoard(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    let cfg = this.parseConfig(source);
    const container = el.createDiv({ cls: "board-notes" });

    if (!cfg.tag) {
      container.createDiv({
        cls: "bn-error",
        text: "board: укажи tag в конфиге блока, например tag: \"#series\"",
      });
      return;
    }

    const state: BoardState = {
      hiddenColumns: new Set(),
      activeTags: new Set(),
      activeFacets: new Map(),
      openEditor: null,
      searchQuery: "",
    };
    const loadHidden = () => {
      const viewKey = `${ctx.sourcePath}::${cfg.tag}`;
      state.hiddenColumns = new Set(this.viewState[viewKey]?.hiddenColumns ?? []);
    };
    loadHidden();

    const openSettings = () => {
      new BoardSettingsModal(this.app, this, cfg, ctx.sourcePath).open();
    };

    const redraw = () => this.draw(container, cfg, state, ctx.sourcePath, openSettings);
    redraw();

    const evtRef = this.app.metadataCache.on("changed", async (changed) => {
      if (changed.path === ctx.sourcePath) {
        const fresh = await this.app.vault.cachedRead(changed);
        const matches = Array.from(fresh.matchAll(/```board\n([\s\S]*?)\n```/g));
        const match = matches
          .map((m) => this.parseConfig(m[1]))
          .find((c) => c.tag === cfg.tag);
        if (match) {
          cfg = match;
          loadHidden();
        }
      }
      redraw();
    });
    this.registerEvent(evtRef);

    const deleteRef = this.app.vault.on("delete", redraw);
    this.registerEvent(deleteRef);
  }

  draw(container: HTMLElement, cfg: BoardConfig, state: BoardState, sourcePath: string, onSettings?: () => void) {
    container.empty();

    const allCards = this.getCards(cfg, sourcePath);

    const otherTags = new Set<string>();
    allCards.forEach((c) =>
      c.tags.forEach((t) => {
        if (t !== cfg.tag) otherTags.add(t);
      })
    );

    const facetValues = new Map<string, Set<string>>();
    cfg.facets.forEach((f) => {
      const values = new Set<string>();
      let hasEmpty = false;
      allCards.forEach((c) => {
        const v = this.fieldValues(c.fm, f);
        if (v.length) v.forEach((x) => values.add(x));
        else hasEmpty = true;
      });
      if (hasEmpty) values.add(EMPTY_FACET_VALUE);
      facetValues.set(f, values);
    });

    const query = state.searchQuery.trim().toLowerCase();

    const cards = allCards.filter((c) => {
      if (state.activeTags.size && !c.tags.some((t) => state.activeTags.has(t))) {
        return false;
      }
      for (const [field, active] of state.activeFacets) {
        if (!active.size) continue;
        const values = this.fieldValues(c.fm, field);
        const matchesEmpty = values.length === 0 && active.has(EMPTY_FACET_VALUE);
        if (!matchesEmpty && !values.some((v) => active.has(v))) return false;
      }
      if (query) {
        const title = String(
          (cfg.nameField && c.fm[cfg.nameField]) || c.fm["Название"] || c.file.basename
        );
        const haystack = [
          title,
          c.fm["Описание"],
          c.fm["описание"],
          c.fm["Рекомендация"],
          c.fm["рекомендация"],
          ...c.tags,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    const columns = cfg.flat
      ? []
      : cfg.columns.length
      ? cfg.columns
      : Array.from(
          new Set(allCards.map((c) => c.fm[cfg.statusField]).filter(Boolean))
        );

    this.drawToolbar(
      container,
      cfg,
      state,
      columns,
      otherTags,
      facetValues,
      sourcePath,
      cards.length,
      allCards.length,
      onSettings
    );

    if (cfg.flat) {
      this.drawFlatGrid(container, cfg, state, cards, sourcePath);
      return;
    }

    const board = container.createDiv({ cls: "bn-board" });

    for (const col of columns) {
      if (state.hiddenColumns.has(col)) continue;
      this.drawColumn(board, container, cfg, state, col, cards, sourcePath);
    }
  }

  drawFlatGrid(
    container: HTMLElement,
    cfg: BoardConfig,
    state: BoardState,
    cards: Card[],
    sourcePath: string
  ) {
    const grid = container.createDiv({ cls: "bn-flat-grid" });
    cards.forEach((c) =>
      this.renderCardEl(grid, cfg, state, c, container, sourcePath, false)
    );

    const addBtn = container.createDiv({ cls: "bn-add bn-add-flat", text: "+ добавить" });
    addBtn.addEventListener("click", () => this.createCard(cfg, cards));
  }

  drawToolbar(
    container: HTMLElement,
    cfg: BoardConfig,
    state: BoardState,
    columns: string[],
    otherTags: Set<string>,
    facetValues: Map<string, Set<string>>,
    sourcePath: string,
    matched: number,
    total: number,
    onSettings?: () => void
  ) {
    const toolbar = container.createDiv({ cls: "bn-toolbar" });

    const searchRow = toolbar.createDiv({ cls: "bn-row bn-search-row" });

    if (onSettings) {
      const settingsBtn = searchRow.createDiv({ cls: "bn-settings-btn", text: "⚙" });
      settingsBtn.setAttr("aria-label", "Настройки доски");
      settingsBtn.addEventListener("click", onSettings);
    }

    const searchInput = searchRow.createEl("input", {
      cls: "bn-search-input",
      type: "text",
      placeholder: "Поиск по названию, описанию, тегам…",
    });
    searchInput.value = state.searchQuery;
    searchRow.createSpan({
      cls: "bn-search-count",
      text: state.searchQuery ? `${matched} / ${total}` : `${total}`,
    });
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = (e.target as HTMLInputElement).value;
      const caret = (e.target as HTMLInputElement).selectionStart;
      this.draw(container, cfg, state, sourcePath);
      const newInput = container.querySelector(
        ".bn-search-input"
      ) as HTMLInputElement | null;
      if (newInput) {
        newInput.focus();
        if (caret != null) newInput.setSelectionRange(caret, caret);
      }
    });

    if (cfg.showTags && otherTags.size) {
      const tagRow = toolbar.createDiv({ cls: "bn-row" });
      tagRow.createSpan({ cls: "bn-row-label", text: "Теги" });
      Array.from(otherTags)
        .sort()
        .forEach((tag) => {
          const chip = tagRow.createSpan({
            cls: "bn-chip" + (state.activeTags.has(tag) ? " active" : ""),
            text: tag,
          });
          chip.addEventListener("click", () => {
            if (state.activeTags.has(tag)) state.activeTags.delete(tag);
            else state.activeTags.add(tag);
            this.draw(container, cfg, state, sourcePath);
          });
        });
      if (state.activeTags.size) {
        const clear = tagRow.createSpan({ cls: "bn-chip bn-chip-clear", text: "×" });
        clear.addEventListener("click", () => {
          state.activeTags.clear();
          this.draw(container, cfg, state, sourcePath);
        });
      }
    }

    for (const field of cfg.facets) {
      const values = facetValues.get(field);
      if (!values || !values.size) continue;

      if (!state.activeFacets.has(field)) state.activeFacets.set(field, new Set());
      const active = state.activeFacets.get(field)!;

      const row = toolbar.createDiv({ cls: "bn-row" });
      row.createSpan({ cls: "bn-row-label", text: field });
      Array.from(values)
        .sort((a, b) =>
          a === EMPTY_FACET_VALUE ? -1 : b === EMPTY_FACET_VALUE ? 1 : a.localeCompare(b)
        )
        .forEach((val) => {
          const isEmpty = val === EMPTY_FACET_VALUE;
          const chip = row.createSpan({
            cls:
              "bn-chip" +
              (active.has(val) ? " active" : "") +
              (isEmpty ? " bn-chip-empty" : ""),
            text: isEmpty ? "пусто" : val,
          });
          chip.addEventListener("click", () => {
            if (active.has(val)) active.delete(val);
            else active.add(val);
            this.draw(container, cfg, state, sourcePath);
          });
        });
      if (active.size) {
        const clear = row.createSpan({ cls: "bn-chip bn-chip-clear", text: "×" });
        clear.addEventListener("click", () => {
          active.clear();
          this.draw(container, cfg, state, sourcePath);
        });
      }
    }

    if (!cfg.flat && columns.length) {
    const colRow = toolbar.createDiv({ cls: "bn-row" });
    colRow.createSpan({ cls: "bn-row-label", text: "Колонки" });
    columns.forEach((col) => {
      const hidden = state.hiddenColumns.has(col);
      const chip = colRow.createSpan({
        cls: "bn-chip" + (hidden ? " bn-chip-off" : " active"),
        text: col,
      });
      chip.addEventListener("click", () => {
        if (hidden) state.hiddenColumns.delete(col);
        else state.hiddenColumns.add(col);
        this.persistHiddenColumns(sourcePath, cfg.tag, state.hiddenColumns);
        this.draw(container, cfg, state, sourcePath);
      });
    });
    }
  }

  async persistHiddenColumns(sourcePath: string, tag: string, hidden: Set<string>) {
    const key = `${sourcePath}::${tag}`;
    this.viewState[key] = { hiddenColumns: Array.from(hidden) };
    await this.saveData(this.viewState);
  }

  renderCardEl(
    parent: HTMLElement,
    cfg: BoardConfig,
    state: BoardState,
    c: Card,
    container: HTMLElement,
    sourcePath: string,
    draggable: boolean
  ): HTMLElement {
    const card = parent.createDiv({ cls: "bn-card" });
    card.draggable = draggable;
    card.dataset.path = c.file.path;

    const title =
      (cfg.nameField && c.fm[cfg.nameField]) ||
      c.fm["Название"] ||
      c.file.basename;
    card.createDiv({ cls: "bn-card-title", text: String(title) });

    const metaBits: string[] = [];
    if (cfg.meta.length) {
      cfg.meta.forEach((field) => {
        const v = c.fm[field];
        if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
        const display = Array.isArray(v) ? v.map(String).join(", ") : String(v);
        metaBits.push(field === "Оценка" || field === "оценка" ? `★ ${display}` : display);
      });
    } else {
      const year = c.fm["Год выпуска"] || c.fm["Год"];
      if (year) metaBits.push(String(year));
      if (c.fm["Оценка"]) metaBits.push("★ " + c.fm["Оценка"]);
    }
    if (metaBits.length) {
      card.createDiv({ cls: "bn-card-meta", text: metaBits.join(" · ") });
    }

    const vocabFields = Object.keys(cfg.vocab).filter((f) => cfg.vocab[f].length);
    if (vocabFields.length) {
      const boardTagValue = cfg.tag.replace(/^#/, "");
      const currentValues: string[] = [];
      vocabFields.forEach((f) => {
        const vals = cfg.single.includes(f)
          ? c.fm[f] != null && c.fm[f] !== ""
            ? [String(c.fm[f])]
            : []
          : this.fieldValues(c.fm, f);
        currentValues.push(...vals.filter((v) => v !== boardTagValue));
      });
      if (currentValues.length) {
        const tagsRow = card.createDiv({ cls: "bn-card-tags-display" });
        currentValues.forEach((v) => {
          tagsRow.createSpan({ cls: "bn-card-tag-chip", text: v });
        });
      }

      const isOpen = state.openEditor === c.file.path;
      const editLabel = vocabFields.map((f) => f.toLowerCase()).join(" / ");

      const editBtn = card.createDiv({
        cls: "bn-edit-toggle",
        text: isOpen ? "✕ закрыть" : `✎ ${editLabel}`,
      });
      editBtn.setAttr("draggable", "false");
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.openEditor = isOpen ? null : c.file.path;
        this.draw(container, cfg, state, sourcePath);
      });

      if (isOpen) {
        const panel = card.createDiv({ cls: "bn-edit-panel" });
        panel.setAttr("draggable", "false");
        panel.addEventListener("click", (e) => e.stopPropagation());
        this.renderVocabEditor(panel, c.file, cfg.vocab, cfg.single);
      }
    }

    card.addEventListener("click", () => {
      this.app.workspace.getLeaf(false).openFile(c.file);
    });

    if (draggable) {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", c.file.path);
        card.addClass("dragging");
      });
      card.addEventListener("dragend", () => card.removeClass("dragging"));
    }

    return card;
  }

  drawColumn(
    board: HTMLElement,
    container: HTMLElement,
    cfg: BoardConfig,
    state: BoardState,
    col: string,
    cards: Card[],
    sourcePath: string
  ) {
    const colEl = board.createDiv({ cls: "bn-column" });

    const header = colEl.createDiv({ cls: "bn-column-header" });
    header.createSpan({ text: col });

    const colCards = cards
      .filter((c) => (c.fm[cfg.statusField] ?? "") === col)
      .sort(
        (a, b) =>
          (Number(a.fm[cfg.orderField]) || 9999) -
          (Number(b.fm[cfg.orderField]) || 9999)
      );

    header.createSpan({ cls: "bn-count", text: String(colCards.length) });

    const list = colEl.createDiv({ cls: "bn-list" });

    colCards.forEach((c) =>
      this.renderCardEl(list, cfg, state, c, container, sourcePath, true)
    );

    const addBtn = colEl.createDiv({ cls: "bn-add", text: "+ добавить" });
    addBtn.addEventListener("click", () => this.createCard(cfg, cards, col));

    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = container.querySelector(
        ".bn-card.dragging"
      ) as HTMLElement | null;
      if (!dragging) return;
      const after = this.getDragAfterElement(list, e.clientY);
      if (after == null) list.appendChild(dragging);
      else list.insertBefore(dragging, after);
    });

    list.addEventListener("dragenter", () => list.addClass("bn-dragover"));
    list.addEventListener("dragleave", (e) => {
      if (!list.contains(e.relatedTarget as Node)) {
        list.removeClass("bn-dragover");
      }
    });

    list.addEventListener("drop", async (e) => {
      e.preventDefault();
      list.removeClass("bn-dragover");
      await this.persistColumn(list, cfg, col);
    });
  }

  getDragAfterElement(list: HTMLElement, y: number): HTMLElement | null {
    const cards = Array.from(
      list.querySelectorAll<HTMLElement>(".bn-card:not(.dragging)")
    );
    let closest: { offset: number; el: HTMLElement | null } = {
      offset: -Infinity,
      el: null,
    };
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, el: card };
      }
    }
    return closest.el;
  }

  async toggleFieldValue(file: TFile, field: string, value: string) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const current: string[] = Array.isArray(fm[field])
        ? fm[field].map((x: any) => String(x))
        : fm[field]
        ? [String(fm[field])]
        : [];
      const idx = current.indexOf(value);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(value);
      fm[field] = current;
    });
  }

  async persistColumn(list: HTMLElement, cfg: BoardConfig, status: string) {
    const cardEls = Array.from(list.querySelectorAll<HTMLElement>(".bn-card"));
    for (let i = 0; i < cardEls.length; i++) {
      const path = cardEls[i].dataset.path;
      if (!path) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[cfg.statusField] = status;
        fm[cfg.orderField] = i + 1;
      });
    }
  }

  nextOrder(cfg: BoardConfig, cards: Card[], status?: string): number {
    const relevant = status
      ? cards.filter((c) => (c.fm[cfg.statusField] ?? "") === status)
      : cards;
    const maxOrder = relevant.reduce((max, c) => {
      const v = Number(c.fm[cfg.orderField]);
      return Number.isFinite(v) && v > max ? v : max;
    }, 0);
    return maxOrder + 1;
  }

  setFrontmatterField(content: string, field: string, value: string): string {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const fieldLineRe = new RegExp(`^${field}:.*$`, "m");

    if (!fmMatch) {
      return `---\n${field}: ${value}\n---\n${content}`;
    }

    if (fieldLineRe.test(fmMatch[1])) {
      return content.replace(
        new RegExp(`^(${field}:).*$`, "m"),
        `$1 ${value}`
      );
    }

    return content.replace(/^---\n/, `---\n${field}: ${value}\n`);
  }

  async createCard(cfg: BoardConfig, cards: Card[], status?: string) {
    const folder = cfg.folder ?? "/";
    const base = "Новая заметка";
    let name = base;
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
      n += 1;
      name = `${base} ${n}`;
    }
    const path = `${folder}/${name}.md`;

    let content = status
      ? `---\n${cfg.statusField}: ${status}\n---\n${cfg.tag}\n`
      : `---\n---\n${cfg.tag}\n`;

    if (cfg.template) {
      const tpl = this.app.vault.getAbstractFileByPath(cfg.template);
      if (tpl instanceof TFile) {
        const tplContent = await this.app.vault.read(tpl);
        if (status) {
          const statusLineRe = new RegExp(`^${cfg.statusField}:.*$`, "m");
          content = statusLineRe.test(tplContent)
            ? tplContent.replace(statusLineRe, `${cfg.statusField}: ${status}`)
            : tplContent;
        } else {
          content = tplContent;
        }
      } else {
        new Notice(`board-notes: шаблон не найден — ${cfg.template}`);
      }
    }

    const order = this.nextOrder(cfg, cards, status);
    content = this.setFrontmatterField(content, cfg.orderField, String(order));

    try {
      const file = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice("board-notes: не удалось создать заметку — " + e);
    }
  }

  serializeConfig(cfg: BoardConfig): string {
    const obj: Record<string, any> = { tag: cfg.tag };
    if (cfg.folder) obj.folder = cfg.folder;
    if (cfg.template) obj.template = cfg.template;
    if (cfg.nameField) obj.nameField = cfg.nameField;
    if (cfg.exclude.length) obj.exclude = cfg.exclude;
    if (cfg.statusField !== DEFAULT_STATUS_FIELD) obj.statusField = cfg.statusField;
    if (cfg.orderField !== DEFAULT_ORDER_FIELD) obj.orderField = cfg.orderField;
    if (cfg.showTags === false) obj.showTags = false;
    if (cfg.flat) obj.flat = true;
    if (cfg.meta.length) obj.meta = cfg.meta;
    if (cfg.facets.length) obj.facets = cfg.facets;
    if (Object.keys(cfg.vocab).length) obj.vocab = cfg.vocab;
    if (cfg.single.length) obj.single = cfg.single;
    if (cfg.columns.length) obj.columns = cfg.columns;

    const card: Record<string, any> = {};
    if (cfg.cardFields.length) card.fields = cfg.cardFields;
    if (cfg.cardLinks.length) {
      card.links = cfg.cardLinks.map((l) =>
        l.label ? { field: l.field, label: l.label } : { field: l.field }
      );
    }
    if (Object.keys(cfg.cardLabels).length) card.labels = cfg.cardLabels;
    if (cfg.cardRatingField) card.ratingField = cfg.cardRatingField;
    if (cfg.cardRecField) card.recField = cfg.cardRecField;
    if (Object.keys(card).length) obj.card = card;

    return stringifyYaml(obj).trimEnd();
  }

  async saveBoardConfig(boardPath: string, oldRaw: string, cfg: BoardConfig): Promise<string> {
    const newRaw = this.serializeConfig(cfg);
    const file = this.app.vault.getAbstractFileByPath(boardPath);
    if (!(file instanceof TFile)) throw new Error(`Файл не найден: ${boardPath}`);
    const content = await this.app.vault.read(file);
    const needle = "```board\n" + oldRaw + "\n```";
    if (!content.includes(needle)) {
      throw new Error("Не удалось найти исходный блок доски для замены (он уже изменился?)");
    }
    const updated = content.replace(needle, "```board\n" + newRaw + "\n```");
    await this.app.vault.modify(file, updated);
    return newRaw;
  }

  async renameStatusAcrossCards(cfg: BoardConfig, boardPath: string, oldValue: string, newValue: string): Promise<number> {
    const cards = this.getCards(cfg, boardPath);
    let n = 0;
    for (const c of cards) {
      if (String(c.fm[cfg.statusField] ?? "") === oldValue) {
        await this.app.fileManager.processFrontMatter(c.file, (fm) => {
          fm[cfg.statusField] = newValue;
        });
        n++;
      }
    }
    return n;
  }

  async renameVocabValueAcrossCards(cfg: BoardConfig, boardPath: string, field: string, oldValue: string, newValue: string): Promise<number> {
    const cards = this.getCards(cfg, boardPath);
    const isSingle = cfg.single.includes(field);
    let n = 0;
    for (const c of cards) {
      const v = c.fm[field];
      if (isSingle) {
        if (String(v ?? "") === oldValue) {
          await this.app.fileManager.processFrontMatter(c.file, (fm) => {
            fm[field] = newValue;
          });
          n++;
        }
      } else {
        const arr = Array.isArray(v) ? v.map(String) : v != null && v !== "" ? [String(v)] : [];
        if (arr.includes(oldValue)) {
          await this.app.fileManager.processFrontMatter(c.file, (fm) => {
            fm[field] = arr.map((x) => (x === oldValue ? newValue : x));
          });
          n++;
        }
      }
    }
    return n;
  }
}

class VocabModal extends Modal {
  constructor(
    app: App,
    private plugin: BoardNotesPlugin,
    private file: TFile,
    private vocab: Record<string, string[]>,
    private single: string[] = []
  ) {
    super(app);
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bn-vocab-modal");
    contentEl.createEl("h3", { text: `Теги и жанры — ${this.file.basename}` });
    const panel = contentEl.createDiv({ cls: "bn-edit-panel bn-edit-panel-modal" });
    this.plugin.renderVocabEditor(panel, this.file, this.vocab, this.single, () => this.render());
  }

  onClose() {
    this.contentEl.empty();
  }
}

interface EditableRow {
  original: string; // "" for a freshly-added row
  input: HTMLInputElement;
  row: HTMLElement;
  deleted: boolean;
}

interface PairRow {
  fieldInput: HTMLInputElement;
  labelInput: HTMLInputElement;
  row: HTMLElement;
  deleted: boolean;
}

class BoardSettingsModal extends Modal {
  private folderInput!: HTMLInputElement;
  private templateInput!: HTMLInputElement;
  private columnRows: EditableRow[] = [];
  private vocabRows: Map<string, EditableRow[]> = new Map();
  private vocabFieldOrder: string[] = [];
  private cardFieldRows: EditableRow[] = [];
  private metaRows: EditableRow[] = [];
  private cardLinkRows: PairRow[] = [];
  private cardLabelRows: PairRow[] = [];

  constructor(
    app: App,
    private plugin: BoardNotesPlugin,
    private cfg: BoardConfig,
    private boardPath: string
  ) {
    super(app);
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  private addMoveButtons(row: HTMLElement) {
    const up = row.createSpan({ cls: "bn-settings-move", text: "↑" });
    up.setAttr("aria-label", "Переместить выше");
    up.addEventListener("click", () => {
      const prev = row.previousElementSibling;
      if (prev) row.parentElement!.insertBefore(row, prev);
    });
    const down = row.createSpan({ cls: "bn-settings-move", text: "↓" });
    down.setAttr("aria-label", "Переместить ниже");
    down.addEventListener("click", () => {
      const next = row.nextElementSibling;
      if (next) row.parentElement!.insertBefore(next, row);
    });
  }

  // Rows are appended in creation order, but drag-free reordering (↑/↓)
  // only moves the DOM node — read this to get the order the user set.
  private byDomOrder<T extends { row: HTMLElement }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const parent = a.row.parentElement;
      if (!parent) return 0;
      const children = Array.from(parent.children);
      return children.indexOf(a.row) - children.indexOf(b.row);
    });
  }

  private makeEditableList(
    container: HTMLElement,
    values: string[],
    onDelete: (row: EditableRow) => void
  ): EditableRow[] {
    const rows: EditableRow[] = [];
    const list = container.createDiv({ cls: "bn-settings-list" });

    const addRow = (value: string) => {
      const row = list.createDiv({ cls: "bn-settings-row" });
      const input = row.createEl("input", { type: "text", value }) as HTMLInputElement;
      this.addMoveButtons(row);
      const del = row.createSpan({ cls: "bn-settings-del", text: "×" });
      const entry: EditableRow = { original: value, input, row, deleted: false };
      del.addEventListener("click", () => {
        entry.deleted = true;
        row.style.display = "none";
        onDelete(entry);
      });
      rows.push(entry);
      return entry;
    };

    values.forEach((v) => addRow(v));

    const addBtn = container.createDiv({ cls: "bn-settings-add", text: "+ добавить" });
    addBtn.addEventListener("click", () => addRow(""));

    return rows;
  }

  private makePairList(
    container: HTMLElement,
    pairs: { field: string; label: string }[],
    fieldPlaceholder: string,
    labelPlaceholder: string
  ): PairRow[] {
    const rows: PairRow[] = [];
    const list = container.createDiv({ cls: "bn-settings-list" });

    const addRow = (field: string, label: string) => {
      const row = list.createDiv({ cls: "bn-settings-row" });
      const fieldInput = row.createEl("input", {
        type: "text",
        value: field,
        placeholder: fieldPlaceholder,
      }) as HTMLInputElement;
      const labelInput = row.createEl("input", {
        type: "text",
        value: label,
        placeholder: labelPlaceholder,
      }) as HTMLInputElement;
      this.addMoveButtons(row);
      const del = row.createSpan({ cls: "bn-settings-del", text: "×" });
      const entry: PairRow = { fieldInput, labelInput, row, deleted: false };
      del.addEventListener("click", () => {
        entry.deleted = true;
        row.style.display = "none";
      });
      rows.push(entry);
      return entry;
    };

    pairs.forEach((p) => addRow(p.field, p.label));

    const addBtn = container.createDiv({ cls: "bn-settings-add", text: "+ добавить" });
    addBtn.addEventListener("click", () => addRow("", ""));

    return rows;
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bn-settings-modal");

    contentEl.createEl("h3", { text: `Настройки доски — ${this.cfg.tag}` });
    contentEl.createEl("p", {
      cls: "bn-settings-hint",
      text: `Файл доски: ${this.boardPath}`,
    });

    // Папка
    contentEl.createEl("label", { text: "Папка для новых карточек" });
    this.folderInput = contentEl.createEl("input", {
      type: "text",
      value: this.cfg.folder ?? "",
    }) as HTMLInputElement;

    // Шаблон
    contentEl.createEl("label", { text: "Путь к шаблону" });
    const tplRow = contentEl.createDiv({ cls: "bn-settings-row" });
    this.templateInput = tplRow.createEl("input", {
      type: "text",
      value: this.cfg.template ?? "",
    }) as HTMLInputElement;
    const createBtn = tplRow.createEl("button", { text: "+ создать заметку" });
    createBtn.addEventListener("click", async () => {
      const cards = this.plugin.getCards(this.cfg, this.boardPath);
      await this.plugin.createCard(this.cfg, cards);
      this.close();
    });

    // Колонки
    contentEl.createEl("h4", { text: "Колонки" });
    this.columnRows = this.makeEditableList(contentEl, this.cfg.columns, () => {});

    // Метаданные на лицевой стороне карточки доски (под названием)
    contentEl.createEl("h4", { text: "Метаданные на карточке доски" });
    contentEl.createEl("p", {
      cls: "bn-settings-hint",
      text: "Поля frontmatter, показываемые строкой под названием прямо на доске (не в развороте ```card```).",
    });
    this.metaRows = this.makeEditableList(contentEl, this.cfg.meta, () => {});

    // Словарь (Метки/Жанры/…)
    contentEl.createEl("h4", { text: "Теги / словарь" });
    this.vocabFieldOrder = Object.keys(this.cfg.vocab);
    this.vocabRows.clear();
    this.vocabFieldOrder.forEach((field) => {
      const group = contentEl.createDiv({ cls: "bn-settings-group" });
      group.createEl("div", { cls: "bn-settings-field-name", text: field });
      const rows = this.makeEditableList(group, this.cfg.vocab[field], () => {});
      this.vocabRows.set(field, rows);
    });

    const newFieldRow = contentEl.createDiv({ cls: "bn-settings-row" });
    const newFieldInput = newFieldRow.createEl("input", {
      type: "text",
      placeholder: "имя нового поля (например Приоритет)",
    }) as HTMLInputElement;
    const newFieldBtn = newFieldRow.createEl("button", { text: "+ добавить поле" });
    newFieldBtn.addEventListener("click", () => {
      const name = newFieldInput.value.trim();
      if (!name || this.vocabFieldOrder.includes(name)) return;
      this.vocabFieldOrder.push(name);
      const group = contentEl.createDiv({ cls: "bn-settings-group" });
      group.createEl("div", { cls: "bn-settings-field-name", text: name });
      const rows = this.makeEditableList(group, [], () => {});
      this.vocabRows.set(name, rows);
      contentEl.insertBefore(group, newFieldRow);
      newFieldInput.value = "";
    });

    // Карточка (```card``` без своего конфига берёт эти настройки централизованно)
    contentEl.createEl("h4", { text: "Карточка (```card```)" });
    contentEl.createEl("p", {
      cls: "bn-settings-hint",
      text: "Применяется к заметкам, у которых блок ```card``` пустой (без своего fields/links/labels) — не нужно дублировать настройки в каждом шаблоне.",
    });

    contentEl.createEl("div", { cls: "bn-settings-field-name", text: "Поля" });
    this.cardFieldRows = this.makeEditableList(contentEl, this.cfg.cardFields, () => {});

    contentEl.createEl("div", { cls: "bn-settings-field-name", text: "Ссылки (поле → подпись)" });
    this.cardLinkRows = this.makePairList(
      contentEl,
      this.cfg.cardLinks.map((l) => ({ field: l.field, label: l.label ?? "" })),
      "имя поля (например Морж)",
      "подпись ссылки"
    );

    contentEl.createEl("div", { cls: "bn-settings-field-name", text: "Подписи (поле → подпись)" });
    this.cardLabelRows = this.makePairList(
      contentEl,
      Object.entries(this.cfg.cardLabels).map(([field, label]) => ({ field, label })),
      "имя поля",
      "подпись"
    );

    // Кнопки
    const footer = contentEl.createDiv({ cls: "bn-settings-footer" });
    const saveBtn = footer.createEl("button", { text: "Сохранить", cls: "mod-cta" });
    const cancelBtn = footer.createEl("button", { text: "Отмена" });
    cancelBtn.addEventListener("click", () => this.close());
    saveBtn.addEventListener("click", () => this.save());

    const newBoardBtn = footer.createEl("button", { text: "+ создать новую доску" });
    newBoardBtn.addEventListener("click", () => {
      this.close();
      new NewBoardModal(this.app, this.plugin).open();
    });
  }

  async save() {
    try {
      const newFolder = this.folderInput.value.trim();
      const newTemplate = this.templateInput.value.trim();

      const newColumns: string[] = [];
      const columnRenames: { oldValue: string; newValue: string }[] = [];
      const deletedColumns: string[] = [];
      for (const r of this.byDomOrder(this.columnRows)) {
        if (r.deleted) {
          if (r.original) deletedColumns.push(r.original);
          continue;
        }
        const value = r.input.value.trim();
        if (!value) continue;
        newColumns.push(value);
        if (r.original && r.original !== value) {
          columnRenames.push({ oldValue: r.original, newValue: value });
        }
      }

      const newVocab: Record<string, string[]> = {};
      const vocabRenames: { field: string; oldValue: string; newValue: string }[] = [];
      for (const field of this.vocabFieldOrder) {
        const rows = this.byDomOrder(this.vocabRows.get(field) ?? []);
        const values: string[] = [];
        for (const r of rows) {
          if (r.deleted) continue;
          const value = r.input.value.trim();
          if (!value) continue;
          values.push(value);
          if (r.original && r.original !== value) {
            vocabRenames.push({ field, oldValue: r.original, newValue: value });
          }
        }
        newVocab[field] = values;
      }

      const newMeta = this.byDomOrder(this.metaRows)
        .filter((r) => !r.deleted)
        .map((r) => r.input.value.trim())
        .filter(Boolean);

      const newCardFields = this.byDomOrder(this.cardFieldRows)
        .filter((r) => !r.deleted)
        .map((r) => r.input.value.trim())
        .filter(Boolean);

      const newCardLinks: CardLink[] = this.byDomOrder(this.cardLinkRows)
        .filter((r) => !r.deleted)
        .map((r) => ({
          field: r.fieldInput.value.trim(),
          label: r.labelInput.value.trim() || undefined,
        }))
        .filter((l) => l.field);

      const newCardLabels: Record<string, string> = {};
      for (const r of this.byDomOrder(this.cardLabelRows)) {
        if (r.deleted) continue;
        const field = r.fieldInput.value.trim();
        const label = r.labelInput.value.trim();
        if (field && label) newCardLabels[field] = label;
      }

      const newCfg: BoardConfig = {
        ...this.cfg,
        folder: newFolder || undefined,
        template: newTemplate || undefined,
        columns: newColumns,
        meta: newMeta,
        vocab: newVocab,
        cardFields: newCardFields,
        cardLinks: newCardLinks,
        cardLabels: newCardLabels,
      };

      let renamedCount = 0;
      for (const { oldValue, newValue } of columnRenames) {
        renamedCount += await this.plugin.renameStatusAcrossCards(this.cfg, this.boardPath, oldValue, newValue);
      }
      for (const deleted of deletedColumns) {
        if (newColumns.length) {
          renamedCount += await this.plugin.renameStatusAcrossCards(this.cfg, this.boardPath, deleted, newColumns[0]);
        }
      }
      for (const { field, oldValue, newValue } of vocabRenames) {
        renamedCount += await this.plugin.renameVocabValueAcrossCards(this.cfg, this.boardPath, field, oldValue, newValue);
      }

      await this.plugin.saveBoardConfig(this.boardPath, this.cfg.raw, newCfg);

      new Notice(
        renamedCount
          ? `Настройки сохранены, обновлено карточек: ${renamedCount}`
          : "Настройки сохранены"
      );
      this.close();
    } catch (e) {
      new Notice("board-notes: не удалось сохранить настройки — " + e);
    }
  }
}

class NewBoardModal extends Modal {
  private titleInput!: HTMLInputElement;
  private noteFolderInput!: HTMLInputElement;
  private tagInput!: HTMLInputElement;
  private folderInput!: HTMLInputElement;
  private templateInput!: HTMLInputElement;
  private columnsInput!: HTMLTextAreaElement;

  constructor(app: App, private plugin: BoardNotesPlugin) {
    super(app);
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bn-settings-modal");
    contentEl.createEl("h3", { text: "Новая доска" });

    contentEl.createEl("label", { text: "Название заметки-доски" });
    this.titleInput = contentEl.createEl("input", { type: "text", value: "Новая доска" }) as HTMLInputElement;

    contentEl.createEl("label", { text: "Папка для самой заметки-доски (пусто — корень)" });
    this.noteFolderInput = contentEl.createEl("input", { type: "text" }) as HTMLInputElement;

    contentEl.createEl("label", { text: "Тег (например #мойтег)" });
    this.tagInput = contentEl.createEl("input", { type: "text", placeholder: "#мойтег" }) as HTMLInputElement;

    contentEl.createEl("label", { text: "Папка для карточек" });
    this.folderInput = contentEl.createEl("input", { type: "text" }) as HTMLInputElement;

    contentEl.createEl("label", { text: "Шаблон (необязательно)" });
    this.templateInput = contentEl.createEl("input", { type: "text" }) as HTMLInputElement;

    contentEl.createEl("label", { text: "Колонки (по одной на строку, необязательно)" });
    this.columnsInput = contentEl.createEl("textarea", { attr: { rows: "5" } }) as HTMLTextAreaElement;

    const footer = contentEl.createDiv({ cls: "bn-settings-footer" });
    const createBtn = footer.createEl("button", { text: "Создать", cls: "mod-cta" });
    const cancelBtn = footer.createEl("button", { text: "Отмена" });
    cancelBtn.addEventListener("click", () => this.close());
    createBtn.addEventListener("click", () => this.create());
  }

  async create() {
    const title = this.titleInput.value.trim() || "Новая доска";
    let tag = this.tagInput.value.trim();
    if (!tag) {
      new Notice("board-notes: укажи тег для доски");
      return;
    }
    if (!tag.startsWith("#")) tag = "#" + tag;

    const columns = this.columnsInput.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const cfg: BoardConfig = {
      tag,
      statusField: DEFAULT_STATUS_FIELD,
      orderField: DEFAULT_ORDER_FIELD,
      columns,
      folder: this.folderInput.value.trim() || undefined,
      template: this.templateInput.value.trim() || undefined,
      exclude: [],
      facets: [],
      vocab: {},
      single: [],
      meta: [],
      showTags: true,
      flat: false,
      raw: "",
      cardFields: [],
      cardLinks: [],
      cardLabels: {},
    };

    const yaml = this.plugin.serializeConfig(cfg);
    const noteFolder = this.noteFolderInput.value.trim();
    const path = (noteFolder ? noteFolder + "/" : "") + title + ".md";

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`board-notes: заметка уже существует — ${path}`);
      return;
    }

    const content = `# ${title}\n\n\`\`\`board\n${yaml}\n\`\`\`\n`;
    try {
      const file = await this.app.vault.create(path, content);
      this.close();
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice("board-notes: не удалось создать доску — " + e);
    }
  }
}
