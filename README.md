# Momentum

A single-page habit tracker and goal/funnel reverse-engineering tool. No build step, no backend — just `index.html`, `style.css`, and `app.js`. All data lives in the browser's `localStorage`.

## What it does

- **Habits** — daily check-offs or scale-based logging (weekly total or daily target), with streaks.
- **Goals** — target + deadline, with pace tracking (ahead / on track / behind).
- **Funnels** — reverse-engineer any goal (revenue, subscribers, body weight, ...) down to a daily action number through a chain of stages. A funnel can auto-create and keep in sync a linked goal and habit.
- **Customise** — theme (dark/light), accent colour, density, corner style, and font, all persisted locally.

## Running it

Open `index.html` directly in a browser, or serve the folder locally:

```
python3 -m http.server 8000
```

## Data

Export/Import buttons in the header back up or restore all data as a single JSON file.
