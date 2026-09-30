# Board Notes

Interactive Kanban boards for Obsidian, rendered from a single code block and backed entirely by note frontmatter.

No cache file. No separate database. Column order and card sort rules live in the board block, while moving a card changes only its status, so everything stays plain-text, git-diffable, and mergeable.

*(Русская версия: [README.ru.md](README.ru.md))*

## Why

Plugins like [obsidian-projects](https://github.com/marcusolsson/obsidian-projects) keep board state (card order, view config) in a `data.json` cache file inside the plugin folder. That cache can drift from the actual notes, gets corrupted by encoding issues, and doesn't merge cleanly across machines or in git.

Board Notes takes the opposite approach: every board is defined by a single ` ```board ` code block embedded in a note. It reads cards live from `metadataCache` by tag, and writes only the moved card's status back into its frontmatter. Nothing is cached outside the vault's own files.

## Features

- **Kanban board and table** from one code block — drag cards between columns; sort rules define their order, while the table supports creation, inline editing, filtering, and sorting
- **Search** across the title, tags, and every frontmatter field
- **Filter** by tag, by any frontmatter list field (genres, labels, whatever you configure), and by column visibility
- **Controlled vocabulary** — define an allowed list of values per field (e.g. genres, tags) so editors pick from a fixed list instead of typing free text and accumulating near-duplicate variants
- **Inline card view** (` ```card `) — renders rating, a link field, description, and recommendation directly in a note's body
- **Inline tag editor** (` ```tags `) — lets you edit a note's vocabulary-controlled fields from inside the note itself, not just from the board
- A command and a file-menu entry to edit vocabulary fields for the active note even when no board is open
- Quick-create notes from a template, pre-filled with the target column's status
- **Status from the card** (` ```card `) — a row of column chips; clicking one updates `statusField` in frontmatter right there, no need to visit the board
- **Board settings** (⚙ button in the toolbar) — edit folder, template, columns, vocab values, and the card layout from a modal; renaming a column or a vocab value batch-updates every card that used the old value
- **"Create new board" command** — a wizard (tag, folder, template, columns) that generates a ready-to-use ` ```board ` code block in a fresh note
- **Centralized card layout** — define ` ```card ` fields/links/labels once in the board config (`card:`) instead of copy-pasting them into every template and note; supports multiple links at once, not just one
- **Automatic dates** — fills empty `created` and `updated` fields with today's date once, without overwriting existing values (`YYYY-MM-DD`)
- **Auto-archive** (`autoArchive`) — moves cards from one status to another after N days, based on a "status changed" date that the plugin maintains itself
- **Subtasks** — a card can point to a base task via a link field; the base task shows a `done/total` progress badge on the board and a list of child tasks in its ` ```card `, and a **+ subtask** button creates a child that inherits the parent's fields
- **Copy buttons** — ⧉ next to card links and, for fields listed in `copyFields`, next to a value (e.g. a ticket ID)

## Documentation

- [What it looks like](docs/appearance.md) — board, cards, card template, table, settings
- [Getting started](docs/getting-started.md)
- [Examples](docs/examples.md)
- [Building from source](docs/building.md)

## Screenshots

See [What it looks like](docs/appearance.md) for text mockups of the board, the card and the card template. Real screenshots can be added here.

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest) (or build them yourself, see below).
2. Create the folder `<your-vault>/.obsidian/plugins/board-notes/`.
3. Put the three files in it.
4. In Obsidian: **Settings → Community plugins**, reload the plugin list, then enable **Board Notes**.

### BRAT (auto-updating beta install)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. In BRAT's settings, **Add Beta Plugin**, and paste this repo's URL.
3. Enable **Board Notes** in Community plugins afterward.

### Community plugin directory

Not yet submitted. Once it is, you'll be able to install it directly from **Settings → Community plugins → Browse**.

## Building from source

See [docs/building.md](docs/building.md) (scripts, file layout, vault deployment with `npm run deploy`, release steps).

## Quick start

Add a code block to any note:

````markdown
```board
tag: "#book"
folder: Books
columns:
  - to read
  - reading
  - done
