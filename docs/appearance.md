# What it looks like

*(Русская версия: [appearance.ru.md](appearance.ru.md))*

Text mockups of what the plugin renders. Labels are the real UI strings; colours and exact spacing follow your Obsidian theme.

## Board

Config:

```board
tag: "#task"
template: Templates/Task.md
columns: [backlog, in progress, done]
meta: [Id]
facets: [Метки]
vocab:
  Метки: [bug, feature]
```

Rendered:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ⚙  [Таблица] [Доска]  [ Поиск по всем полям карточки…   ] 12         │
│    [Только базовые задачи]                                           │
│ Теги · включать      [#urgent] [#infra]                      [×]     │
│ Метки · включать     [bug] [feature] [пусто]                 [×]     │
│ Колонки              [backlog] [in progress] [done]                  │
├───────────────────┬───────────────────┬──────────────────────────────┤
│ backlog        3  │ in progress    2  │ done                      7  │
│ ┌───────────────┐ │ ┌───────────────┐ │ ┌────────────────────────┐   │
│ │ Fix login     │ │ │ Release 1.2   │ │ │ Update docs            │   │
│ │ 1/3 готово    │ │ │ 2/2 готово    │ │ │ Id 4812                │   │
│ │ Id 4812       │ │ │ Id 4790       │ │ │ [feature]              │   │
│ │ [bug]         │ │ │ [feature]     │ │ │ ✎ метки                │   │
│ │ ✎ метки       │ │ │ ✎ метки       │ │ └────────────────────────┘   │
│ └───────────────┘ │ └───────────────┘ │                              │
│ + добавить        │ + добавить        │ + добавить                   │
└───────────────────┴───────────────────┴──────────────────────────────┘
```

- **Toolbar:** ⚙ settings, view switch (**Таблица** / **Доска**), search with a counter (`matched / total` while searching), and the base-task filter.
- **Filter rows:** tags, every field from `facets`, and **Колонки** (show/hide columns). Clicking a row label (`Метки · включать`) switches it to exclusion mode.
- **Column header:** status name and card count. **+ добавить** creates a card with that status.
- Drag a card to another column to change its status.

### Board card

Top to bottom, each part only if present:

```text
┌──────────────────────────┐
│ [cover image]            │  ← coverField
│ Fix login                │  ← title: nameField → Название → file name
│ 1/3 готово               │  ← progress badge of a base task
│ Id 4812 · ★ 8            │  ← fields from meta
│ [bug] [login]            │  ← current vocab values
│ ✎ метки                  │  ← opens the inline vocab editor
└──────────────────────────┘
```

Click the card to open the note. **✎ метки** unfolds a panel of chips for editing the vocabulary fields without leaving the board.

## Table

```text
┌──────────────────────────────────────────────────────────────┐
│ ⚙  [Таблица] [Доска]  [ Поиск…  ]                            │
├───────────────┬─────────────┬──────────┬─────────────────────┤
│ Title ↑       │ Status      │ Rating   │ Метки               │
│ [Фильтр     ] │ [Фильтр   ] │ [Фильтр ]│ [Фильтр           ] │
├───────────────┼─────────────┼──────────┼─────────────────────┤
│ Fix login     │ backlog     │ 8        │ bug                 │
│ Release 1.2   │ in progress │          │ feature             │
└───────────────┴─────────────┴──────────┴─────────────────────┘
```

Each header has a text filter; a click on the label sorts, a drag reorders columns. Double-click a cell to edit it, single-click the title to open the note.

## Card in a note (` ```card `)

Config (once, in the board block):

```yaml
card:
  fields: [Id, BaseTask, Описание, Рекомендация]
  links:
    - field: Pyrus
      label: "Открыть в Pyrus ↗"
  labels:
    Id: ID
    BaseTask: Базовая задача
  copyFields: [Id]
  ratingField: Оценка
  recField: Рекомендация
```

Rendered inside the note:

```text
┌────────────────────────────────────────────────────────┐
│ Задачи  #task                     ⚙   + подзадача      │  ← board link, tag, settings
│ [backlog] [in progress] [done]                         │  ← status chips, click to change
│ Открыть в Pyrus ↗ ⧉ ✎                                  │  ← link row: open, copy, edit
│ ★ 8                                                    │  ← ratingField
│ ID: 4812 ⧉                                             │  ← labelled field with copy
│ Базовая задача: Release 1.2 ✎                          │  ← wikilink is clickable
│ Описание текстом…                                      │  ← plain paragraph (click to edit)
│ ▌ Рекомендация курсивом                                │  ← recField, accent bar
│ ┌ Дочерние задачи ─────────────────────────── 1/3 ┐   │
│ │ Fix login form                   [in progress]  │   │
│ │ Fix token refresh                [done]         │   │
│ └─────────────────────────────────────────────────┘   │
│ ⚙ поля карточки                                        │
└────────────────────────────────────────────────────────┘
```

- Empty fields show a `+ field name` placeholder; click it to fill in.
- Everything is click-to-edit: Enter or blur saves, Escape cancels.
- **Дочерние задачи** appears only when other cards link to this one via `baseTaskField`.

## Card template

The template carries only frontmatter and two bare blocks — the layout comes from the board:

````markdown
---
Статус: backlog
Id:
Описание:
---
#task

```card
```

```tags
```
````

A new note made from it opens as the card above. The ` ```tags ` block adds the vocabulary editor under it:

```text
┌────────────────────────────────────────────────────────┐
│ словарь: Задачи · по тегу #task                        │
│ Метки   [bug] [feature]                                │
└────────────────────────────────────────────────────────┘
```

## Board settings (⚙)

```text
┌─ Настройки доски ────────────────────────────────┐
│ Папка      [Tasks                              ] │
│ Шаблон     [Templates/Task.md  ] [+ создать заметку] │
│ Колонки    [backlog    ] ↑ ↓ ×                   │
│            [in progress] ↑ ↓ ×     [+ добавить]  │
│ Метки      [bug        ] ↑ ↓ ×                   │
│ Карточка   Поля / Ссылки / Подписи / Копируемые поля │
│ [Сохранить] [Отмена]     [+ создать новую доску] │
└──────────────────────────────────────────────────┘
```

See also: [Getting started](getting-started.md), [Examples](examples.md).
