# Board Notes

Interactive Kanban boards for Obsidian, rendered from a single code block and backed entirely by note frontmatter.

No cache file. No separate database. Column and card order live in the notes themselves, so everything stays plain-text, git-diffable, and mergeable.

*(Русская версия: [README.ru.md](README.ru.md))*

## Why

Plugins like [obsidian-projects](https://github.com/marcusolsson/obsidian-projects) keep board state (card order, view config) in a `data.json` cache file inside the plugin folder. That cache can drift from the actual notes, gets corrupted by encoding issues, and doesn't merge cleanly across machines or in git.

Board Notes takes the opposite approach: every board is defined by a single ` ```board ` code block embedded in a note. It reads cards live from `metadataCache` by tag, and writes card order and status directly back into each card's frontmatter. Nothing is cached outside the vault's own files.

## Features

- **Kanban board** from a code block — drag and drop between and within columns
- **Search** across title, description, recommendation, and tags
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

## Screenshots

_(add your own — a board with a few columns, the inline card view, and the vocab editor panel)_

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

Requires Node.js (tested on v20+).

```bash
git clone <this-repo-url>
cd board-notes
npm install
npm run build       # one-shot production build -> main.js
npm run dev          # watch mode, rebuilds on save
```

When this repository is checked out as `plugins/board-notes` inside the companion vault
repository, deploy a verified build to Obsidian with `npm run deploy`. The command runs
the TypeScript check and production build, then copies `main.js`, `manifest.json`, and
`styles.css` to `notes/.obsidian/plugins/board-notes`.

`npm run build` produces a minified `main.js` with no source map. `npm run dev` produces an unminified build with an inline source map and watches for changes — point it at a symlinked/copied plugin folder inside a real vault for live development.

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

Any note tagged `#book` becomes a card, grouped into columns by its `Статус`/`Status` frontmatter field (configurable). Drag a card to another column to change its status; drag within a column to reorder — both are written back to the card's frontmatter immediately.

## Configuration reference

All options are read from the YAML inside the ` ```board ` block.

| Key | Type | Default | Description |
|---|---|---|---|
| `tag` | string | — (required) | The tag that defines which notes are cards on this board, e.g. `"#book"`. |
| `folder` | string | vault root | Folder new cards are created in via the "+ добавить" button. |
| `template` | string | — | Path to a template note. New cards are created from it, with the status field patched to match the column clicked. |
| `statusField` | string | `Статус` | Frontmatter field used to group cards into columns. |
| `orderField` | string | `Порядок` | Frontmatter field used to persist each card's position within its column. Pick a name that doesn't collide with an existing field. |
| `nameField` | string | — | Frontmatter field to use as the card title. Falls back to a `Название` field, then the file's basename. |
| `columns` | string[] | inferred | Explicit, ordered list of status values to show as columns. If omitted, columns are inferred from whatever status values are actually in use. |
| `exclude` | string[] | `[]` | Vault-relative paths to exclude from the board even if tagged (e.g. the template file, if it carries the tag itself). The note hosting the board is always excluded automatically. |
| `facets` | string[] | `[]` | Frontmatter fields to expose as filter-chip rows in the toolbar (in addition to the automatic tag-filter row, which is always shown if the cards have extra tags). |
| `vocab` | map of string → string[] | `{}` | Controlled vocabulary per field. Any field listed here gets an editable chip panel (in the ` ```tags ` block, in the vocab command/modal, and inline on each card) restricted to these values. |
| `single` | string[] | `[]` | Subset of `vocab` field names that hold a single scalar value (not a list) — e.g. a priority or type field. Editing these replaces the value instead of toggling array membership. |
| `meta` | string[] | `Год`/`Год выпуска` + `Оценка` | Frontmatter fields shown on the card face in the board view. Defaults to year + rating for backward compatibility; set explicitly for boards without those fields. |
| `showTags` | boolean | `true` | Set to `false` to hide the automatic tag-filter row. Useful when notes carry incidental real Obsidian tags unrelated to the board (e.g. a literal `#include` in a code snippet gets indexed as a tag and shows up as noise). |
| `flat` | boolean | `false` | Skip Kanban columns entirely and render all matching cards as a single filterable grid. For reference indexes (FAQs, glossaries) that have topic tags but no workflow status — `statusField`/`orderField`/`columns` are ignored when this is set. |
| `autoArchive` | object | — | Automatically moves cards from `source` to `target` after `afterDays` days since their last status change. `statusChangedField` defaults to `Статус изменён`. The check runs when Obsidian starts and hourly afterward. |
| `card` | object | `{}` | Centralized settings for the ` ```card ` block (see below) — `fields`, `links`, `labels`, `ratingField`, `recField`. Applied to any note tagged for this board whose own ` ```card ` block is empty. |

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
| `fields` | `[Оценка, Кинопоиск, Описание, Рекомендация]` (or the board's `card.fields`) | Which frontmatter fields to render, in order. Missing/empty fields are silently skipped. |
| `ratingField` | `Оценка` | Rendered as `★ <value>`. |
| `links` | `[{field: Кинопоиск}]` | A list of links — each renders as its own row with a clickable link (if the value looks like a URL) and its own edit pencil. Add more than one, e.g. a Pyrus link plus a separate merge-request link. |
| `linkField` / `linkLabel` | — | Old-style way to set a **single** link — equivalent to `links: [{field: linkField, label: linkLabel}]`. Still works; don't mix `links` and `linkField` in the same block. |
| `recField` | `Рекомендация` | Rendered in an italic, accent-bordered block. |
| `labels` | `{}` | Map of field name → display label for any other field in `fields`. Rendered as a small `Label: value` row instead of a full paragraph — use this for short metadata (IDs, counts) rather than prose. Fields in `fields` without a label and not matching one of the roles above are rendered as a plain paragraph (intended for longer text like a description). |
| `showStatus` | `true` | Set to `false` to hide the status chip row (see below). |

If nothing in `fields` has a value, the block shows a small "нет данных" placeholder instead of staying blank.

#### Centralized configuration

If the note's own ` ```card ` block is **empty** (no `fields`), the plugin looks for a board whose `tag` matches the note's tag and uses its `fields`/`links`/`labels`/`ratingField`/`recField` instead (the `card:` key inside the ` ```board ` block):

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
- **Columns** — one text input per column:
  - editing the text **renames** the column, and updates `statusField` on every card that had the old value;
  - the × button deletes a column — any cards that were in it move to the first remaining column instead of disappearing from the board;
  - "+ add" appends a blank column at the end.
- **Tags / vocab** — same idea for each `vocab` field: renaming a value batch-updates every card that had it. A field at the bottom lets you add a brand-new vocab field.
- **Card** — editable lists for the centralized ` ```card ` config (see above): "Поля" (a plain list), "Ссылки" and "Подписи" (field → label pairs). These aren't tied to individual cards, so renaming here doesn't touch any note — it just changes what an empty ` ```card ` block displays.
- "Save" rewrites the ` ```board ` code block itself (via `stringifyYaml`) and applies all the renames to cards in one go; the live board re-parses its config and redraws immediately, no need to reopen the note.

You can't rename the board's own `tag` or drag-reorder columns from this modal — see Known limitations.

### Creating a new board

The **Board Notes: Создать новую доску** command (command palette, or the "+ create new board" button at the bottom of the settings modal) opens a wizard: note title, tag, card folder, template (optional), columns (one per line). Hitting "Create" generates a new note with a ready ` ```board ` code block and opens it.

## How data is stored

- **Column** = the note's `statusField` frontmatter value (a plain string).
- **Position within a column** = the note's `orderField` frontmatter value (an integer, rewritten for the whole column on every drop).
- **Vocabulary-controlled values** = plain frontmatter list fields (or scalar, for `single` fields) — the vocab list itself lives only in the `board` block's config, not duplicated per note.

Nothing is written outside the notes' own frontmatter. Deleting the plugin leaves your notes fully intact and readable as plain YAML frontmatter.

## Known limitations

- One board = one code block = one tag. Boards that need to mix multiple tags aren't supported.
- Reordering persists by rewriting every card's `orderField` in the destination column on drop — fine for boards with tens of cards, potentially slow with many hundreds.
- No mobile-specific touch drag-and-drop testing has been done.
- `vocab`/`facets` field names are matched by exact string — frontmatter field renames require updating the board config to match.
- The settings modal (⚙) can rename column and vocab *values* (with a batch card update), but not the board's own `tag` or field names (`statusField`, `vocab` keys) — those still need a manual code-block edit.
- Column order isn't drag-reorderable in the settings modal — you can only add/remove/rename; reorder by editing the `columns` list in the code block directly.

## Contributing

Issues and PRs welcome. The codebase is a single `main.ts` file — no build framework beyond esbuild, no bundled UI library, just the Obsidian API and vanilla DOM calls.

## License

MIT — see [LICENSE](LICENSE).