```
````

Any note tagged `#book` becomes a card, grouped into columns by its `Статус`/`Status` frontmatter field (configurable). Drag a card to another column to change its status. Card order is always defined by the board's saved sort rules.

## Configuration reference

All options are read from the YAML inside the ` ```board ` block.

| Key | Type | Default | Description |
|---|---|---|---|
| `tag` | string | — (required) | The tag that defines which notes are cards on this board, e.g. `"#book"`. |
| `folder` | string | vault root | Folder new cards are created in via the "+ добавить" button. |
| `template` | string | — | Path to a template note. New cards are created from it, with the status field patched to match the column clicked. |
| `statusField` | string | `Статус` | Frontmatter field used to group cards into columns. |
| `nameField` | string | — | Frontmatter field to use as the card title. Falls back to a `Название` field, then the file's basename. |
| `columns` | string[] | inferred | Explicit, ordered list of status values to show as columns. If omitted, columns are inferred from whatever status values are actually in use. |
| `exclude` | string[] | `[]` | Vault-relative paths to exclude from the board even if tagged (e.g. the template file, if it carries the tag itself). The note hosting the board is always excluded automatically. |
| `facets` | string[] | `[]` | Frontmatter fields to expose as filter-chip rows in the toolbar (in addition to the automatic tag-filter row, which is always shown if the cards have extra tags). |
| `vocab` | map of string → string[] | `{}` | Controlled vocabulary per field. Any field listed here gets an editable chip panel (in the ` ```tags ` block, in the vocab command/modal, and inline on each card) restricted to these values. |
| `single` | string[] | `[]` | Subset of `vocab` field names that hold a single scalar value (not a list) — e.g. a priority or type field. Editing these replaces the value instead of toggling array membership. |
| `meta` | string[] | `[]` | Frontmatter fields shown on the card face in the board view. Only explicitly listed fields are shown. |
| `coverField` | string | — | Frontmatter field containing an Obsidian wikilink to an image to display above the title on each board card. |
| `baseTaskField` | string | `BaseTask` | Frontmatter field holding a wikilink to a card's base (parent) task. See [Subtasks](#subtasks). |
| `showTags` | boolean | `true` | Set to `false` to hide the automatic tag-filter row. Useful when notes carry incidental real Obsidian tags unrelated to the board (e.g. a literal `#include` in a code snippet gets indexed as a tag and shows up as noise). |
| `flat` | boolean | `false` | Skip Kanban columns entirely and render all matching cards as a single filterable grid. For reference indexes (FAQs, glossaries) that have topic tags but no workflow status — `statusField`/`columns` are ignored when this is set. |
| `view` | `kanban` or `table` | `kanban` | Initial representation. The toolbar switcher changes the current view without changing card data. |
| `table.columns` | list of `{field, label?}` | inferred | Table columns and their order. `__title` is a virtual note-title field (using `nameField`, then `Название`). Configure them in ⚙ or drag table headers. |
| `table.sort` | list of `{field, direction}` | `[]` | Persistent card sort rules in priority order, applied to both the board and table. `direction` is `asc` or `desc`; `__modified` is the note's modification date. Configure them in ⚙; the first rule has the highest priority. |
| `autoArchive` | object | — | Automatically moves cards from `source` to `target` after `afterDays` days since their last status change. `statusChangedField` defaults to `Статус изменён`. The check runs when Obsidian starts and hourly afterward. |
| `card` | object | `{}` | Centralized settings for the ` ```card ` block (see below) — `fields`, `links`, `labels`, `ratingField`, `recField`, `copyFields`. Applied to any note tagged for this board whose own ` ```card ` block is empty. |

### Table

Open it with the **Table** button in the toolbar or set `view: table`. The shared search and tag/facet filters apply to both representations. Each table header has a text filter; clicking its label sorts ascending or descending. Double-click a cell to edit frontmatter: status and `vocab` fields show their allowed values, while other fields use text input. Double-clicking `__title` edits `nameField` (or `Название`); a single click opens the note.

