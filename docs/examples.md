# Examples

*(Русская версия: [examples.ru.md](examples.ru.md))*

Each example follows the same order: **board** → how it looks → **card template** → the card made from it. More on the visuals: [What it looks like](appearance.md).

## 1. Media list (anime, movies, books)

### Board

````markdown
```board
tag: "#anime"
folder: Anime
template: Templates/Anime.md
columns: [планы, смотрю, просмотрено]
meta: [Год, Оценка]
coverField: Обложка
exclude:
  - Templates/Anime.md
facets: [Жанры]
vocab:
  Жанры: [драма, комедия, фэнтези]
  Теги: [магия, космос]
card:
  fields: [Оценка, Описание, Рекомендация]
  ratingField: Оценка
  recField: Рекомендация
```
````

```text
┌────────────────────────────────────────────────────────────────┐
│ @  [Таблица] [Доска]  [ Поиск по всем полям карточки.  ] 3     │
│ Жанры - включать     [драма] [комедия] [фэнтези] [пусто]       │
│ Колонки              [планы] [смотрю] [просмотрено]            │
├──────────────────┬──────────────────┬──────────────────────────┤
│ планы         1  │ смотрю        1  │ просмотрено           1  │
│ ┌──────────────┐ │ ┌──────────────┐ │ ┌──────────────────────┐ │
│ │ [обложка]    │ │ │ [обложка]    │ │ │ [обложка]            │ │
│ │ Монстр       │ │ │ Фрирен       │ │ │ Ковбой Бибоп         │ │
│ │ 2004         │ │ │ 2023         │ │ │ 1998 - * 9           │ │
│ │ [драма]      │ │ │ [фэнтези]    │ │ │ [драма] [космос]     │ │
│ │ / жанры/теги │ │ │ / жанры/теги │ │ │ / жанры/теги         │ │
│ └──────────────┘ │ └──────────────┘ │ └──────────────────────┘ │
│ + добавить       │ + добавить       │ + добавить               │
└──────────────────┴──────────────────┴──────────────────────────┘
```

`facets` gives the genre filter row, `vocab` restricts what the ✎ editor offers, `coverField` (a `[[image.png]]` wikilink) draws the cover, `exclude` keeps the template off the board.

### Card template — `Templates/Anime.md`

````markdown
---
Статус: планы
Год:
Оценка:
Обложка:
Жанры: []
Теги: []
Описание:
Рекомендация:
---
#anime

```card
```

```tags
```
````

Both blocks are empty on purpose: the layout comes from the board's `card:`.

### Resulting card

```text
┌────────────────────────────────────────────────────────┐
│ Аниме  #anime                                      @   │
│ [планы] [смотрю] [просмотрено]                         │
│ * 9                                                    │
│ Охотник за головами в космосе, джаз и меланхолия.      │
│ | Смотреть ради последней серии                        │
│ @ поля карточки                                        │
├────────────────────────────────────────────────────────┤
│ словарь: Аниме - по тегу #anime                        │
│ Жанры   [драма] [комедия] [фэнтези]                    │
│ Теги    [магия] [космос]                               │
└────────────────────────────────────────────────────────┘
```

## 2. Tasks with subtasks and auto-archive

### Board

````markdown
```board
tag: "#task"
folder: Tasks
template: Templates/Task.md
columns: [backlog, in progress, review, done, archive]
meta: [Id]
baseTaskField: BaseTask
autoArchive:
  source: done
  target: archive
  afterDays: 14
facets: [Метки]
vocab:
  Метки: [bug, feature]
card:
  fields: [Id, BaseTask, Описание]
  links:
    - field: Pyrus
      label: "Открыть в Pyrus ↗"
  labels:
    Id: ID
    BaseTask: Базовая задача
  copyFields: [Id]
```
````

