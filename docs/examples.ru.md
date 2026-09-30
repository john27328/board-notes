# Примеры

*(English version: [examples.md](examples.md))*

## Медиа-доска со словарём

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

`facets` добавляет ряды фильтров, `vocab` ограничивает допустимые значения, `coverField` (викилинк `[[image.png]]`) показывает обложку на карточке, `exclude` убирает шаблон с доски.

## Таблица с сортировкой

```board
tag: "#movie"
view: table
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

## Задачи с подзадачами и автоархивом

```board
tag: "#task"
folder: Tasks
template: Templates/Task.md
columns: [бэклог, в работе, ревью, готово, архив]
baseTaskField: BaseTask
autoArchive:
  source: готово
  target: архив
  afterDays: 14
vocab:
  Метки: [bug, feature]
card:
  fields: [Id, BaseTask, Описание]
  labels:
    Id: ID
    BaseTask: Базовая задача
  copyFields: [Id]
```

Дочерняя заметка содержит `BaseTask: "[[Родитель]]"` (или создаётся кнопкой **+ подзадача** на карточке родителя). «готово» и «архив» считаются завершёнными для бейджей прогресса. Смена статуса проставляет `Статус изменён`, по которой работает автоархив.

## Плоский справочник (без статусов)

```board
tag: "#faq"
flat: true
facets: [Тема]
```

## Шаблон карточки

````markdown
---
Статус: бэклог
Id:
Описание:
---
#task

```card
```

```tags
```
````

Оба блока пустые: раскладка и словарь берутся из доски.

## Своя раскладка в конкретной заметке

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
