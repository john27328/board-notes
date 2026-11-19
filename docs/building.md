# Building from source

*(Русская версия: [building.ru.md](building.ru.md))*

Requires Node.js 20+.

```bash
git clone <this-repo-url>
cd board-notes
npm install
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Production build → minified `main.js`, no source map |
| `npm run dev` | Watch mode, unminified, inline source map |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Typecheck + production build |
| `npm run deploy` | `check`, then copy `main.js`, `manifest.json`, `styles.css` into the vault |
| `npm run test:table` | Chromium regression check for opaque sticky table headers, filters and scrolling |
| `npm run test:cards` | Card creation, short titles, duplicate filenames, subtasks and archive confirmation against a mocked Obsidian API in Chromium |

Before the browser check, run `npx playwright install chromium` (Linux may also need `npx playwright install-deps chromium`). The test uses synthetic data and does not read vault notes. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium binary. Optional `BOARD_NOTES_TEST_THEME` loads a theme CSS file; `BOARD_NOTES_TEST_CSS` substitutes the plugin stylesheet to reproduce a regression against an older version. The fixture checks light/dark and preview/live-preview containers; it does not launch Obsidian.

For `test:cards`, optional `BOARD_NOTES_QUICKADD_SCRIPT` points to a QuickAdd user script to exercise both its board picker and direct-board settings. This test runs the real plugin methods and modals with an in-memory vault; it does not launch Obsidian or touch real notes.

## Layout

| File | Purpose |
|---|---|
| `main.ts` | Plugin entry, code-block processors, board/table/card rendering, modals |
| `config.ts` | Parsing and serializing the ` ```board ` YAML |
| `types.ts` | Shared interfaces |
| `styles.css` | Styles (`bn-` prefix) |
| `esbuild.config.mjs` | Bundler config |
| `scripts/deploy.mjs` | Vault deployment |

## Development in a vault

- **Companion repo:** when checked out as `plugins/board-notes`, `npm run deploy` copies the build to `notes/.obsidian/plugins/board-notes`. The copy is not a symlink; redeploy after changes and reload the plugin (or Obsidian).
- **Any other vault:** run `npm run dev` and point it at a plugin folder (symlink or copy) in `<vault>/.obsidian/plugins/board-notes/`.

## Release

1. Bump `version` in `package.json` and `manifest.json`; add the version to `versions.json` with its `minAppVersion`.
2. Run `npm run check`.
3. Attach `main.js`, `manifest.json`, `styles.css` to a GitHub release tagged with the version.