```text
┌──────────────────────────────────────────────────────────────────────┐
│ @  [Таблица] [Доска]  [ Поиск.  ] 4   [Только базовые задачи]        │
│ Метки - включать     [bug] [feature] [пусто]                         │
├───────────────┬───────────────┬───────────────┬──────────────────────┤
│ backlog    1  │ in progress 1 │ review     0  │ done              2  │
│ ┌───────────┐ │ ┌───────────┐ │               │ ┌──────────────────┐ │
│ │ Релиз 1.2 │ │ │ Fix login │ │               │ │ Update docs      │ │
│ │ 1/3 готово│ │ │ Id 4812   │ │               │ │ Id 4790          │ │
│ │ Id 4800   │ │ │ [bug]     │ │               │ │ [feature]        │ │
│ │ / метки   │ │ │ / метки   │ │               │ └──────────────────┘ │
│ └───────────┘ │ └───────────┘ │               │                      │
│ + добавить    │ + добавить    │ + добавить    │ + добавить           │
└───────────────┴───────────────┴───────────────┴──────────────────────┘
```

The parent ("Релиз 1.2") shows the progress badge. `done` and `archive` count as completed. A card in `done` moves to `archive` 14 days after its status last changed.

### Card template — `Templates/Task.md`

````markdown
---
Статус: backlog
Id:
Pyrus:
BaseTask:
Метки: []
Описание:
---
#task

```card
```

```tags
```
````

### Resulting card (parent task)

```text
┌────────────────────────────────────────────────────────┐
│ Задачи  #task                     @   + подзадача      │
│ [backlog] [in progress] [review] [done] [archive]      │
│ Открыть в Pyrus > # /                                  │
│ ID: 4800 #                                             │
│ Базовая задача: +                                      │
│ Описание: подготовить релиз                            │
│ ┌ Дочерние задачи ─────────────────────────── 1/3 ┐    │
│ │ Fix login                        [in progress]  │    │
│ │ Fix token refresh                [backlog]      │    │
│ │ Update docs                      [done]         │    │
│ └─────────────────────────────────────────────────┘    │
│ @ поля карточки                                        │
└────────────────────────────────────────────────────────┘
```

**+ подзадача** creates a note from the same template with `BaseTask: "[[Релиз 1.2]]"`, copies the parent's other fields (labels, Pyrus link…) and opens it in a new tab. Its card shows the parent as a clickable link in "Базовая задача".

## 3. Table view

### Board

````markdown
```board
tag: "#movie"
view: table
columns: [хочу, смотрел]
table:
  columns:
    - field: __title
      label: Название
    - field: Статус
    - field: Оценка
  sort:
    - field: Статус
      direction: asc
    - field: __modified
      direction: desc
```
````

```text
┌──────────────────────────────────────────────────────────────┐
│ @  [Таблица] [Доска]  [ Поиск.  ]                            │
├───────────────┬─────────────┬────────────────────────────────┤
│ Название      │ Статус ^    │ Оценка                         │
│ [Фильтр     ] │ [Фильтр   ] │ [Фильтр                      ] │
├───────────────┼─────────────┼────────────────────────────────┤
│ Дюна          │ хочу        │                                │
│ Начало        │ смотрел     │ 9                              │
└───────────────┴─────────────┴────────────────────────────────┘
```

### Card template

The template is the same kind as above (frontmatter + bare `card` block). In the table, edit a cell by double-click; in the note, edit the field in its card.

## 4. Flat reference index (no statuses)

### Board

````markdown
```board
tag: "#faq"
flat: true
facets: [Тема]
```
````

```text
┌────────────────────────────────────────────────────────┐
│ @  [Таблица] [Карточки]  [ Поиск.  ] 6                 │
│ Тема - включать     [git] [docker] [obsidian]          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│ │ Git: rebase│ │ Docker.  │ │ Vault.   │  .            │
│ └──────────┘ └──────────┘ └──────────┘                 │
│ + добавить                                             │
└────────────────────────────────────────────────────────┘
```

All cards go into one filterable grid, without columns.

### Card template

````markdown
---
Тема: []
---
#faq
````

No `card` block is needed: it is plain text with a topic.

## 5. One note, its own card layout

Normally the layout lives in the board. A note can override it with its own non-empty block:

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
