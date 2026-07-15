# Momentum

A single-page habit tracker and goal/funnel reverse-engineering tool. No build step, no backend — just `index.html`, `style.css`, and `app.js`. All data lives in the browser's `localStorage`.

## What it does

- **Habits** — daily check-offs or scale-based logging (weekly total or daily target), with streaks and inline editing.
- **Goals** — target + deadline, with pace tracking (ahead / on track / behind).
- **Funnels** — reverse-engineer any goal (revenue, subscribers, body weight, books, ...) down to a daily action number through a chain of stages. A funnel can auto-create and keep in sync a linked goal and habit. Each stage shows a plain-English hint (e.g. "multiplies by 300"). Two guided templates skip the manual stage math entirely: bulk (asks for your stats, works out real maintenance calories so the daily number is the full amount to eat, not just the surplus) and reading (asks for book count + avg pages/book, gives a daily page target).
- **Calendar** — month-by-month history for any single habit, or an "All habits" heatmap view showing combined daily completion across everything you track.
- **Stats** — per-habit consistency over the last 30 days, current + longest streaks, and an overview strip.
- **Customise** — theme (dark/light), accent colour (presets or any hex/RGB), density, corner style, and font, all persisted locally.

## Running it

Open `index.html` directly in a browser, or serve the folder locally:

```
python3 -m http.server 8000
```

## Data

Export/Import buttons in the header back up or restore all data as a single JSON file.

`demo-data.json` is a sample dataset (a few habits, goals, and both funnel types with a few weeks of history) — use Import to load it and see every feature populated at once.
