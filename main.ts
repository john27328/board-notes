import {
  App,
  MarkdownRenderChild,
  MarkdownPostProcessorContext,
  Modal,
  parseYaml,
  Plugin,
  TFile,
  Notice,
} from "obsidian";
import {
  DEFAULT_BASE_TASK_FIELD,
  DEFAULT_ORDER_FIELD,
  DEFAULT_STATUS_FIELD,
  parseBoardConfig,
  serializeBoardConfig,
} from "./config";
import type {
  BoardConfig,
  BoardState,
  BoardViewState,
  Card,
  CardLink,
  MatchedBoard,
  TableColumn,
  TableSort,
} from "./types";
const EMPTY_FACET_VALUE = " __bn_empty__";

export default class BoardNotesPlugin extends Plugin {
  viewState: Record<string, BoardViewState> = {};
  private dateUpdateTimers = new Map<string, number>();
  private ignoredDateUpdateEvents = new Set<string>();
  private autoArchiveRunning = false;

  async onload() {
    this.viewState = ((await this.loadData()) as Record<string, BoardViewState>) ?? {};

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.scheduleDateUpdate(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this.ignoredDateUpdateEvents.delete(file.path)) return;
        this.scheduleDateUpdate(file);
      })
    );
    void this.runAutoArchive();
    this.registerInterval(window.setInterval(() => void this.runAutoArchive(), 60 * 60 * 1000));

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

  onunload() {
    for (const timer of this.dateUpdateTimers.values()) window.clearTimeout(timer);
    this.dateUpdateTimers.clear();
  }

  private scheduleDateUpdate(file: TFile) {
    if (file.extension !== "md") return;
    const previous = this.dateUpdateTimers.get(file.path);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      this.dateUpdateTimers.delete(file.path);
      void this.ensureNoteDates(file);
    }, 300);
    this.dateUpdateTimers.set(file.path, timer);
  }

  private today() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  private async ensureNoteDates(file: TFile) {
    if (!this.app.vault.getAbstractFileByPath(file.path)) return;
    const existing = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const isEmpty = (value: unknown) => value === undefined || value === null || value === "";
    if (!isEmpty(existing.created) && !isEmpty(existing.updated)) return;
    const today = this.today();
    this.ignoredDateUpdateEvents.add(file.path);
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (isEmpty(fm.created)) fm.created = today;
        if (isEmpty(fm.updated)) fm.updated = today;
      });
    } catch (e) {
      this.ignoredDateUpdateEvents.delete(file.path);
      console.error("board-notes: не удалось обновить даты заметки", e);
    }
  }

  private parseDate(value: unknown): Date | null {
    const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async runAutoArchive() {
    if (this.autoArchiveRunning) return;
    this.autoArchiveRunning = true;
    let moved = 0;
    try {
      for (const boardFile of this.app.vault.getMarkdownFiles()) {
        const content = await this.app.vault.cachedRead(boardFile);
        for (const match of content.matchAll(/```board\n([\s\S]*?)\n```/g)) {
          const cfg = this.parseConfig(match[1]);
          const rule = cfg.autoArchive;
          if (!rule || cfg.flat) continue;
          for (const card of this.getCards(cfg, boardFile.path)) {
            if (String(card.fm[cfg.statusField] ?? "") !== rule.source) continue;
            const changedAt = this.parseDate(card.fm[rule.statusChangedField]);
            if (!changedAt) continue;
            const archiveAt = new Date(changedAt);
            archiveAt.setDate(archiveAt.getDate() + rule.afterDays);
            if (new Date() < archiveAt) continue;
            await this.app.fileManager.processFrontMatter(card.file, (fm) => {
              if (String(fm[cfg.statusField] ?? "") !== rule.source) return;
              fm[cfg.statusField] = rule.target;
              fm[rule.statusChangedField] = this.today();
              moved++;
            });
          }
        }
      }
      if (moved) new Notice(`board-notes: перемещено в архив: ${moved}`);
    } catch (e) {
      console.error("board-notes: не удалось выполнить автоархивирование", e);
    } finally {
      this.autoArchiveRunning = false;
    }
  }

  async setCardStatus(file: TFile, cfg: BoardConfig, status: string) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (String(fm[cfg.statusField] ?? "") === status) return;
      fm[cfg.statusField] = status;
      if (cfg.autoArchive) fm[cfg.autoArchive.statusChangedField] = this.today();
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
    const lifecycle = new MarkdownRenderChild(container);
    ctx.addChild(lifecycle);

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
    lifecycle.registerEvent(evtRef);
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
        : [];

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
      return [];
    };

    const labels = (): Record<string, string> => {
      const local = hasLocalLabels
        ? Object.fromEntries(Object.entries(raw.labels).map(([k, v]) => [k, String(v)]))
        : {};
      return { ...(board?.cfg.cardLabels ?? {}), ...local };
    };

    const ratingField = () =>
      raw.ratingField ? String(raw.ratingField) : board?.cfg.cardRatingField;
    const recField = () =>
      raw.recField ? String(raw.recField) : board?.cfg.cardRecField;

    const container = el.createDiv({ cls: "bn-card-view" });
    const lifecycle = new MarkdownRenderChild(container);
    ctx.addChild(lifecycle);

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

        const createSubtaskBtn = info.createSpan({
          cls: "bn-card-create-subtask",
          text: "+ подзадача",
        });
        createSubtaskBtn.setAttr("aria-label", "Создать подзадачу");
        createSubtaskBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.createSubtask(board!.cfg, board!.boardPath, file);
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
              await this.setCardStatus(file, board!.cfg, col);
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
            `Открыть (${field}) ↗`;
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
          const valueEl = meta.createSpan({ cls: "bn-card-label-value" });
          const isInternalLink = hasValue && this.renderInternalLink(valueEl, file, value);
          if (!isInternalLink) valueEl.setText(hasValue ? String(value) : "—");
          if (!hasValue) valueEl.addClass("bn-card-placeholder");
          if (isInternalLink) {
            const editBtn = meta.createSpan({ cls: "bn-card-link-edit", text: "✎" });
            this.makeFieldEditable(editBtn, file, field, String(value), false, draw);
          } else {
            this.makeFieldEditable(valueEl, file, field, hasValue ? String(value) : "", false, draw);
          }
          return;
        }

        const el = container.createDiv({ cls: "bn-card-desc" });
        el.setText(hasValue ? String(value) : `+ ${field.toLowerCase()}`);
        if (!hasValue) el.addClass("bn-card-placeholder");
        this.makeFieldEditable(el, file, field, hasValue ? String(value) : "", true, draw);
      });

      if (board) {
        const allCards = this.getCards(board.cfg, board.boardPath);
        const children = this.childCardsOf(allCards, file.path, board.cfg.baseTaskField);
        if (children.length) {
          const doneSet = this.doneStatusesOf(board.cfg);
          const done = children.filter((ch) =>
            doneSet.has(String(ch.fm[board!.cfg.statusField] ?? ""))
          ).length;

          const section = container.createDiv({ cls: "bn-card-children" });
          const header = section.createDiv({ cls: "bn-card-children-header" });
          header.createSpan({ text: "Дочерние задачи" });
          header.createSpan({ cls: "bn-card-children-count", text: `${done}/${children.length}` });

          const list = section.createDiv({ cls: "bn-card-children-list" });
          children
            .slice()
            .sort(
              (a, b) =>
                (Number(a.fm[board!.cfg.orderField]) || 9999) -
                (Number(b.fm[board!.cfg.orderField]) || 9999)
            )
            .forEach((child) => {
              const status = String(child.fm[board!.cfg.statusField] ?? "");
              const row = list.createDiv({
                cls: "bn-card-children-item" + (doneSet.has(status) ? " done" : ""),
              });
              const link = row.createSpan({
                cls: "bn-card-children-link",
                text: child.file.basename,
              });
              link.setAttr("tabindex", "0");
              link.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.app.workspace.getLeaf(false).openFile(child.file);
              });
              if (status) {
                row.createSpan({
                  cls: "bn-chip bn-card-children-status" + (doneSet.has(status) ? " active" : ""),
                  text: status,
                });
              }
            });
        }
      }
    };

    draw();

    this.findMatchingBoardConfig(file).then((found) => {
      if (!found) return;
      board = found;
      draw();
    });

    const evtRef = this.app.metadataCache.on("changed", (changed) => {
      if (changed.path === file.path) draw();
      else if (board && changed.path === board.boardPath) {
        this.findMatchingBoardConfig(file).then((found) => {
          board = found;
          draw();
        });
      } else if (board) {
        // A sibling card's frontmatter changed — may affect this card's children list/progress.
        draw();
      }
    });
    lifecycle.registerEvent(evtRef);
  }

  /** Render a single Obsidian wikilink stored in frontmatter as a working internal link. */
  private renderInternalLink(el: HTMLElement, sourceFile: TFile, value: unknown): boolean {
    if (typeof value !== "string") return false;
    const match = value.trim().match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
    if (!match) return false;

    const target = match[1].trim();
    const text = (match[2] ?? target.split("#")[0]).trim();
    const link = el.createEl("a", {
      cls: "internal-link",
      text,
      attr: { "data-href": target, href: target },
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.app.workspace.openLinkText(target, sourceFile.path);
    });
    return true;
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
    return parseBoardConfig(source);
  }

  /** Resolves a frontmatter link value (wikilink string, plain path, or array of either) to the paths of the files it points at. */
  resolveLinkTargets(sourcePath: string, value: any): string[] {
    const raw = Array.isArray(value) ? value : value != null && value !== "" ? [value] : [];
    const paths: string[] = [];
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const match = v.trim().match(/^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/);
      const target = (match ? match[1] : v.trim()).split("#")[0].trim();
      if (!target) continue;
      const dest = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
      if (dest) paths.push(dest.path);
    }
    return paths;
  }

  /** Cards among `allCards` whose base-task field points at `parentPath`. */
  childCardsOf(allCards: Card[], parentPath: string, field: string): Card[] {
    return allCards.filter((c) =>
      this.resolveLinkTargets(c.file.path, c.fm[field]).includes(parentPath)
    );
  }

  /** Status values that count as "done" for progress purposes — the auto-archive source/target columns. */
  doneStatusesOf(cfg: BoardConfig): Set<string> {
    if (cfg.autoArchive) return new Set([cfg.autoArchive.source, cfg.autoArchive.target]);
    return cfg.columns.length ? new Set([cfg.columns[cfg.columns.length - 1]]) : new Set();
  }

  fieldValues(fm: Record<string, any>, field: string): string[] {
    const v = fm[field];
    if (v == null) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((x) => String(x)).filter((x) => x.length > 0);
  }

  private searchableValueParts(value: unknown): string[] {
    if (value == null) return [];
    if (Array.isArray(value)) return value.flatMap((item) => this.searchableValueParts(item));
    if (typeof value !== "object") return [String(value)];

    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return [String(value)];
    return entries.flatMap(([field, item]) => [field, ...this.searchableValueParts(item)]);
  }

  private searchableFrontmatterParts(fm: Record<string, any>): string[] {
    return Object.entries(fm).flatMap(([field, value]) => [
      field,
      ...this.searchableValueParts(value),
    ]);
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
    const lifecycle = new MarkdownRenderChild(container);
    ctx.addChild(lifecycle);

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
      tagFilterMode: "include",
      activeFacets: new Map(),
      facetFilterModes: new Map(),
      openEditor: null,
      searchQuery: "",
      onlyBaseTasks: false,
      view: cfg.view,
      tableFilters: new Map(),
      tableSort: [...cfg.table.sort],
      onSettings: null,
    };
    const loadHidden = () => {
      const viewKey = `${ctx.sourcePath}::${cfg.tag}`;
      state.hiddenColumns = new Set(this.viewState[viewKey]?.hiddenColumns ?? []);
    };
    loadHidden();

    state.onSettings = () => {
      new BoardSettingsModal(this.app, this, cfg, ctx.sourcePath).open();
    };

    const redraw = () => this.draw(container, cfg, state, ctx.sourcePath);
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
          state.tableSort = [...cfg.table.sort];
        }
      }
      redraw();
    });
    lifecycle.registerEvent(evtRef);

    const deleteRef = this.app.vault.on("delete", redraw);
    lifecycle.registerEvent(deleteRef);
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
      if (state.onlyBaseTasks && !this.childCardsOf(allCards, c.file.path, cfg.baseTaskField).length) {
        return false;
      }
      if (state.activeTags.size) {
        const matches = c.tags.some((t) => state.activeTags.has(t));
        if (state.tagFilterMode === "include" ? !matches : matches) return false;
      }
      for (const [field, active] of state.activeFacets) {
        if (!active.size) continue;
        const values = this.fieldValues(c.fm, field);
        const matchesEmpty = values.length === 0 && active.has(EMPTY_FACET_VALUE);
        const matches = matchesEmpty || values.some((v) => active.has(v));
        const mode = state.facetFilterModes.get(field) ?? "include";
        if (mode === "include" ? !matches : matches) return false;
      }
      if (query) {
        const title = String(
          (cfg.nameField && c.fm[cfg.nameField]) || c.fm["Название"] || c.file.basename
        );
        const haystack = [
          title,
          ...this.searchableFrontmatterParts(c.fm),
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

    if (state.view === "table") {
      this.drawTable(container, cfg, state, cards, sourcePath);
      return;
    }

    if (cfg.flat) {
      this.drawFlatGrid(container, cfg, state, cards, allCards, sourcePath);
      return;
    }

    const board = container.createDiv({ cls: "bn-board" });

    for (const col of columns) {
      if (state.hiddenColumns.has(col)) continue;
      this.drawColumn(board, container, cfg, state, col, cards, allCards, sourcePath);
    }
  }

  drawFlatGrid(
    container: HTMLElement,
    cfg: BoardConfig,
    state: BoardState,
    cards: Card[],
    allCards: Card[],
    sourcePath: string
  ) {
    const grid = container.createDiv({ cls: "bn-flat-grid" });
    cards.forEach((c) =>
      this.renderCardEl(grid, cfg, state, c, allCards, container, sourcePath, false)
    );

    const addBtn = container.createDiv({ cls: "bn-add bn-add-flat", text: "+ добавить" });
    addBtn.addEventListener("click", () => this.createCard(cfg, cards));
  }

  defaultTableColumns(cfg: BoardConfig): TableColumn[] {
    const fields = [
      "__title",
      ...(cfg.flat ? [] : [cfg.statusField]),
      ...cfg.meta,
      ...cfg.facets,
      ...Object.keys(cfg.vocab),
    ];
    return Array.from(new Set(fields)).map((field) => ({
      field,
      label: field === "__title" ? cfg.nameField ?? "Название" : undefined,
    }));
  }

  tableColumnsFor(cfg: BoardConfig): TableColumn[] {
    return cfg.table.columns.length ? cfg.table.columns : this.defaultTableColumns(cfg);
  }

  private tableStorageField(field: string, cfg: BoardConfig): string {
    return field === "__title" ? cfg.nameField ?? "Название" : field;
  }

  private tableValue(card: Card, column: TableColumn, cfg: BoardConfig): string {
    if (column.field === "__title") {
      return String(
        (cfg.nameField && card.fm[cfg.nameField]) || card.fm["Название"] || card.file.basename
      );
    }
    const value = card.fm[column.field];
    return Array.isArray(value) ? value.map(String).join(", ") : value == null ? "" : String(value);
  }

  drawTable(
    container: HTMLElement,
    cfg: BoardConfig,
    state: BoardState,
    cards: Card[],
    sourcePath: string
  ) {
    const columns = this.tableColumnsFor(cfg);
    const filtered = cards
      .filter((card) =>
        (cfg.flat || !state.hiddenColumns.has(String(card.fm[cfg.statusField] ?? ""))) &&
        columns.every((column) => {
          const filter = state.tableFilters.get(column.field)?.trim().toLowerCase();
          return !filter || this.tableValue(card, column, cfg).toLowerCase().includes(filter);
        })
      )
      .sort((a, b) => {
        for (const rule of state.tableSort) {
          const column = columns.find((item) => item.field === rule.field);
          if (!column) continue;
          const left = this.tableValue(a, column, cfg);
          const right = this.tableValue(b, column, cfg);
          const numericLeft = Number(left);
          const numericRight = Number(right);
          const result =
            left !== "" && right !== "" && Number.isFinite(numericLeft) && Number.isFinite(numericRight)
              ? numericLeft - numericRight
              : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
          if (result) return rule.direction === "asc" ? result : -result;
        }
        return 0;
      });

    const wrap = container.createDiv({ cls: "bn-table-wrap" });
    const table = wrap.createEl("table", { cls: "bn-table" });
    const head = table.createEl("thead").createEl("tr");
    columns.forEach((column) => {
      const cell = head.createEl("th", { cls: "bn-table-header" });
      cell.draggable = true;
      cell.dataset.field = column.field;
      const sortIndex = state.tableSort.findIndex((rule) => rule.field === column.field);
      const sort = sortIndex >= 0 ? state.tableSort[sortIndex] : null;
      const label = cell.createSpan({
        cls: "bn-table-sort",
        text: `${column.label ?? (column.field === "__title" ? "Название" : column.field)}${
          sort?.direction === "asc" ? " ↑" : sort?.direction === "desc" ? " ↓" : ""
        }${sortIndex >= 0 ? ` · ${sortIndex + 1}` : ""}`,
      });
      label.addEventListener("click", () => {
        const existing = state.tableSort.find((rule) => rule.field === column.field);
        state.tableSort = [
          {
            field: column.field,
            direction: existing?.direction === "asc" ? "desc" : "asc",
          },
          ...state.tableSort.filter((rule) => rule.field !== column.field),
        ];
        this.draw(container, cfg, state, sourcePath);
      });
      const filter = cell.createEl("input", {
        cls: "bn-table-filter",
        type: "search",
        placeholder: "Фильтр",
      }) as HTMLInputElement;
      filter.dataset.field = column.field;
      filter.value = state.tableFilters.get(column.field) ?? "";
      filter.addEventListener("click", (event) => event.stopPropagation());
      filter.addEventListener("input", () => {
        state.tableFilters.set(column.field, filter.value);
        const caret = filter.selectionStart;
        this.draw(container, cfg, state, sourcePath);
        const replacement = Array.from(
          container.querySelectorAll<HTMLInputElement>(".bn-table-filter")
        ).find((input) => input.dataset.field === column.field);
        if (replacement) {
          replacement.focus();
          if (caret != null) replacement.setSelectionRange(caret, caret);
        }
      });
      cell.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", column.field);
        event.dataTransfer!.effectAllowed = "move";
      });
      cell.addEventListener("dragover", (event) => event.preventDefault());
      cell.addEventListener("drop", (event) => {
        event.preventDefault();
        const dragged = event.dataTransfer?.getData("text/plain");
        if (!dragged || dragged === column.field) return;
        const reordered = [...columns];
        const from = reordered.findIndex((item) => item.field === dragged);
        const to = reordered.findIndex((item) => item.field === column.field);
        if (from < 0 || to < 0) return;
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        void this.persistTableColumns(cfg, sourcePath, reordered);
      });
    });

    const body = table.createEl("tbody");
    filtered.forEach((card) => {
      const row = body.createEl("tr");
      columns.forEach((column) => this.renderTableCell(row, card, column, cfg, state, container, sourcePath));
    });

    const footer = container.createDiv({ cls: "bn-table-footer" });
    footer.createSpan({ cls: "bn-search-count", text: `${filtered.length} / ${cards.length}` });
    const addButton = footer.createSpan({ cls: "bn-add bn-table-add", text: "+ добавить" });
    const firstStatus = cfg.flat ? undefined : cfg.columns[0];
    addButton.addEventListener("click", () => this.createCard(cfg, cards, firstStatus));
  }

  private renderTableCell(
    row: HTMLTableRowElement,
    card: Card,
    column: TableColumn,
    cfg: BoardConfig,
    state: BoardState,
    container: HTMLElement,
    sourcePath: string
  ) {
    const cell = row.createEl("td", { cls: "bn-table-cell", text: this.tableValue(card, column, cfg) });
    cell.setAttr("title", "Двойной клик — редактировать");
    let openTimer: number | null = null;
    cell.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openTimer != null) window.clearTimeout(openTimer);
      this.editTableCell(cell, card, column, cfg, state, container, sourcePath);
    });
    if (column.field === "__title") {
      cell.addEventListener("click", () => {
        if (openTimer != null) window.clearTimeout(openTimer);
        openTimer = window.setTimeout(() => {
          openTimer = null;
          void this.app.workspace.getLeaf(false).openFile(card.file);
        }, 220);
      });
    }
  }

  private editTableCell(
    cell: HTMLTableCellElement,
    card: Card,
    column: TableColumn,
    cfg: BoardConfig,
    state: BoardState,
    container: HTMLElement,
    sourcePath: string
  ) {
    const field = this.tableStorageField(column.field, cfg);
    const current = card.fm[field];
    cell.empty();
    const vocab = cfg.vocab[field] ?? [];
    const statusValues = field === cfg.statusField ? cfg.columns : [];
    const options = statusValues.length ? statusValues : vocab;
    const isMulti = Boolean(vocab.length && !cfg.single.includes(field));

    const save = async (value: string | string[]) => {
      await this.app.fileManager.processFrontMatter(card.file, (fm) => {
        fm[field] = value;
        if (field === cfg.statusField && cfg.autoArchive) fm[cfg.autoArchive.statusChangedField] = this.today();
      });
      this.draw(container, cfg, state, sourcePath);
    };

    if (options.length) {
      const select = cell.createEl("select", { cls: "bn-table-editor" }) as HTMLSelectElement;
      select.addEventListener("click", (event) => event.stopPropagation());
      select.multiple = isMulti;
      if (!isMulti) select.createEl("option", { value: "", text: "—" });
      options.forEach((option) => select.createEl("option", { value: option, text: option }));
      const selected = Array.isArray(current) ? current.map(String) : current == null ? [] : [String(current)];
      Array.from(select.options).forEach((option) => (option.selected = selected.includes(option.value)));
      select.addEventListener("change", () => {
        const value = isMulti
          ? Array.from(select.selectedOptions).map((option) => option.value)
          : select.value;
        void save(value);
      });
      select.focus();
      return;
    }

    const input = cell.createEl("input", {
      cls: "bn-table-editor",
      type: "text",
      value: this.tableValue(card, column, cfg),
    }) as HTMLInputElement;
    input.addEventListener("click", (event) => event.stopPropagation());
    let saved = false;
    const commit = () => {
      if (saved) return;
      saved = true;
      void save(input.value.trim());
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commit();
      if (event.key === "Escape") this.draw(container, cfg, state, sourcePath);
    });
    input.focus();
    input.select();
  }

  private async persistTableColumns(cfg: BoardConfig, sourcePath: string, columns: TableColumn[]) {
    try {
      await this.saveBoardConfig(sourcePath, cfg.raw, {
        ...cfg,
        table: { columns, sort: cfg.table.sort },
      });
    } catch (error) {
      new Notice("board-notes: не удалось сохранить порядок колонок таблицы — " + error);
    }
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

    if (state.onSettings) {
      const settingsBtn = searchRow.createDiv({ cls: "bn-settings-btn", text: "⚙" });
      settingsBtn.setAttr("aria-label", "Настройки доски");
      settingsBtn.addEventListener("click", () => state.onSettings?.());
    }

    const tableViewBtn = searchRow.createSpan({
      cls: "bn-chip bn-view-toggle" + (state.view === "table" ? " active" : ""),
      text: "Таблица",
    });
    tableViewBtn.addEventListener("click", () => {
      state.view = "table";
      this.draw(container, cfg, state, sourcePath);
    });
    const boardViewBtn = searchRow.createSpan({
      cls: "bn-chip bn-view-toggle" + (state.view === "kanban" ? " active" : ""),
      text: cfg.flat ? "Карточки" : "Доска",
    });
    boardViewBtn.addEventListener("click", () => {
      state.view = "kanban";
      this.draw(container, cfg, state, sourcePath);
    });

    const searchInput = searchRow.createEl("input", {
      cls: "bn-search-input",
      type: "text",
      placeholder: "Поиск по всем полям карточки…",
    });
    searchInput.value = state.searchQuery;
    if (state.searchQuery) {
      const clearSearch = searchRow.createSpan({ cls: "bn-search-clear", text: "×" });
      clearSearch.setAttr("aria-label", "Очистить поиск");
      clearSearch.addEventListener("click", () => {
        state.searchQuery = "";
        this.draw(container, cfg, state, sourcePath);
        const newInput = container.querySelector(".bn-search-input") as HTMLInputElement | null;
        newInput?.focus();
      });
    }
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

    const baseTaskToggle = searchRow.createSpan({
      cls: "bn-chip bn-base-task-toggle" + (state.onlyBaseTasks ? " active" : ""),
      text: "Только базовые задачи",
    });
    baseTaskToggle.addEventListener("click", () => {
      state.onlyBaseTasks = !state.onlyBaseTasks;
      this.draw(container, cfg, state, sourcePath);
    });

    if (cfg.showTags && otherTags.size) {
      const tagRow = toolbar.createDiv({ cls: "bn-row" });
      const tagMode = state.tagFilterMode;
      const tagLabel = tagRow.createSpan({
        cls: "bn-row-label bn-row-label-toggle" + (tagMode === "exclude" ? " active" : ""),
        text: `Теги · ${tagMode === "exclude" ? "исключать" : "включать"}`,
      });
      tagLabel.setAttr("aria-label", "Переключить режим фильтра: включать или исключать");
      tagLabel.addEventListener("click", () => {
        state.tagFilterMode = tagMode === "include" ? "exclude" : "include";
        this.draw(container, cfg, state, sourcePath);
      });
      Array.from(otherTags)
        .sort()
        .forEach((tag) => {
          const chip = tagRow.createSpan({
            cls:
              "bn-chip" +
              (state.activeTags.has(tag) ? " active" : "") +
              (tagMode === "exclude" && state.activeTags.has(tag) ? " bn-chip-exclude" : ""),
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
      const mode = state.facetFilterModes.get(field) ?? "include";

      const row = toolbar.createDiv({ cls: "bn-row" });
      const label = row.createSpan({
        cls: "bn-row-label bn-row-label-toggle" + (mode === "exclude" ? " active" : ""),
        text: `${field} · ${mode === "exclude" ? "исключать" : "включать"}`,
      });
      label.setAttr("aria-label", "Переключить режим фильтра: включать или исключать");
      label.addEventListener("click", () => {
        state.facetFilterModes.set(field, mode === "include" ? "exclude" : "include");
        this.draw(container, cfg, state, sourcePath);
      });
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
              (mode === "exclude" && active.has(val) ? " bn-chip-exclude" : "") +
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
    allCards: Card[],
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

    const children = this.childCardsOf(allCards, c.file.path, cfg.baseTaskField);
    if (children.length) {
      const doneSet = this.doneStatusesOf(cfg);
      const done = children.filter((ch) => doneSet.has(String(ch.fm[cfg.statusField] ?? ""))).length;
      card.createDiv({
        cls: "bn-card-progress" + (done === children.length ? " bn-card-progress-done" : ""),
        text: `${done}/${children.length} готово`,
      });
    }

    const coverValue = cfg.coverField ? c.fm[cfg.coverField] : null;
    if (typeof coverValue === "string" && coverValue.trim()) {
      const wikilink = coverValue.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
      const target = wikilink ? wikilink[1] : coverValue;
      const coverFile = this.app.metadataCache.getFirstLinkpathDest(target, c.file.path);
      if (coverFile instanceof TFile) {
        card.createEl("img", {
          cls: "bn-card-cover",
          attr: {
            src: this.app.vault.getResourcePath(coverFile),
            alt: `Обложка: ${String(title)}`,
            loading: "lazy",
          },
        });
      }
    }

    const metaBits: string[] = [];
    cfg.meta.forEach((field) => {
      const v = c.fm[field];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
      const display = Array.isArray(v) ? v.map(String).join(", ") : String(v);
      metaBits.push(field === "Оценка" || field === "оценка" ? `★ ${display}` : display);
    });
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
    allCards: Card[],
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
      this.renderCardEl(list, cfg, state, c, allCards, container, sourcePath, true)
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
        if (String(fm[cfg.statusField] ?? "") !== status) {
          fm[cfg.statusField] = status;
          if (cfg.autoArchive) fm[cfg.autoArchive.statusChangedField] = this.today();
        }
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
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fieldLineRe = new RegExp(`^${escapedField}:.*$`, "m");

    if (!fmMatch) {
      return `---\n${field}: ${value}\n---\n${content}`;
    }

    const frontmatter = fmMatch[0];
    const updatedFrontmatter = fieldLineRe.test(frontmatter)
      ? frontmatter.replace(fieldLineRe, `${field}: ${value}`)
      : frontmatter.replace(/^---\r?\n/, `---\n${field}: ${value}\n`);

    return updatedFrontmatter + content.slice(frontmatter.length);
  }

  async createSubtask(cfg: BoardConfig, boardPath: string, parent: TFile) {
    const cards = this.getCards(cfg, boardPath);
    await this.createCard(cfg, cards, undefined, parent);
  }

  private async inheritSubtaskFields(cfg: BoardConfig, parent: TFile, child: TFile) {
    const parentFm = this.app.metadataCache.getFileCache(parent)?.frontmatter ?? {};
    const excluded = new Set(
      [
        cfg.statusField,
        cfg.orderField,
        cfg.baseTaskField,
        cfg.autoArchive?.statusChangedField,
        "created",
        "updated",
      ]
        .filter((field): field is string => Boolean(field))
        .map((field) => field.toLocaleLowerCase())
    );

    await this.app.fileManager.processFrontMatter(child, (fm) => {
      for (const [field, value] of Object.entries(parentFm)) {
        if (!excluded.has(field.toLocaleLowerCase())) fm[field] = value;
      }
    });
  }

  async createCard(cfg: BoardConfig, cards: Card[], status?: string, baseTask?: TFile) {
    const folder = (cfg.folder ?? "").replace(/^\/+|\/+$/g, "");
    const base = "Новая заметка";
    let name = base;
    let n = 1;
    const cardPath = (cardName: string) =>
      folder ? `${folder}/${cardName}.md` : `${cardName}.md`;
    while (this.app.vault.getAbstractFileByPath(cardPath(name))) {
      n += 1;
      name = `${base} ${n}`;
    }
    const path = cardPath(name);

    let content = status
      ? `---\n${cfg.statusField}: ${status}\n---\n${cfg.tag}\n`
      : `---\n---\n${cfg.tag}\n`;

    if (cfg.template) {
      const tpl = this.app.vault.getAbstractFileByPath(cfg.template);
      if (tpl instanceof TFile) {
        const tplContent = await this.app.vault.read(tpl);
        content = status
          ? this.setFrontmatterField(tplContent, cfg.statusField, status)
          : tplContent;
      } else {
        new Notice(`board-notes: шаблон не найден — ${cfg.template}`);
      }
    }

    const order = this.nextOrder(cfg, cards, status);
    content = this.setFrontmatterField(content, cfg.orderField, String(order));
    if (baseTask) {
      const target = baseTask.path.replace(/\.md$/i, "");
      content = this.setFrontmatterField(
        content,
        cfg.baseTaskField,
        JSON.stringify(`[[${target}]]`)
      );
    }
    if (cfg.autoArchive) {
      content = this.setFrontmatterField(content, cfg.autoArchive.statusChangedField, this.today());
    }

    try {
      const file = await this.app.vault.create(path, content);
      if (baseTask) await this.inheritSubtaskFields(cfg, baseTask, file);
      await this.app.workspace.getLeaf(baseTask ? "tab" : false).openFile(file);
    } catch (e) {
      new Notice("board-notes: не удалось создать заметку — " + e);
    }
  }

  serializeConfig(cfg: BoardConfig): string {
    return serializeBoardConfig(cfg);
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

interface TableSortRow {
  fieldInput: HTMLInputElement;
  directionSelect: HTMLSelectElement;
  row: HTMLElement;
  deleted: boolean;
}

class BoardSettingsModal extends Modal {
  private folderInput!: HTMLInputElement;
  private templateInput!: HTMLInputElement;
  private viewSelect!: HTMLSelectElement;
  private cardRatingInput!: HTMLInputElement;
  private cardRecInput!: HTMLInputElement;
  private columnRows: EditableRow[] = [];
  private vocabRows: Map<string, EditableRow[]> = new Map();
  private vocabFieldOrder: string[] = [];
  private cardFieldRows: EditableRow[] = [];
  private metaRows: EditableRow[] = [];
  private cardLinkRows: PairRow[] = [];
  private cardLabelRows: PairRow[] = [];
  private tableColumnRows: PairRow[] = [];
  private tableSortRows: TableSortRow[] = [];

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

  private availableFieldNames(): string[] {
    const fields = new Set<string>(["__title", this.cfg.statusField, this.cfg.orderField]);
    if (this.cfg.nameField) fields.add(this.cfg.nameField);
    [
      ...this.cfg.meta,
      ...this.cfg.facets,
      ...Object.keys(this.cfg.vocab),
      ...this.cfg.cardFields,
      ...this.cfg.cardLinks.map((link) => link.field),
      ...Object.keys(this.cfg.cardLabels),
      this.cfg.cardRatingField,
      this.cfg.cardRecField,
    ].forEach((field) => {
      if (field) fields.add(field);
    });
    this.plugin.getCards(this.cfg, this.boardPath).forEach((card) => {
      Object.keys(card.fm).forEach((field) => fields.add(field));
    });
    return Array.from(fields).sort((a, b) => {
      if (a === "__title") return -1;
      if (b === "__title") return 1;
      return a.localeCompare(b);
    });
  }

  private createFieldSuggestions(container: HTMLElement, fields: string[]): string {
    const id = `bn-field-suggestions-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const datalist = container.createEl("datalist", { attr: { id } });
    fields.forEach((field) => datalist.createEl("option", { value: field }));
    return id;
  }

  private makeEditableList(
    container: HTMLElement,
    values: string[],
    onDelete: (row: EditableRow) => void,
    fieldSuggestionsId?: string
  ): EditableRow[] {
    const rows: EditableRow[] = [];
    const list = container.createDiv({ cls: "bn-settings-list" });

    const addRow = (value: string) => {
      const row = list.createDiv({ cls: "bn-settings-row" });
      const input = row.createEl("input", { type: "text", value }) as HTMLInputElement;
      if (fieldSuggestionsId) input.setAttr("list", fieldSuggestionsId);
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
    labelPlaceholder: string,
    fieldSuggestionsId?: string
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
      if (fieldSuggestionsId) fieldInput.setAttr("list", fieldSuggestionsId);
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

  private makeTableSortList(
    container: HTMLElement,
    rules: TableSort[],
    fieldSuggestionsId?: string
  ): TableSortRow[] {
    const rows: TableSortRow[] = [];
    const list = container.createDiv({ cls: "bn-settings-list" });

    const addRow = (field: string, direction: "asc" | "desc") => {
      const row = list.createDiv({ cls: "bn-settings-row" });
      const fieldInput = row.createEl("input", {
        type: "text",
        value: field,
        placeholder: "поле или __title",
      }) as HTMLInputElement;
      if (fieldSuggestionsId) fieldInput.setAttr("list", fieldSuggestionsId);
      const directionSelect = row.createEl("select") as HTMLSelectElement;
      directionSelect.createEl("option", { value: "asc", text: "↑ по возрастанию" });
      directionSelect.createEl("option", { value: "desc", text: "↓ по убыванию" });
      directionSelect.value = direction;
      this.addMoveButtons(row);
      const del = row.createSpan({ cls: "bn-settings-del", text: "×" });
      const entry: TableSortRow = { fieldInput, directionSelect, row, deleted: false };
      del.addEventListener("click", () => {
        entry.deleted = true;
        row.style.display = "none";
      });
      rows.push(entry);
      return entry;
    };

    rules.forEach((rule) => addRow(rule.field, rule.direction));
    const addBtn = container.createDiv({ cls: "bn-settings-add", text: "+ добавить сортировку" });
    addBtn.addEventListener("click", () => addRow("", "asc"));
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
    const fieldSuggestionsId = this.createFieldSuggestions(contentEl, this.availableFieldNames());

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

    contentEl.createEl("label", { text: "Стартовое представление" });
    this.viewSelect = contentEl.createEl("select") as HTMLSelectElement;
    this.viewSelect.createEl("option", { value: "kanban", text: "Доска" });
    this.viewSelect.createEl("option", { value: "table", text: "Таблица" });
    this.viewSelect.value = this.cfg.view;

    // Колонки
    contentEl.createEl("h4", { text: "Колонки" });
    this.columnRows = this.makeEditableList(contentEl, this.cfg.columns, () => {});

    contentEl.createEl("h4", { text: "Таблица" });
    contentEl.createEl("p", {
      cls: "bn-settings-hint",
      text: "Поля и порядок колонок таблицы. Используй __title для названия заметки; подпись необязательна. Порядок также можно менять перетаскиванием заголовков таблицы.",
    });
    this.tableColumnRows = this.makePairList(
      contentEl,
      this.plugin.tableColumnsFor(this.cfg).map((column) => ({
        field: column.field,
        label: column.label ?? "",
      })),
      "поле или __title",
      "подпись колонки",
      fieldSuggestionsId
    );
    contentEl.createEl("div", { cls: "bn-settings-field-name", text: "Сортировки" });
    contentEl.createEl("p", {
      cls: "bn-settings-hint",
      text: "Сортировки применяются сверху вниз: первая имеет наивысший приоритет. Поле должно быть среди колонок таблицы.",
    });
    this.tableSortRows = this.makeTableSortList(contentEl, this.cfg.table.sort, fieldSuggestionsId);

    // Метаданные на лицевой стороне карточки доски (под названием)
    contentEl.createEl("h4", { text: "Метаданные на карточке доски" });
    contentEl.createEl("p", {
      cls: "bn-settings-hint",
      text: "Поля frontmatter, показываемые строкой под названием прямо на доске (не в развороте ```card```).",
    });
    this.metaRows = this.makeEditableList(contentEl, this.cfg.meta, () => {}, fieldSuggestionsId);

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
    newFieldInput.setAttr("list", fieldSuggestionsId);
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
    this.cardFieldRows = this.makeEditableList(contentEl, this.cfg.cardFields, () => {}, fieldSuggestionsId);

    contentEl.createEl("div", { cls: "bn-settings-field-name", text: "Ссылки (поле → подпись)" });
    this.cardLinkRows = this.makePairList(
      contentEl,
      this.cfg.cardLinks.map((l) => ({ field: l.field, label: l.label ?? "" })),
      "имя поля (например Морж)",
      "подпись ссылки",
      fieldSuggestionsId
    );

    contentEl.createEl("div", { cls: "bn-settings-field-name", text: "Подписи (поле → подпись)" });
    this.cardLabelRows = this.makePairList(
      contentEl,
      Object.entries(this.cfg.cardLabels).map(([field, label]) => ({ field, label })),
      "имя поля",
      "подпись",
      fieldSuggestionsId
    );

    contentEl.createEl("label", { text: "Поле оценки (необязательно)" });
    this.cardRatingInput = contentEl.createEl("input", {
      type: "text",
      value: this.cfg.cardRatingField ?? "",
      placeholder: "например Оценка",
    }) as HTMLInputElement;
    this.cardRatingInput.setAttr("list", fieldSuggestionsId);

    contentEl.createEl("label", { text: "Поле рекомендации (необязательно)" });
    this.cardRecInput = contentEl.createEl("input", {
      type: "text",
      value: this.cfg.cardRecField ?? "",
      placeholder: "например Рекомендация",
    }) as HTMLInputElement;
    this.cardRecInput.setAttr("list", fieldSuggestionsId);

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

      const tableColumns: TableColumn[] = this.byDomOrder(this.tableColumnRows)
        .filter((row) => !row.deleted)
        .map((row) => ({
          field: row.fieldInput.value.trim(),
          label: row.labelInput.value.trim() || undefined,
        }))
        .filter((column) => Boolean(column.field));
      const tableSort: TableSort[] = this.byDomOrder(this.tableSortRows)
        .filter((row) => !row.deleted)
        .map((row): TableSort => ({
          field: row.fieldInput.value.trim(),
          direction: row.directionSelect.value === "desc" ? "desc" : "asc",
        }))
        .filter((rule) => Boolean(rule.field));

      const newCfg: BoardConfig = {
        ...this.cfg,
        folder: newFolder || undefined,
        template: newTemplate || undefined,
        view: this.viewSelect.value === "table" ? "table" : "kanban",
        columns: newColumns,
        meta: newMeta,
        vocab: newVocab,
        cardFields: newCardFields,
        cardLinks: newCardLinks,
        cardLabels: newCardLabels,
        cardRatingField: this.cardRatingInput.value.trim() || undefined,
        cardRecField: this.cardRecInput.value.trim() || undefined,
        table: { columns: tableColumns, sort: tableSort },
      };

      await this.plugin.saveBoardConfig(this.boardPath, this.cfg.raw, newCfg);

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
      view: "kanban",
      table: { columns: [], sort: [] },
      raw: "",
      cardFields: [],
      cardLinks: [],
      cardLabels: {},
      baseTaskField: DEFAULT_BASE_TASK_FIELD,
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
