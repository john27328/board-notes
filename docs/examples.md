# Examples

*(Русская версия: [examples.ru.md](examples.ru.md))*

## Media board with vocabulary

```board
tag: "#anime"
folder: Anime
template: Templates/Anime.md
columns: [планы, смотрю, просмотрено]
meta: [Год]
coverField: Обложка
exclude:
  - Templates/Anime.md
facets: [Жанры, Теги]
vocab:
  Жанры: [драма, комедия, фэнтези]
  Теги: [магия, космос]
```

`facets` adds filter rows, `vocab` restricts the values editors can pick, `coverField` (a `[[image.png]]` wikilink) shows a cover on the card, and `exclude` keeps the template out of the board.

## Table view with sorting

```board
tag: "#movie"
view: table
table:
  columns:
    - field: __title
      label: Title
    - field: Статус
    - field: Оценка
  sort:
    - field: Статус
      direction: asc
    - field: __modified
      direction: desc
```

## Tasks with subtasks and auto-archive

```board
tag: "#task"
folder: Tasks
template: Templates/Task.md
columns: [backlog, in progress, review, done, archive]
baseTaskField: BaseTask
autoArchive:
  source: done
  target: archive
  afterDays: 14
vocab:
  Метки: [bug, feature]
card:
  fields: [Id, BaseTask, Описание]
  labels:
    Id: ID
    BaseTask: Base task
  copyFields: [Id]
```

A child note sets `BaseTask: "[[Parent]]"` (or is created with **+ subtask** on the parent's card). `done` and `archive` count as done for the progress badges. Status changes stamp `Статус изменён`, which drives auto-archive.

## Flat reference index (no statuses)

```board
tag: "#faq"
flat: true
facets: [Тема]
```

## Card template

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

Both blocks are empty: layout and vocabulary come from the board.

## Per-note card override

````markdown
```card
fields: [Оценка, Кинопоиск, Описание, Рекомендация]
ratingField: Оценка
recField: Рекомендация
links:
  - field: Кинопоиск
    label: "Открыть на Кинопоиске ↗"
```
````
