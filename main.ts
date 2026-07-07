import {
  App,
  MarkdownPostProcessorContext,
  Modal,
  Plugin,
  TFile,
  parseYaml,
  Notice,
} from "obsidian";

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

const DEFAULT_STATUS_FIELD = "Статус";
const DEFAULT_ORDER_FIELD = "Порядок";

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
    const fields: string[] = Array.isArray(raw.fields)
      ? raw.fields.map((f: any) => String(f))
      : ["Оценка", "Кинопоиск", "Описание", "Рекомендация"];
    const ratingField = raw.ratingField ? String(raw.ratingField) : "Оценка";
    const linkField = raw.linkField ? String(raw.linkField) : "Кинопоиск";
    const linkLabel = raw.linkLabel
      ? String(raw.linkLabel)
      : linkField === "Кинопоиск"
      ? "Открыть на Кинопоиске ↗"
      : "Открыть ↗";
    const recField = raw.recField ? String(raw.recField) : "Рекомендация";
    const labels: Record<string, string> =
      raw.labels && typeof raw.labels === "object"
        ? Object.fromEntries(
            Object.entries(raw.labels).map(([k, v]) => [k, String(v)])
          )
        : {};

    const container = el.createDiv({ cls: "bn-card-view" });

    const draw = () => {
      container.empty();
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

      fields.forEach((field) => {
        const value = fm[field];
        const hasValue = value != null && value !== "";

        if (field === ratingField) {
          const el = container.createDiv({ cls: "bn-card-rating" });
          el.setText(hasValue ? `★ ${value}` : `+ ${(labels[field] ?? field).toLowerCase()}`);
          if (!hasValue) el.addClass("bn-card-placeholder");
          this.makeFieldEditable(el, file, field, hasValue ? String(value) : "", false, draw);
          return;
        }

        if (field === linkField) {
          const row = container.createDiv({ cls: "bn-card-link-row" });
          if (hasValue && typeof value === "string" && /^https?:\/\//.test(value)) {
            row.createEl("a", { cls: "bn-card-link", text: linkLabel, href: value });
            const editBtn = row.createSpan({ cls: "bn-card-link-edit", text: "✎" });
            this.makeFieldEditable(editBtn, file, field, String(value), false, draw);
          } else {
            const el = row.createSpan({
              cls: "bn-card-link bn-card-placeholder",
              text: `+ ${(labels[field] ?? field).toLowerCase()}`,
            });
            this.makeFieldEditable(el, file, field, "", false, draw);
          }
          return;
        }

        if (field === recField) {
          const el = container.createDiv({ cls: "bn-card-rec" });
          el.setText(hasValue ? String(value) : `+ ${(labels[field] ?? field).toLowerCase()}`);
          if (!hasValue) el.addClass("bn-card-placeholder");
          this.makeFieldEditable(el, file, field, hasValue ? String(value) : "", true, draw);
          return;
        }

        if (labels[field]) {
          const meta = container.createDiv({ cls: "bn-card-labeled" });
          meta.createSpan({ cls: "bn-card-label", text: labels[field] });
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

    const evtRef = this.app.metadataCache.on("changed", (changed) => {
      if (changed.path === file.path) draw();
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
      inputEl.addEventListener("keydown", (e) => {
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
    const cfg = this.parseConfig(source);
    const container = el.createDiv({ cls: "board-notes" });

    if (!cfg.tag) {
      container.createDiv({
        cls: "bn-error",
        text: "board: укажи tag в конфиге блока, например tag: \"#series\"",
      });
      return;
    }

    const viewKey = `${ctx.sourcePath}::${cfg.tag}`;
    const savedHidden = this.viewState[viewKey]?.hiddenColumns ?? [];

    const state: BoardState = {
      hiddenColumns: new Set(savedHidden),
      activeTags: new Set(),
      activeFacets: new Map(),
      openEditor: null,
      searchQuery: "",
    };

    const redraw = () => this.draw(container, cfg, state, ctx.sourcePath);
    redraw();

    const evtRef = this.app.metadataCache.on("changed", redraw);
    this.registerEvent(evtRef);

    const deleteRef = this.app.vault.on("delete", redraw);
    this.registerEvent(deleteRef);
  }

  draw(container: HTMLElement, cfg: BoardConfig, state: BoardState, sourcePath: string) {
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
      allCards.forEach((c) =>
        this.fieldValues(c.fm, f).forEach((v) => values.add(v))
      );
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
        if (!values.some((v) => active.has(v))) return false;
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
      allCards.length
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
    addBtn.addEventListener("click", () => this.createCard(cfg));
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
    total: number
  ) {
    const toolbar = container.createDiv({ cls: "bn-toolbar" });

    const searchRow = toolbar.createDiv({ cls: "bn-row bn-search-row" });
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
        .sort()
        .forEach((val) => {
          const chip = row.createSpan({
            cls: "bn-chip" + (active.has(val) ? " active" : ""),
            text: val,
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
      const currentValues: string[] = [];
      vocabFields.forEach((f) => {
        const vals = cfg.single.includes(f)
          ? c.fm[f] != null && c.fm[f] !== ""
            ? [String(c.fm[f])]
            : []
          : this.fieldValues(c.fm, f);
        currentValues.push(...vals);
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
    addBtn.addEventListener("click", () => this.createCard(cfg, col));

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

  async createCard(cfg: BoardConfig, status?: string) {
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

    try {
      const file = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice("board-notes: не удалось создать заметку — " + e);
    }
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
