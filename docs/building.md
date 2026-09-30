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
