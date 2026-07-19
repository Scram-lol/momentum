# Momentum visual redesign — per-habit colour, icon, tighter Today row

## Context

Alfie opened the native macOS app **Habit** and asked Claude to take inspiration from it for Momentum. A side-by-side comparison found Momentum already has most of Habit's *structure* (a weekly grid on the Habits tab, an all-habits heatmap calendar, per-habit stats cards, theme/density/accent customisation). The gap is visual, not functional:

- Every habit renders in one accent colour — no per-habit identity.
- No icon/emoji per habit.
- Today rows for scale habits wrap across multiple lines (label, unit/target text, input, Skip button all competing), unlike Habit's clean icon + name + right-aligned progress single-line rows.

Momentum's memory (`momentum-app.md`) records explicit prior feedback from Alfie: after several rounds of feature additions, he asked for the app to stay **simplistic, minimalist, not cluttered**. Habit itself is a much busier, more gamified app (mood tracker, stress meter, daily quotes, streak crowns, social/accountability features). This spec deliberately scopes to a **visual-only pass** — colour, icon, and layout tidying on existing screens — with no new tabs, concepts, or always-on chrome. Feature-shaped ideas from Habit (mood tracking, yearly per-habit heatmap, weekday-specific scheduling, gamification badges, accountability partners) are explicitly out of scope here and would need their own separate spec.

Three approaches were considered (colour+icon+layout / full card-and-theme overhaul / colour-only); the first was chosen as the best payoff-to-risk ratio — additive and cosmetic, so it can't reopen the feature-creep problem the prior feedback was about.

## Pre-existing state to build on, not disturb

`momentum/app.js` currently has **uncommitted, unfinished changes** already on disk (not made by this session): a partial weekday-specific scheduling feature (`scheduleMode`, `scheduleDays`, `isScheduledDay()`, `weeklyDueCount()`, `scheduleLabel()`) and a stub `color: PALETTE[0]` default in `normalizeHabit()`. There is no UI wired up for the scheduling half yet.

This redesign:
- **Completes and uses** the existing `color: PALETTE[0]` stub (turning it into a cycling default — see below) rather than duplicating it.
- **Does not touch** the weekday-scheduling scaffolding (`scheduleMode`/`scheduleDays`/`isScheduledDay`/`weeklyDueCount`/`scheduleLabel`) — it's unrelated, unfinished, and out of scope for a visual-only pass.
- Should **not be committed silently bundled with** the pre-existing uncommitted scheduling work — that work predates this session and its disposition is Alfie's call, not something to fold into this commit.

## Data model changes

Extend the habit object (`normalizeHabit()` in `app.js`) with two new optional fields:

- **`color`** (hex string, one of the existing `PALETTE` 8 colours). Currently defaults to `PALETTE[0]` for every habit (the pre-existing stub) — change this to **cycle through `PALETTE`** by the habit's index in `state.habits` at normalize time, so existing habits (including `demo-data.json`) each get a distinct colour with no user action required. Reuses the exact swatch-row / `PALETTE` / `pickColor()`-style mechanism goals already have (`app.js` ~line 1155, ~1235) — add an equivalent swatch row to the habit edit form (`habitEditFormHtml()`).
- **`icon`** (single emoji string, optional, default `""`). Free-text input capped to one emoji in the habit add/edit form. When empty, rendering falls back to the existing build/quit glyph (🎯/🚫) already shown via habit intent — so creating a habit stays a one-line form; setting a custom icon is opt-in, not a required step.

No changes to `checks`/`logs`/`skips` structures or any other existing field.

## Where colour and icon render

- **Today list** (`habitCardHtml()`): a small coloured dot next to each habit's icon+name — not a full coloured row background, to stay calm per the minimalism feedback. Icon (or intent-glyph fallback) precedes the habit name.
- **Habits tab grid** (`renderHabits()` weekly grid): checked/filled cells use the habit's own colour instead of the current universal green. Unchecked/empty cells unchanged.
- **Progress → Calendar** (`renderSingleHabitCalendar()`): when a single habit is selected in the dropdown, heatmap cell intensity is shaded using that habit's colour instead of the generic blue. The "All habits" combined view (`renderAllHabitsCalendar()`) stays neutral blue, since it's aggregating multiple habits and a single colour wouldn't be meaningful.
- **Progress → Stats** (`habitStatCardHtml()`): each habit's progress bar fill uses its own colour instead of all-blue. Icon precedes the habit name in the card header.

Accent colour customisation (Settings) and the light/dark theme toggle are unaffected — habit colours are a separate, per-habit property layered on top of whichever theme/accent is active.

## Today row layout cleanup

Restyle the Today row (`habitCardHtml()` / associated CSS) to a single aligned line per habit:

- **Left**: coloured dot + icon/glyph + habit name.
- **Middle**: the existing stepper/input for scale habits, or the checkbox for check habits — unchanged interaction, just laid out inline instead of wrapping.
- **Right**: target fraction text, then the Skip button, right-aligned.

This is a CSS/markup restyle of the existing row, not a new component — no new interactions, no new data.

## Explicitly out of scope

- Mood tracker, stress meter, daily quote card, streak-crown gamification, group/accountability features, yearly per-habit contribution heatmap — all feature-shaped ideas from Habit, deferred to a future separate spec if Alfie wants them.
- The pre-existing uncommitted weekday-scheduling scaffolding in `app.js` — left untouched.
- Any change to the customise/theme/density/accent system.

## Verification plan

1. Load `demo-data.json` into `localStorage` in the browser preview (`momentum-v1` key) so all four habits are populated.
2. Check Today, Habits, Progress→Calendar (both "All habits" and a single habit selected), and Progress→Stats.
3. Confirm each habit shows a distinct, consistent colour across all four views, and that a custom icon (set on at least one demo habit) renders correctly with the glyph fallback still working on habits without one.
4. Repeat the same check with the light theme toggled on (Settings → Customise) to confirm colour contrast/readability holds in both themes.
5. Confirm no console errors and that existing interactions (check-off, stepper +/-, Skip, Edit) still work unchanged.
