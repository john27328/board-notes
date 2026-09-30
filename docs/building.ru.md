# Сборка из исходников

*(English version: [building.md](building.md))*

Нужен Node.js 20+.

```bash
git clone <this-repo-url>
cd board-notes
npm install
```

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run build` | Продакшн-сборка → минифицированный `main.js`, без source map |
| `npm run dev` | Режим watch, без минификации, inline source map |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Проверка типов + продакшн-сборка |
| `npm run deploy` | `check`, затем копирование `main.js`, `manifest.json`, `styles.css` в vault |

## Структура

| Файл | Назначение |
|---|---|
| `main.ts` | Точка входа, обработчики code-блоков, рендер доски/таблицы/карточки, модалки |
| `config.ts` | Разбор и сериализация YAML блока ` ```board ` |
| `types.ts` | Общие интерфейсы |
| `styles.css` | Стили (префикс `bn-`) |
| `esbuild.config.mjs` | Конфиг сборщика |
| `scripts/deploy.mjs` | Деплой в vault |

## Разработка в vault

- **Парный репозиторий:** при размещении как `plugins/board-notes` команда `npm run deploy` копирует сборку в `notes/.obsidian/plugins/board-notes`. Это не symlink: после изменений нужно деплоить заново и перезагружать плагин (или Obsidian).
- **Любой другой vault:** запусти `npm run dev` и укажи папку плагина (symlink или копия) в `<vault>/.obsidian/plugins/board-notes/`.

## Релиз

1. Подними `version` в `package.json` и `manifest.json`; добавь версию в `versions.json` с её `minAppVersion`.
2. Запусти `npm run check`.
3. Приложи `main.js`, `manifest.json`, `styles.css` к GitHub-релизу с тегом версии.
