import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(new URL("../main.ts", import.meta.url), "utf8");
const bundle = await build({
  stdin: {
    contents: `${source}\nexport { BoardSettingsModal, parseBoardConfig, serializeBoardConfig, cardBasename, TFile as TestTFile, parseYaml as parseTestYaml }; export { stringifyYaml as stringifyTestYaml } from "obsidian"; export { groupCards as testGroupCards } from "./card-groups";`,
    resolveDir: root, sourcefile: "main.ts", loader: "ts",
  },
  bundle: true, write: false, format: "iife", globalName: "BoardTest",
  plugins: [{
    name: "test-obsidian-api",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ resolveDir: root, contents: `
        import { load, dump } from "js-yaml";
        export const parseYaml = load, stringifyYaml = dump;
        export class App {}
        export class TFile {
          constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\\.md$/, ''); this.extension = 'md'; this.stat = {mtime: 0}; }
        }
        export class Plugin { constructor(app) { this.app = app; } }
        export class MarkdownRenderChild {}
        export class Modal {
          constructor(app) { this.app = app; this.contentEl = document.createElement('section'); }
          open() { document.body.append(this.contentEl); window.lastModal = this; this.onOpen?.(); }
          close() { this.onClose?.(); this.contentEl.remove(); }
        }
        export class FuzzySuggestModal extends Modal {}
        export class Notice { constructor(message) { (window.notices ??= []).push(message); } }
      ` }));
    },
  }],
});
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  const page = await browser.newPage();
  await page.evaluate(() => {
    HTMLElement.prototype.createEl = function(tag, options = {}) {
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(options)) {
        if (key === "cls") el.className = value;
        else if (key === "text") el.textContent = value;
        else if (key === "attr") for (const [name, content] of Object.entries(value)) el.setAttribute(name, content);
        else el[key] = value;
      }
      this.append(el); return el;
    };
    HTMLElement.prototype.createDiv = function(options) { return this.createEl("div", options); };
    HTMLElement.prototype.createSpan = function(options) { return this.createEl("span", options); };
    HTMLElement.prototype.empty = function() { this.replaceChildren(); };
    HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
    HTMLElement.prototype.removeClass = function(...names) { this.classList.remove(...names); };
    HTMLElement.prototype.setAttr = function(name, value) { this.setAttribute(name, value); };
    HTMLElement.prototype.appendText = function(text) { this.append(document.createTextNode(text)); };
    HTMLElement.prototype.setText = function(text) { this.textContent = text; };
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [2026, 10, 19, 18, 30, 45])); }
    };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const { default: Plugin, BoardSettingsModal, parseBoardConfig, serializeBoardConfig, cardBasename } = BoardTest;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const files = new Map(), contents = new Map(), deleted = [], opened = [];
    let FileClass;
    // Obtain the mocked TFile constructor from a tiny fixture through a test global.
    // It must be the same constructor used by the real plugin's instanceof checks.
    FileClass = BoardTest.TestTFile;
    const fm = (file) => {
      const match = contents.get(file.path)?.match(/^---\n([\s\S]*?)\n---/);
      return match ? BoardTest.parseTestYaml(match[1]) : {};
    };
    const put = (path, content) => {
      const file = new FileClass(path); files.set(path, file); contents.set(path, content); return file;
    };
    const yaml = (data) => `---\n${BoardTest.stringifyTestYaml(data)}---\n`;
    const app = {
      vault: {
        getMarkdownFiles: () => Array.from(files.values()),
        getAbstractFileByPath: (path) => files.get(path),
        read: async (file) => contents.get(file.path),
        cachedRead: async (file) => contents.get(file.path),
        create: async (path, content) => { if (files.has(path)) throw new Error("exists"); return put(path, content); },
      },
      metadataCache: { getFileCache: (file) => ({
        frontmatter: fm(file),
        tags: [...contents.get(file.path).matchAll(/^#([\w-]+)/gm)].map((match) => ({tag: `#${match[1]}`})),
        sections: contents.get(file.path).includes("```") ? [{type: "code"}] : [],
      }), getFirstLinkpathDest: (target) => files.get(target) ?? files.get(`${target}.md`) ??
        [...files.values()].find((file) => file.basename === target) },
      fileManager: {
        processFrontMatter: async (file, update) => {
          const data = fm(file); update(data);
          contents.set(file.path, yaml(data) + contents.get(file.path).replace(/^---\n[\s\S]*?\n---\n?/, ""));
        },
        trashFile: async (file) => { deleted.push(file.path); files.delete(file.path); contents.delete(file.path); },
      },
      workspace: { getLeaf: () => ({ openFile: async (file) => opened.push(file.path) }) },
    };
    const plugin = new Plugin(app);
    const cfg = parseBoardConfig('tag: "#home-task"\nfolder: Cards\ntemplate: Template.md\nexclude: [Template.md, Excluded.md]\ncolumns: [Новое, Готово, Архив]');
    check(cfg.timestampFilenames, "Timestamp names must be enabled by default");
    check(!parseBoardConfig(serializeBoardConfig({...cfg, timestampFilenames: false})).timestampFilenames, "Explicit opt-out must survive settings save");
    put("Template.md", '---\nНазвание:\n  "{ NAME }":\ncreated: 2020-01-01\nupdated: 2020-01-01\nГод: "{{VALUE:Год}}"\nСтатус: Новое\n---\n#home-task\n\n```card\n```\n');
    put("Home.md", `\`\`\`board\n${cfg.raw}\n\`\`\`\n`);
    const before = files.size;
    const cancelled = plugin.createCard(cfg, "Новое");
    window.lastModal.contentEl.querySelector('button[type="button"]').click();
    check(await cancelled === null && files.size === before, "Cancel must create no files");
    const title = 'Заменить фильтр: "кухня" $& $$';
    const [first, second] = await Promise.all([
      plugin.createCard(cfg, "Новое", undefined, title),
      plugin.createCard(cfg, "Новое", undefined, title),
    ]);
    check(first && second && first.path !== second.path, "Concurrent identical titles must get different paths");
    check(first.path.includes("2026-11-19 18-30-45"), "Filename must contain local creation time");
    check(!/[\\:*?"<>|]/.test(first.basename), "Filename must be portable");
    check(fm(first).Название === title && fm(second).Название === title, "Display title must preserve punctuation and exclude timestamp");
    check(String(fm(first).created).includes("2026"), "Creation date must not come from stale template");
    check(contents.get(first.path).includes("```card\n```"), "Template blocks must be preserved");
    check(new TextEncoder().encode(cardBasename("я".repeat(200), "2026-11-19 18-30-45")).length < 250, "Long Cyrillic titles must fit filesystem limits");
    const card = plugin.getCards(cfg, "Home.md").find((card) => card.file === first);
    const parent = document.body.createDiv();
    plugin.renderCardEl(parent, cfg, {}, card, [card], parent, "Home.md", false);
    check(parent.querySelector(".bn-card-title").textContent === title, "Board must render the short title");
    check(plugin.tableValue(card, {field: "__title"}, cfg) === title, "Table must render the short title");
    const child = await plugin.createCard(cfg, "Новое", first, "Подзадача");
    check(fm(child).Название === "Подзадача", "Child must not inherit its parent's title");
    check(fm(child).BaseTask === `[[${first.path.replace(/\.md$/, "")}]]`, "Child link must target the actual timestamped path");
    const noStamp = await plugin.createCard({...cfg, timestampFilenames: false}, "Новое", undefined, "Обычное имя");
    check(noStamp.path === "Cards/Обычное имя.md", "Opt-out must keep readable plain filenames");
    const otherCfg = parseBoardConfig('tag: "#dacha-task"\nfolder: Dacha\ncolumns: [Новое, Архив]');
    put("Dacha.md", `\`\`\`board\n${otherCfg.raw}\n\`\`\`\n`);
    const custom = await plugin.createCard({...otherCfg, nameField: "Модель"}, "Новое", undefined, "Насос");
    check(fm(custom).Модель === "Насос", "Configured title fields must work");
    const boards = await plugin.listBoards();
    check(boards.length === 2, "QuickAdd must list boards, not ordinary code blocks");
    const quick = await plugin.createCardOnBoard("Dacha.md", "#dacha-task", "Полить грядки");
    check(quick.path.startsWith("Dacha/") && fm(quick).Название === "Полить грядки", "QuickAdd API must use the board's creation path");
    const archived = (path, tag = "home-task") => put(path, yaml({tags: [tag], Статус: "Архив"}));
    const a = archived("Cards/old-a.md"), b = archived("Cards/old-b.md");
    archived("Excluded.md"); archived("Dacha/other.md", "dacha-task");
    const settings = new BoardSettingsModal(app, plugin, cfg, "Home.md"); settings.open();
    const cleanupButton = [...settings.contentEl.querySelectorAll("button")].find((el) => el.textContent === "Очистить архив…");
    check(cleanupButton && deleted.length === 0, "Archive cleanup must be in settings and must not run immediately");
    cleanupButton.click();
    const confirmation = window.lastModal;
    check(confirmation.contentEl.textContent.includes("2"), "Confirmation must count only this board's archive");
    [...confirmation.contentEl.querySelectorAll("button")].find((el) => el.textContent === "Отмена").click();
    check(deleted.length === 0, "Cancelling archive cleanup must preserve files");
    cleanupButton.click();
    await app.fileManager.processFrontMatter(a, (data) => { data.Статус = "Новое"; });
    archived("Cards/late.md");
    window.lastModal.contentEl.querySelector("button.mod-warning").click();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    check(deleted.length === 1 && deleted[0] === b.path, "Cleanup must skip restored cards, new arrivals, other boards and excluded notes");
    check(!plugin.archiveStatus({...cfg, flat: true}), "Flat boards must not offer cleanup");
    check(!plugin.archiveStatus({...cfg, columns: ["Новое", "Готово"]}), "Last column must not be treated as archive by default");
    const mediaCfg = parseBoardConfig('tag: "#anime"\ncolumns: [посмотреть, просмотрено, дропнул]\ndoneStatuses: [просмотрено]');
    check(plugin.doneStatusesOf(mediaCfg).has("просмотрено") && !plugin.doneStatusesOf(mediaCfg).has("дропнул"), "Media progress must count the configured completed status rather than the last column");
    check(parseBoardConfig(serializeBoardConfig(mediaCfg)).doneStatuses[0] === "просмотрено", "Completed statuses must survive a settings save");
    const seriesCfg = parseBoardConfig('tag: "#series-test"\nbaseTaskField: Series\ncolumns: [Новое, Готово]\ntable:\n  columns: [{field: __title}]');
    const seriesCard = (name, score, base) => {
      const file = put(`Series/${name}.md`, yaml({Название: name, Статус: "Новое", Оценка: score, Series: base}));
      return {file, fm: fm(file), tags: ["#series-test"]};
    };
    const baseA = seriesCard("Base A", 1), baseB = seriesCard("Base B", 2);
    const ordinary = seriesCard("Ordinary", 10);
    const hiddenChild = seriesCard("Hidden child", 9, "[[Series/Base A|Alias]]");
    const childB = seriesCard("Child B", 8, "[[Base B]]");
    const allSeries = [ordinary, hiddenChild, baseA, childB, baseB];
    const sortedNames = (cards, direction) => plugin.sortCards(cards, [{field: "Оценка", direction}], seriesCfg, allSeries).map((card) => card.file.basename).join(",");
    check(sortedNames([ordinary, baseA, baseB], "desc") === "Base B,Base A,Ordinary", "Parents must stay above ordinary cards even when their children are filtered out; descending sort must remain inside each group");
    check(sortedNames([ordinary, baseA, baseB], "asc") === "Base A,Base B,Ordinary", "Ascending sort must remain inside the parent group");
    check(plugin.sortCards([ordinary, baseA], [], seriesCfg).at(0) === baseA, "Cards without children must keep the existing path ordering");
    const state = {hiddenColumns: new Set(), tableFilters: new Map(), tableSort: [{field: "Оценка", direction: "desc"}]};
    const tableHost = document.body.createDiv();
    plugin.drawTable(tableHost, seriesCfg, state, [ordinary, baseA, baseB], "Series.md", allSeries);
    check([...tableHost.querySelectorAll("tbody tr")].map((row) => row.textContent).join(",") === "Base B,Base A,Ordinary", "Table must use parent-first ordering");
    const originalRenderer = plugin.renderCardEl;
    const rendered = [];
    plugin.renderCardEl = (_host, _cfg, _state, card) => { rendered.push(card.file.basename); };
    plugin.drawFlatGrid(document.body.createDiv(), seriesCfg, state, [ordinary, baseA, baseB], allSeries, "Series.md");
    check(rendered.join(",") === "Base B,Base A,Ordinary", "Flat grids must use parent-first ordering");
    rendered.length = 0;
    plugin.drawColumn(document.body.createDiv(), document.body.createDiv(), seriesCfg, state, "Новое", [ordinary, baseA, baseB], allSeries, "Series.md");
    check(rendered.join(",") === "Base B,Base A,Ordinary", "Kanban columns must use parent-first ordering");
    plugin.renderCardEl = originalRenderer;
    const middle = seriesCard("Nested series", 7, "[[Base A]]");
    const leaf = seriesCard("Nested part", 10, "[[Nested series]]");
    const sibling = seriesCard("Another part", 9, "[[Base A]]");
    const hierarchy = [ordinary, leaf, baseA, middle, sibling];
    const groupHost = document.body.createDiv({cls: "board-notes"});
    const groupBoard = groupHost.createDiv({cls: "bn-board"});
    plugin.drawColumn(groupBoard, groupHost, seriesCfg, state, "Новое", hierarchy, hierarchy, "Series.md");
    const outer = groupBoard.querySelector('.bn-card-group[data-base-path="Series/Base A.md"]');
    check(outer && outer.querySelector(":scope > .bn-card-group-title").textContent === "Base A", "Groups must have the base card's title");
    check(outer.querySelector(":scope > .bn-card-group-body > .bn-card").dataset.path === baseA.file.path, "Base card must precede every nested group and part in its column");
    const inner = outer.querySelector('.bn-card-group[data-base-path="Series/Nested series.md"]');
    check(inner && inner.querySelector(":scope > .bn-card-group-body > .bn-card").dataset.path === middle.file.path, "Nested bases must also come first inside their own group");
    check(inner.querySelectorAll(".bn-card").length === 2, "Nested group must contain its base and part");
    check(groupBoard.querySelectorAll(".bn-card").length === hierarchy.length, "Grouping must render every visible card exactly once");
    const beforeOpen = opened.length;
    outer.querySelector(":scope > .bn-card-group-title").click();
    check(opened.length === beforeOpen + 1 && opened.at(-1) === baseA.file.path, "Clicking a group title must open its base note");
    const filteredHost = document.body.createDiv();
    plugin.drawColumn(filteredHost, filteredHost, seriesCfg, state, "Новое", [leaf, sibling], hierarchy, "Series.md");
    check(filteredHost.querySelectorAll(".bn-card-group").length === 2 && filteredHost.querySelectorAll(".bn-card").length === 2, "Filtering must retain ancestor labels without showing filtered-out base cards");
    middle.fm.Статус = "Готово";
    await app.fileManager.processFrontMatter(middle.file, (data) => { data.Статус = "Готово"; });
    const otherColumn = document.body.createDiv();
    plugin.drawColumn(otherColumn, otherColumn, seriesCfg, state, "Новое", hierarchy, hierarchy, "Series.md");
    check(otherColumn.querySelectorAll(".bn-card").length === hierarchy.length - 1 && otherColumn.querySelectorAll(".bn-card-group").length === 2, "A base in another column must still label its descendants without being duplicated as a card");
    const target = document.body.createDiv();
    plugin.drawColumn(target, target, seriesCfg, state, "Готово", hierarchy, hierarchy, "Series.md");
    const transfer = new DataTransfer();
    const dragged = otherColumn.querySelector('[data-path="Series/Nested part.md"]');
    dragged.dispatchEvent(new DragEvent("dragstart", {bubbles: true, dataTransfer: transfer}));
    target.querySelector(".bn-list").dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: transfer}));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    check(fm(leaf.file).Статус === "Готово" && fm(leaf.file).Series === "[[Nested series]]", `Dragging a nested card must change only its status and preserve its base link: ${JSON.stringify({data: transfer.getData("text/plain"), frontmatter: fm(leaf.file)})}`);
    check(fm(baseA.file).Статус === "Новое" && fm(sibling.file).Статус === "Новое", "Dragging a part must not move its base or siblings");
    const cycleA = seriesCard("Cycle A", 1, "[[Cycle B]]"), cycleB = seriesCard("Cycle B", 2, "[[Cycle A]]");
    const missing = seriesCard("Missing base", 3, "[[Missing]]"), self = seriesCard("Self", 4, "[[Self]]");
    const cycleHost = document.body.createDiv();
    plugin.drawColumn(cycleHost, cycleHost, seriesCfg, state, "Новое", [cycleA, cycleB, missing, self], [cycleA, cycleB, missing, self], "Series.md");
    check(cycleHost.querySelectorAll(".bn-card").length === 4, "Cyclic, missing and self links must not hide or duplicate cards");
    const deep = Array.from({length: 5000}, (_, i) => ({file: {path: `deep/${i}`}, fm: {parent: i ? `deep/${i - 1}` : null}, tags: []}));
    const forest = BoardTest.testGroupCards([deep.at(-1)], deep, (card) => card.fm.parent ? [card.fm.parent] : [], () => 0);
    let node = forest[0], depth = 0;
    while (node) { depth++; node = node.children[0]; }
    check(depth === 5000, "Grouping must support arbitrary depth without recursive stack limits");
    const multi = seriesCard("Multiple bases", 5, ["[[Missing]]", "[[Base B]]", "[[Base A]]"]);
    const multiHost = document.body.createDiv();
    plugin.drawColumn(multiHost, multiHost, seriesCfg, state, "Новое", [multi], [multi, baseA, baseB], "Series.md");
    check(multiHost.querySelectorAll(".bn-card").length === 1 && multiHost.querySelector(".bn-card-group").dataset.basePath === baseB.file.path, "Multiple links must use the first valid base without duplicating the card");
    const tableBase = seriesCard("Table series", 1);
    const tableNested = seriesCard("Table nested", 2, "[[Table series]]");
    const tableLeaf = seriesCard("Table leaf", 8, "[[Table nested]]");
    const tableSibling = seriesCard("Table sibling", 9, "[[Table series]]");
    const tableLoose = seriesCard("Table loose", 10);
    const tableCards = [tableLoose, tableSibling, tableLeaf, tableNested, tableBase];
    const treeCfg = {...seriesCfg, table: {columns: [{field: "__title"}, {field: "Оценка"}], sort: []}};
    const treeState = {...state, collapsedTableGroups: new Set(), tableFilters: new Map()};
    const treeHost = document.body.createDiv({cls: "board-notes"});
    const previousDraw = plugin.draw;
    const redrawTree = () => { treeHost.empty(); plugin.drawTable(treeHost, treeCfg, treeState, tableCards, "Tree.md", tableCards); };
    plugin.draw = redrawTree;
    const treePaths = () => [...treeHost.querySelectorAll("tbody tr")].map((row) => row.dataset.path);
    const tableOrder = [tableBase, tableNested, tableLeaf, tableSibling, tableLoose].map((card) => card.file.path);
    const tableBefore = tableCards.map((card) => contents.get(card.file.path)).join("\n");
    redrawTree();
    check(treeHost.querySelector('table[role="treegrid"]') && treePaths().join() === tableOrder.join(), "Table must render a contiguous depth-first hierarchy, with parents first and loose cards last");
    check([...treeHost.querySelectorAll("tbody tr")].map((row) => row.dataset.depth).join() === "0,1,2,1,0", "Table rows must expose their actual nesting depth");
    const openedBeforeToggle = opened.length;
    const toggleTree = (card) => treeHost.querySelector(`tr[data-path="${card.file.path}"] .bn-table-tree-toggle`).click();
    toggleTree(tableNested);
    check(!treePaths().includes(tableLeaf.file.path) && treePaths().length === 4, "Collapsing a nested branch must hide only its descendants");
    toggleTree(tableBase);
    check(treePaths().join() === [tableBase.file.path, tableLoose.file.path].join(), "Collapsing the root must keep the root and unrelated cards");
    toggleTree(tableBase);
    check(treePaths().length === 4 && !treePaths().includes(tableLeaf.file.path), "Nested collapse state must survive parent collapse and redraw");
    toggleTree(tableNested);
    check(treePaths().join() === tableOrder.join() && opened.length === openedBeforeToggle, "Expanding a branch must restore its rows without opening or editing notes");
    check(tableCards.map((card) => contents.get(card.file.path)).join("\n") === tableBefore, "Tree view state must never write note frontmatter");
    const leafCell = treeHost.querySelector(`tr[data-path="${tableLeaf.file.path}"] td:nth-child(2)`);
    leafCell.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check(leafCell.querySelector("input"), "Nested table cells must retain inline editing");
    leafCell.querySelector("input").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    check(treePaths().join() === tableOrder.join(), "Cancelling inline editing must preserve the tree");
    check(tableCards.map((card) => contents.get(card.file.path)).join("\n") === tableBefore, "Escape must cancel editing without a deferred blur save or a second redraw");
    treeState.tableFilters.set("__title", "Table leaf");
    redrawTree();
    check(treePaths().join() === [tableBase.file.path, tableNested.file.path, tableLeaf.file.path].join(), "Filtering a nested match must retain only its ancestor chain and the matching row");
    check(treeHost.querySelectorAll(".bn-table-context").length === 2 && [...treeHost.querySelectorAll(".bn-table-context td:nth-child(2)")].every((cell) => cell.textContent === ""), "Context rows must not expose filtered-out field values");
    const contextTitle = treeHost.querySelector(".bn-table-context td");
    contextTitle.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check(!contextTitle.querySelector("input"), "Context rows must not accidentally edit hidden base cards");
    const noTitleHost = document.body.createDiv();
    plugin.drawTable(noTitleHost, {...treeCfg, table: {columns: [{field: "Оценка"}], sort: []}}, treeState, tableCards, "Tree.md", tableCards);
    check(noTitleHost.querySelector("th").dataset.field === "__title" && noTitleHost.querySelectorAll("tbody tr").length === 3, "A table without a configured title column must still display and filter its hierarchy");
    const cycleTable = document.body.createDiv();
    plugin.drawTable(cycleTable, treeCfg, {...state, tableFilters: new Map()}, [cycleA, cycleB, missing, self], "Tree.md", [cycleA, cycleB, missing, self]);
    check(cycleTable.querySelectorAll("tbody tr").length === 4, "Cyclic and orphan table links must not hide or duplicate rows");
    const deepTableCards = [];
    for (let i = 0; i < 100; i++) deepTableCards.push(seriesCard(`Table depth ${i}`, i, i ? `[[Table depth ${i - 1}]]` : undefined));
    const deepTable = document.body.createDiv();
    plugin.drawTable(deepTable, seriesCfg, {...state, tableFilters: new Map()}, [deepTableCards.at(-1)], "Tree.md", deepTableCards);
    check(deepTable.querySelectorAll("tbody tr").length === 100 && deepTable.querySelector('tr[data-depth="99"]'), "Table rendering must have no fixed nesting-depth limit");
    treeState.tableFilters.clear();
    redrawTree();
    plugin.draw = previousDraw;
    window.tableTreePreview = treeHost;
    window.groupPreview = groupHost;
    window.actionFixture = {app, plugin, files, contents};
    return {created: opened.length, trashed: deleted.length};
  });
  assert.ok(result.created >= 6);
  assert.equal(result.trashed, 1);
  if (process.env.BOARD_NOTES_QUICKADD_SCRIPT) {
    const script = await readFile(process.env.BOARD_NOTES_QUICKADD_SCRIPT, "utf8");
    await page.evaluate(async (script) => {
      const module = {exports: {}};
      new Function("module", script)(module);
      const {app, plugin, files} = window.actionFixture;
      app.plugins = {getPlugin: () => plugin};
      const params = {app, obsidian: {Notice: class {}}, quickAddApi: {
        suggester: async (_labels, boards) => boards.find((board) => board.tag === "#home-task"),
        format: async (content) => content.replaceAll("{{VALUE:Год}}", "2026"),
      }};
      const fillName = (title) => {
        const modal = window.lastModal;
        modal.contentEl.querySelector("input").value = title;
        modal.contentEl.querySelector("form").dispatchEvent(new Event("submit", {cancelable: true}));
      };
      const all = module.exports.entry(params, {});
      for (let i = 0; i < 20; i++) await Promise.resolve();
      fillName("Из QuickAdd"); await all;
      if (![...files.keys()].some((path) => path.startsWith("Cards/Из QuickAdd — "))) throw new Error("QuickAdd picker creation failed");
      const created = [...files.values()].find((file) => file.path.startsWith("Cards/Из QuickAdd — "));
      if (app.metadataCache.getFileCache(created).frontmatter.Год !== "2026") throw new Error("QuickAdd must still format template inputs");
      const fixed = module.exports.entry(params, {"Доска": "Dacha.md", "Тег": "#dacha-task"});
      for (let i = 0; i < 20; i++) await Promise.resolve();
      fillName("Задача на даче"); await fixed;
      if (![...files.keys()].some((path) => path.startsWith("Dacha/Задача на даче — "))) throw new Error("QuickAdd direct board creation failed");
    }, script);
  }
  if (process.env.BOARD_NOTES_GROUP_SCREENSHOT_DIR) {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
    await page.addStyleTag({content: css});
    await page.evaluate(() => {
      const preview = window.groupPreview;
      document.body.replaceChildren(preview);
      document.body.style.cssText = 'margin:24px;font:14px Arial;--background-primary:#fafafa;--background-secondary:#f2f2f2;--background-modifier-border:#aaa;--text-muted:#666;--text-normal:#222;--interactive-accent:#5688bb;background:#fafafa;color:#222';
    });
    await page.setViewportSize({width: 480, height: 760});
    await page.screenshot({path: `${process.env.BOARD_NOTES_GROUP_SCREENSHOT_DIR}/groups-light.png`});
    await page.evaluate(() => {
      document.body.style.cssText = 'margin:24px;font:14px Arial;--background-primary:#242424;--background-secondary:#1e1e1e;--background-modifier-border:#666;--text-muted:#aaa;--text-normal:#eee;--interactive-accent:#78aadd;background:#242424;color:#eee';
    });
    await page.screenshot({path: `${process.env.BOARD_NOTES_GROUP_SCREENSHOT_DIR}/groups-dark.png`});
    await page.evaluate(() => {
      if (!window.tableTreePreview.querySelector("tbody tr")) throw new Error("Tree preview must contain rendered rows");
      document.body.replaceChildren(window.tableTreePreview);
      document.body.style.cssText = 'margin:24px;font:14px Arial;--background-primary:#fafafa;--background-secondary:#f2f2f2;--background-modifier-border:#ccc;--text-muted:#666;--text-normal:#222;--background-modifier-hover:#eeeeee;background:#fafafa;color:#222';
    });
    await page.setViewportSize({width: 760, height: 540});
    await page.screenshot({path: `${process.env.BOARD_NOTES_GROUP_SCREENSHOT_DIR}/tree-light.png`});
    await page.evaluate(() => {
      document.body.style.cssText = 'margin:24px;font:14px Arial;--background-primary:#242424;--background-secondary:#1e1e1e;--background-modifier-border:#555;--text-muted:#aaa;--text-normal:#eee;--background-modifier-hover:#303030;background:#242424;color:#eee';
    });
    await page.screenshot({path: `${process.env.BOARD_NOTES_GROUP_SCREENSHOT_DIR}/tree-dark.png`});
  }
  console.log("Card actions passed: naming, subtask links, nested column groups, tree tables, branch collapse, filter context, nested editing, drag-and-drop, cycle recovery, unbounded hierarchy construction, parent-first sorting, completed statuses, QuickAdd API and archive scope.");
} finally {
  await browser.close();
}
