import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const css = await readFile(
  process.env.BOARD_NOTES_TEST_CSS ?? new URL("../styles.css", import.meta.url),
  "utf8"
);
const theme = process.env.BOARD_NOTES_TEST_THEME
  ? await readFile(process.env.BOARD_NOTES_TEST_THEME, "utf8")
  : "";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

try {
  // Use synthetic values only: the test never reads a vault or credentials.
  for (const mode of ["light", "dark"]) {
    for (const view of ["markdown-preview-view", "markdown-source-view mod-cm6"]) {
      const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
      await page.setContent(`
        <style>
          body { margin: 20px; font: 16px monospace;
            --background-primary: ${mode === "light" ? "#faf5e6" : "#242424"};
            --text-normal: ${mode === "light" ? "#222" : "#eee"};
            --background-modifier-border: #888;
            --background-modifier-hover: rgba(127,127,127,.15);
            --table-header-background: transparent;
            background: var(--background-primary); color: var(--text-normal);
          }
          /* Markdown/theme selectors must not make sticky headers transparent. */
          .markdown-rendered thead > tr > th {
            background-color: var(--table-header-background);
          }
        </style>
        <style>${theme}</style><style>${css}</style>
        <main class="markdown-rendered ${view}"><div class="board-notes">
          <div class="bn-table-wrap"><table class="bn-table"><thead><tr>
            ${["Title", "Site", "Login", "Value", "A long updated date label"].map(label => `
              <th class="bn-table-header"><span class="bn-table-sort">${label}</span>
                <input class="bn-table-filter" placeholder="Filter"></th>`).join("")}
          </tr></thead><tbody>
            ${Array.from({ length: 100 }, (_, row) => `<tr>${Array.from({ length: 5 }, (_, col) =>
              `<td class="bn-table-cell"><span>demo-${row}-${col}</span></td>`
            ).join("")}</tr>`).join("")}
          </tbody></table></div>
        </div></main>`);
      await page.locator("body").evaluate((body, mode) => {
        body.className = `theme-${mode}`;
      }, mode);

      for (const scrollLeft of [0, 180]) {
        await page.locator(".bn-table-wrap").evaluate((el, left) => {
          el.scrollTop = 213;
          el.scrollLeft = left;
        }, scrollLeft);
        for (const hover of [false, true]) {
          if (hover) await page.locator(".bn-table-sort").nth(2).hover();
          else await page.mouse.move(0, 0);
          const headers = await page.locator("th").evaluateAll(cells => cells.map(cell => {
            const rect = cell.getBoundingClientRect();
            const wrap = cell.closest(".bn-table-wrap").getBoundingClientRect();
            const input = cell.querySelector("input").getBoundingClientRect();
            return {
              background: getComputedStyle(cell).backgroundColor,
              wrapBackground: getComputedStyle(cell.closest(".bn-table-wrap")).backgroundColor,
              top: rect.top, wrapTop: wrap.top,
              filterInside: input.top >= rect.top && input.bottom <= rect.bottom,
              topmost: rect.left >= wrap.left && rect.right <= wrap.right
                ? document.elementFromPoint(rect.left + 8, rect.top + 8)?.closest("th") === cell
                : true,
            };
          }));
          for (const header of headers) {
            assert.equal(header.background, header.wrapBackground, "Sticky header must stay opaque, including hover");
            assert.ok(Math.abs(header.top - header.wrapTop - 1) < 2, "Header must stay at the scroll container top");
            assert.ok(header.filterInside, "Filter must stay inside its header");
            assert.ok(header.topmost, "Body cells must not cover header controls");
          }
        }
      }
      await page.close();
    }
  }
  console.log("Table layout: light/dark, preview/live preview, vertical/horizontal scroll and hover passed.");
} finally {
  await browser.close();
}
