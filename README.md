# Board Notes

Interactive Kanban boards for Obsidian, rendered from a single code block and backed entirely by note frontmatter.

No cache file. No separate database. Column and card order live in the notes themselves, so everything stays plain-text, git-diffable, and mergeable.

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

### `card` block

Renders a compact summary of a note's own frontmatter, meant to sit inside the note itself (e.g. inside its template) as a readable alternative to the raw Properties panel.

````markdown
```card
fields:
  - Оценка
  - Кинопоиск
  - Описание
  - Рекомендация
ratingField: Оценка
linkField: Кинопоиск
linkLabel: "Открыть на Кинопоиске ↗"
recField: Рекомендация
labels:
  Id: "ID"
```
````

| Key | Default | Description |
|---|---|---|
| `fields` | `[Оценка, Кинопоиск, Описание, Рекомендация]` | Which frontmatter fields to render, in order. Missing/empty fields are silently skipped. |
| `ratingField` | `Оценка` | Rendered as `★ <value>`. |
| `linkField` | `Кинопоиск` | Rendered as a clickable link if the value looks like a URL. |
| `linkLabel` | `"Открыть на Кинопоиске ↗"` if `linkField` is still `Кинопоиск`, else `"Открыть ↗"` | Link text. |
| `recField` | `Рекомендация` | Rendered in an italic, accent-bordered block. |
| `labels` | `{}` | Map of field name → display label for any other field in `fields`. Rendered as a small `Label: value` row instead of a full paragraph — use this for short metadata (IDs, counts) rather than prose. Fields in `fields` without a label and not matching one of the roles above are rendered as a plain paragraph (intended for longer text like a description). |

If nothing in `fields` has a value, the block shows a small "нет данных" placeholder instead of staying blank.

### `tags` block

````markdown
```tags
```
````

Takes no configuration. Drop it into any note; it looks across the whole vault for a ` ```board ` block whose `tag` matches one of the current note's tags, and renders an editable chip panel for that board's `vocab` fields — including a small line naming which board/tag it resolved to, so you can confirm it's wired up correctly. If no matching board is found, it shows an error instead of silently doing nothing.

You can also trigger the same editor from any note via the command palette (**Board Notes: Редактировать теги/жанры по словарю доски**) or via right-click → **Теги/жанры по словарю** in the file menu — useful when a note doesn't have the `tags` block in its body.

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

## Contributing

Issues and PRs welcome. The codebase is a single `main.ts` file — no build framework beyond esbuild, no bundled UI library, just the Obsidian API and vanilla DOM calls.

## License

MIT — see [LICENSE](LICENSE).
