# Momentum

A single-page habit tracker and goal/funnel reverse-engineering tool. No build step, no backend — just `index.html`, `style.css`, and `app.js`. All data lives in the browser's `localStorage`.

**Live**: https://scram-lol.github.io/momentum/ — this repo is public (code only, no personal data — see [Data](#data) below) and served for free via GitHub Pages, redeployed automatically on every push to `main`.

## Installing on iPhone / Mac

It's a PWA, so it installs like a real app with no App Store needed:

- **iPhone**: open the live URL in Safari → Share icon → **Add to Home Screen**.
- **Mac**: open the live URL in Safari → File → **Add to Dock** (Sonoma+), or in Chrome/Edge click the install icon in the address bar.

Both install as a standalone app icon with its own window — no browser chrome, works offline for the app shell itself (your data still needs a network round-trip to sync, see below).

## What it does

- **Habits** — daily check-offs or scale-based logging (weekly total or daily target), with streaks and inline editing. Each habit is tagged as something to **build** (🎯) or **quit/avoid** (🚫) — quit-habits use a distinct icon when checked off, since "done" means you successfully avoided it.
- **Skip** — a per-day "excuse" for a habit: skipped days don't break streaks and don't count against completion stats. Available as a button on Today, and reflected everywhere else (grid, calendar).
- **Vacation Mode** — set a date range and pick which habits to pause; every day in range is automatically skipped for those habits, no manual tapping required. Manage active/upcoming/past vacations from the same panel.
- **Goals** — target + deadline, with pace tracking (ahead / on track / behind).
- **Funnels** — reverse-engineer any goal (revenue, subscribers, body weight, books, ...) down to a daily action number through a chain of stages. A funnel can auto-create and keep in sync a linked goal and habit. Each stage shows a plain-English hint (e.g. "multiplies by 300"). Two guided templates skip the manual stage math entirely: bulk (asks for your stats, works out real maintenance calories via Mifflin-St Jeor or Katch-McArdle so the daily number is the full amount to eat, not just the surplus) and reading (asks for book count + avg pages/book, gives a daily page target).
- **Calendar** — month-by-month history for any single habit, or an "All habits" heatmap view showing combined daily completion across everything you track. Skipped days are excluded from the ratios, not counted as misses.
- **Stats** — per-habit consistency over the last 30 days, current + longest streaks, and an overview strip.
- **Customise** — theme (dark/light), accent colour (presets or any hex/RGB), density, corner style, and font, all persisted locally.

## Running it

Open `index.html` directly in a browser, or serve the folder locally:

```
python3 -m http.server 8000
```

## Data

All app data (habits, goals, funnels, vacations) lives only in the browser's `localStorage` — it is never part of this repo, and this repo (being public, for free Pages hosting) should never hold it. Two ways to keep it safe, and to actually get it from one device to another:

- **Export/Import** — buttons in the header, manual, downloads/restores a single JSON file. A dismissible banner nudges you to do this if it's been 7+ days since your last export.
- **GitHub auto-sync (two-way)** — Customise → Backup. Point it at a **separate, private** repo (e.g. `momentum-data` — not this one) and a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to just that repo with "Contents: Read and write". Once enabled: on load, and whenever the tab becomes visible again, it pulls `data-backup.json` and adopts it if it's newer than local (by an `updatedAt` timestamp); on every change, it pushes (debounced ~8s after your last edit, plus immediately when the tab is hidden). That's what lets two devices actually converge instead of each one just backing up in isolation. The token lives only in this browser's `localStorage` (a separate key from the app data) and is **never** included in Export files.

`demo-data.json` is a sample dataset (a few habits, goals, and both funnel types with a few weeks of history) — use Import to load it and see every feature populated at once.