```yaml
view: table
table:
  columns:
    - field: __title
      label: Title
    - field: Status
    - field: Rating
  sort:
    - field: Status
      direction: asc
    - field: __title
      direction: asc
```

### Filters

Filter chips include matching cards by default. Click a row label (for example, `Теги · включать`) to switch that row to exclusion mode. Selected chips then hide cards matching any of those values and are displayed in red with a strike-through. Click the label again to return to inclusion mode; this is a view-only preference and does not change any notes.

### `card` block

Renders a compact summary of a note's own frontmatter, meant to sit inside the note itself (e.g. inside its template) as a readable alternative to the raw Properties panel.

Every field is click-to-edit — empty ones show a `+ field name` placeholder, filled ones show their value; clicking either turns it into an input (or a textarea for the description/recommendation-style fields), saving on blur or Enter, with Escape to cancel. This is the primary way to fill in or fix a field once you've hidden the Properties panel.

````markdown
```card
fields:
  - Оценка
  - Кинопоиск
  - Описание
  - Рекомендация
ratingField: Оценка
links:
  - field: Кинопоиск
    label: "Открыть на Кинопоиске ↗"
recField: Рекомендация
labels:
  Id: "ID"
```
````

| Key | Default | Description |
|---|---|---|
| `fields` | `[]` (or the board's `card.fields`) | Which frontmatter fields to render, in order. No fields are inferred when the setting is absent. |
| `ratingField` | — | The field to render as `★ <value>`. |
| `links` | `[]` | A list of links — each renders as its own row with a clickable link (if the value looks like a URL) and its own edit pencil. Add more than one, e.g. a Pyrus link plus a separate merge-request link. |
| `linkField` / `linkLabel` | — | Old-style way to set a **single** link — equivalent to `links: [{field: linkField, label: linkLabel}]`. Still works; don't mix `links` and `linkField` in the same block. |
| `recField` | — | The field to render in an italic, accent-bordered block. |
| `copyFields` | `[]` (or the board's `card.copyFields`) | Fields (from `labels`) that get a ⧉ button to copy the value to the clipboard — handy for IDs. Link rows always have their own ⧉ button for URL values. |
| `labels` | `{}` | Map of field name → display label for any other field in `fields`. Rendered as a small `Label: value` row instead of a full paragraph — use this for short metadata (IDs, counts) rather than prose. A value written as an Obsidian wikilink, such as `[[Базовая задача]]`, is rendered as a clickable internal link with a separate edit button. Fields in `fields` without a label and not matching one of the roles above are rendered as a plain paragraph (intended for longer text like a description). |
| `showStatus` | `true` | Set to `false` to hide the status chip row (see below). |

#### Centralized configuration

If the note's own ` ```card ` block is **empty** (no `fields`), the plugin looks for a board whose `tag` matches the note's tag and uses its `fields`/`links`/`labels`/`ratingField`/`recField`/`copyFields` instead (the `card:` key inside the ` ```board ` block):

````markdown
```board
tag: "#book"
folder: Books
card:
  fields:
    - Оценка
    - Кинопоиск
    - Описание
    - Рекомендация
  links:
    - field: Кинопоиск
      label: "Открыть на Кинопоиске ↗"
```
````

That way the template and every note of that type only carry a bare ` ```card ``` `, and the actual field/link list is edited in exactly one place — the board config (by hand, or via the ⚙ button, see below). If one specific note genuinely needs its own layout, just set `fields`/`links` in its own ` ```card ` block — it wins over the centralized config.

A card wired to a board also gets a small "⚙ поля карточки" button at the bottom — opens the same board settings modal, scrolled to the "Карточка" section.

If the note's tag matches a (non-`flat`) ` ```board ` board, a row of column chips is rendered above the fields — the active one is highlighted, and clicking another immediately switches the note's `statusField` in frontmatter. The column list comes from the board's `columns`, or, if not set explicitly, from whatever `statusField` values are actually in use, same as on the board itself.

### Subtasks

Set `baseTaskField` (default `BaseTask`) on a child card to a wikilink to its parent, e.g. `BaseTask: "[[Parent task]]"`.

- **Board** — the parent card shows a `done/total готово` badge; the toolbar has an **only base tasks** chip that hides everything except cards that have children.
- **Card** (` ```card `) — a "child tasks" section lists the children with their statuses and a `done/total` counter; a **+ subtask** button in the header creates a new card from the board's template, sets its base-task link, copies the parent's other frontmatter fields (except status, the base-task field, `created`/`updated` and the auto-archive date) and opens it in a new tab.
- **What counts as done** — with `autoArchive`, the `source` and `target` statuses; otherwise the last entry of `columns`.

### `tags` block

````markdown
```tags
```
````

Takes no configuration. Drop it into any note; it looks across the whole vault for a ` ```board ` block whose `tag` matches one of the current note's tags, and renders an editable chip panel for that board's `vocab` fields — including a small line naming which board/tag it resolved to, so you can confirm it's wired up correctly. If no matching board is found, it shows an error instead of silently doing nothing.

You can also trigger the same editor from any note via the command palette (**Board Notes: Редактировать теги/жанры по словарю доски**) or via right-click → **Теги/жанры по словарю** in the file menu — useful when a note doesn't have the `tags` block in its body.

### Board settings (⚙)

Every non-`flat` board's toolbar has a ⚙ button that opens a settings modal right over the code block, no manual YAML editing required:

- **Folder** and **Template** — same as the `folder`/`template` config keys; a "+ create note" button next to the template field creates a card straight from the modal.
- **Columns** — one text input per column (↑/↓ buttons reorder; the same buttons exist in the other lists):
  - editing the text **renames** the column, and updates `statusField` on every card that had the old value;
  - the × button deletes a column — any cards that were in it move to the first remaining column instead of disappearing from the board;
  - "+ add" appends a blank column at the end.
- **Tags / vocab** — same idea for each `vocab` field: renaming a value batch-updates every card that had it. A field at the bottom lets you add a brand-new vocab field.
- **Card** — editable lists for the centralized ` ```card ` config (see above): "Поля" (a plain list), "Ссылки" and "Подписи" (field → label pairs), "Копируемые поля", plus fields for the special rating and recommendation display. These aren't tied to individual cards, so renaming here doesn't touch any note — it just changes what an empty ` ```card ` block displays.
- "Save" rewrites the ` ```board ` code block itself (via `stringifyYaml`) and applies all the renames to cards in one go; the live board re-parses its config and redraws immediately, no need to reopen the note.

You can't rename the board's own `tag` from this modal — see Known limitations.

### Creating a new board

The **Board Notes: Создать новую доску** command (command palette, or the "+ create new board" button at the bottom of the settings modal) opens a wizard: note title, tag, card folder, template (optional), columns (one per line). Hitting "Create" generates a new note with a ready ` ```board ` code block and opens it.

## How data is stored

- **Column** = the note's `statusField` frontmatter value (a plain string).
- **Card order** = `table.sort` rules in the board block. Dragging never changes it or rewrites neighboring cards.
- **Vocabulary-controlled values** = plain frontmatter list fields (or scalar, for `single` fields) — the vocab list itself lives only in the `board` block's config, not duplicated per note.

Nothing is written outside the notes' own frontmatter. Deleting the plugin leaves your notes fully intact and readable as plain YAML frontmatter.

## Known limitations

- One board = one code block = one tag. Boards that need to mix multiple tags aren't supported.
- Cards can only be moved between columns: that changes one card's status, while order within a column is determined by sort rules.
- No mobile-specific touch drag-and-drop testing has been done.
- `vocab`/`facets` field names are matched by exact string — frontmatter field renames require updating the board config to match.
- The settings modal (⚙) can rename column and vocab *values* (with a batch card update), but not the board's own `tag` or field names (`statusField`, `vocab` keys) — those still need a manual code-block edit.

## Contributing

Issues and PRs welcome. The code lives in `main.ts` (plugin, views, modals), `config.ts` (board config parsing/serialization) and `types.ts` — no build framework beyond esbuild, no bundled UI library, just the Obsidian API and vanilla DOM calls.

## License

MIT — see [LICENSE](LICENSE).
