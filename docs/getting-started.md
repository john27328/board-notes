# Getting started

*(Русская версия: [getting-started.ru.md](getting-started.ru.md))*

## 1. Install

See [Installation](../README.md#installation): manually, via BRAT, or (later) from the community directory. Enable **Board Notes** in **Settings → Community plugins**.

## 2. Mark notes with a tag

A card is any note carrying the board's tag. Add a status to its frontmatter:

```yaml
---
Статус: reading
---
#book
```

## 3. Create a board

Either run **Board Notes: Создать новую доску** from the command palette (wizard: title, tag, folder, template, columns), or add a block to any note by hand:

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

Only `tag` is required. Without `columns`, columns are inferred from the status values in use.

## 4. Work with it

- Drag a card to another column — only its status changes.
- **Table** in the toolbar switches to an editable table (double-click a cell).
- The search box and filter chips narrow the cards; click a filter row label to switch it to exclusion mode.
- **⚙** opens board settings: folder, template, columns, vocabulary, card layout. Renaming a column or vocab value updates all cards.
- **+ добавить** in a column creates a card from `template` with that column's status.

## 5. Add a card view to notes

Put an empty ` ```card ` block (usually in the template). Its layout comes from the board's `card:` config; fields are click-to-edit, and a row of status chips lets you change the status without visiting the board. A ` ```tags ` block adds the vocabulary editor.

## Next

- [Examples](examples.md)
- [Full configuration reference](../README.md#configuration-reference)
- [Building from source](building.md)
