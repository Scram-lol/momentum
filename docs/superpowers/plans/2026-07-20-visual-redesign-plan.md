# Momentum Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every habit a distinct colour + optional icon that renders consistently across Today, Habits, Progress→Calendar, and Progress→Stats; tidy the Today row layout so it stops wrapping; and finish the pre-existing, half-built weekday-specific scheduling feature by adding the missing edit-form UI for it.

**Architecture:** This is a single-file (`app.js`) rendering-and-state change with matching `style.css`/`index.html` markup — no new modules, no build step, no new dependencies. Two existing per-entity patterns already used for **goals** are extended to **habits**: (1) `PALETTE` + `.swatch-row` + `pickColor()` for colour selection, and (2) inline `style="border-left:...;background:..."` for applying an entity's own colour at render time (see `goalCardHtml()`, `renderDashboard()`'s goal box). The weekday-scheduling scaffolding (`scheduleMode`, `scheduleDays`, `isScheduledDay()`, `weeklyDueCount()`, `scheduleLabel()`) already exists and is already consumed by render code — this plan only adds the missing input UI in the **habit edit form**, mirroring how colour is also edit-form-only (not exposed in the quick "add habit" form) to keep habit creation a one-line action.

**Tech Stack:** Vanilla JS (`app.js`), plain CSS (`style.css`), static HTML (`index.html`). No build step, no package manager, no test framework — confirmed via `ls momentum/` (no `package.json`, no test directory).

## Global Constraints

- No new files, no build tooling, no dependencies — this app is intentionally a 3-file static site (per `README.md`).
- Reuse `PALETTE` (`app.js:4`) for every colour choice — never introduce a second colour list.
- `color` and `icon` are cosmetic fields — both must be added to `HISTORY_IGNORED_FIELDS` (`app.js:5`) so they never spam the per-habit edit history, matching how `color` already behaves for goals.
- Do not touch `scale`-type habit logic, the customise/theme/accent/density system, or any of the out-of-scope features listed in the spec (mood tracker, stress meter, daily quote, gamification, accountability, yearly per-habit heatmap).
- Every task must leave the app fully working when tested manually — this is a live tool Alfie uses for his own habits, not a library with a separate release step.

## Testing approach for this codebase

There is no test runner. "Tests" in this plan are concrete, repeatable checks against the running app:
- **Console assertions** — run a JS snippet in the browser console (or via a browser-automation tool's JS-eval capability) against `document`, and compare to an expected value.
- **Visual checks** — for colour/contrast/layout, take a screenshot and describe exactly what must be visible.

Every task's verification loads the same fixture first:

```js
// Paste in the browser console at http://localhost:4174, then reload the page.
const demo = {"habits":[{"id":"habit-train","name":"Train","type":"check","targetPerWeek":6,"checks":{"2026-06-27":true,"2026-06-28":true,"2026-06-29":true,"2026-06-30":true,"2026-07-01":true,"2026-07-02":true,"2026-07-04":true,"2026-07-05":true,"2026-07-06":true,"2026-07-07":true,"2026-07-08":true,"2026-07-09":true,"2026-07-10":true,"2026-07-11":true,"2026-07-12":true,"2026-07-13":true,"2026-07-14":true,"2026-07-15":true},"logs":{},"linkedFunnelId":null,"autoCreated":false,"editLog":[],"created":"2026-06-27"},{"id":"habit-outreach","name":"Outreach DMs","type":"scale","unit":"DMs","mode":"daily-target","dailyTarget":10,"targetPerWeek":5,"checks":{},"logs":{"2026-06-27":8,"2026-06-28":11,"2026-06-29":9,"2026-07-01":6,"2026-07-02":11,"2026-07-04":4,"2026-07-05":6,"2026-07-07":10,"2026-07-09":11,"2026-07-10":6,"2026-07-11":9},"linkedFunnelId":null,"autoCreated":false,"editLog":[],"created":"2026-06-27"},{"id":"habit-script","name":"Script writing","type":"scale","unit":"min","mode":"weekly-total","weeklyTarget":150,"targetPerWeek":7,"checks":{},"logs":{"2026-07-09":60,"2026-07-10":45,"2026-07-11":45,"2026-07-12":45,"2026-07-14":20,"2026-07-15":30},"linkedFunnelId":null,"autoCreated":false,"editLog":[],"created":"2026-07-09"},{"id":"habit-calories","name":"Calories","type":"scale","unit":"kcal","mode":"daily-target","dailyTarget":2839,"targetPerWeek":7,"checks":{},"logs":{"2026-07-05":2725,"2026-07-06":2794,"2026-07-07":2927,"2026-07-08":2712,"2026-07-09":3031,"2026-07-10":2628,"2026-07-11":2616,"2026-07-13":2633,"2026-07-14":2890},"linkedFunnelId":null,"autoCreated":false,"editLog":[],"created":"2026-07-05"}],"goals":[],"funnels":[],"profile":{"weightKg":70,"heightCm":178,"age":24,"sex":"male","activity":"light"}};
localStorage.setItem("momentum-v1", JSON.stringify(demo));
location.reload();
```

Run `python3 -m http.server 4174 -d momentum` (or use the `.claude/launch.json` "momentum" config) before starting, if it isn't already running.

---

### Task 1: Data model — per-habit colour cycling + icon field

**Files:**
- Modify: `momentum/app.js:101-117` (`normalizeHabit`)
- Modify: `momentum/app.js:150-161` (`hydrate`)
- Modify: `momentum/app.js:632-657` (add-habit form submit handler)
- Modify: `momentum/app.js:536-549` (`ensureAutoItems`, auto-habit creation)
- Modify: `momentum/app.js:5` (`HISTORY_IGNORED_FIELDS`)

**Interfaces:**
- Produces: `normalizeHabit(h, index = 0)` — every habit object now guarantees `color` (hex string from `PALETTE`) and `icon` (string, default `""`). All later tasks read `h.color` / `h.icon` on a **resolved** habit (`resolveHabit(hRaw)` already passes both through unchanged — verified at `app.js:574-590`, which spreads `h` into `resolved` without overwriting `color`/`icon`).

- [ ] **Step 1: Update `normalizeHabit` to accept an index and cycle the default colour, and add `icon`**

Replace `app.js:101-117`:

```js
function normalizeHabit(h) {
  return Object.assign({
    type: "check",
    intent: "build",
    targetPerWeek: 7,
    color: PALETTE[0],
    scheduleMode: "count",
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    checks: {},
    logs: {},
    skips: {},
    linkedFunnelId: null,
    autoCreated: false,
    created: todayKey(),
    editLog: [],
  }, h);
}
```

with:

```js
function normalizeHabit(h, index = 0) {
  return Object.assign({
    type: "check",
    intent: "build",
    targetPerWeek: 7,
    color: PALETTE[index % PALETTE.length],
    icon: "",
    scheduleMode: "count",
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    checks: {},
    logs: {},
    skips: {},
    linkedFunnelId: null,
    autoCreated: false,
    created: todayKey(),
    editLog: [],
  }, h);
}
```

Note: this only changes the *default* used when `h` doesn't already have a `color` — any habit already carrying a `color` (from a prior save, or explicitly passed in) keeps it, because `Object.assign(defaults, h)` lets `h`'s own keys win.

- [ ] **Step 2: Pass the array index through at every creation site**

In `hydrate()` (`app.js:155`), change:

```js
  s.habits = (s.habits || []).map(normalizeHabit);
```

to:

```js
  s.habits = (s.habits || []).map((h, i) => normalizeHabit(h, i));
```

In the add-habit form submit handler (`app.js:637`), change:

```js
  const habit = normalizeHabit({ id: uid(), name, type, intent: habitFormIntent });
```

to:

```js
  const habit = normalizeHabit({ id: uid(), name, type, intent: habitFormIntent }, state.habits.length);
```

In `ensureAutoItems()` (`app.js:538`), change the opening of the `push` call from:

```js
    state.habits.push(normalizeHabit({
      id: uid(),
```

to:

```js
    state.habits.push(normalizeHabit({
      id: uid(),
```

— then add `state.habits.length` as the second argument by changing the closing of that same call (`app.js:549`) from:

```js
      autoCreated: true,
    }));
```

to:

```js
      autoCreated: true,
    }, state.habits.length));
```

- [ ] **Step 3: Add `icon` to the cosmetic-fields ignore list**

Change `app.js:5`:

```js
const HISTORY_IGNORED_FIELDS = new Set(["color"]);
```

to:

```js
const HISTORY_IGNORED_FIELDS = new Set(["color", "icon"]);
```

- [ ] **Step 4: Verify — every habit gets a distinct colour with zero user action**

Run the fixture loader from "Testing approach" above, then in the console:

```js
JSON.parse(localStorage.getItem("momentum-v1")).habits === undefined // true — raw storage has no color field yet
```

Reload the page, then run:

```js
[...new Set(state.habits.map(h => h.color))].length === state.habits.length
```

Expected: `true` (4 habits → 4 distinct colours, `PALETTE[0..3]`). Also confirm:

```js
state.habits.every(h => h.icon === "")
```

Expected: `true`.

- [ ] **Step 5: Commit**

```bash
cd momentum && git add app.js && git commit -m "Habits: cycle default colour through PALETTE, add icon field"
```

---

### Task 2: Habit edit form — colour swatch + icon input

**Files:**
- Modify: `momentum/app.js:742-785` (`habitEditFormHtml`)
- Modify: `momentum/app.js:787-817` (`saveHabitEdit`)
- Modify: `momentum/style.css` (reuses existing `.swatch-row`/`.swatch` — no new rules needed)

**Interfaces:**
- Consumes: `PALETTE` (`app.js:4`), `.swatch-row`/`.swatch` CSS (`style.css:442-450`), the `pickColor(id, color, el)` pattern (`app.js:1155-1161`, goal-specific — not reused directly since it targets a `ge-color-*` hidden input; this task adds a habit-specific twin).
- Produces: `pickHabitColor(id, color, el)` — sets `#he-color-${id}` and toggles `.selected` on the clicked swatch, mirroring `pickColor`. `habitEditFormHtml(h)` now renders an icon `<input>` and a swatch row inside every habit's edit form (both check and scale types).

- [ ] **Step 1: Add `pickHabitColor`, mirroring `pickColor`**

Add this function immediately after `setHabitEditIntent` (`app.js:738-740`):

```js
function pickHabitColor(id, color, el) {
  const hidden = document.getElementById(`he-color-${id}`);
  if (hidden) hidden.value = color;
  const row = el.parentElement;
  row.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
  el.classList.add("selected");
}
```

- [ ] **Step 2: Add icon input + colour swatch row to the edit form**

In `habitEditFormHtml(h)` (`app.js:742-785`), the form currently starts:

```js
function habitEditFormHtml(h) {
  const isCheck = h.type === "check";
  return `<div class="habit-edit-form habit-form-card panel">
    <div class="form-row">
      <label class="field grow"><span class="field-label">Name</span>
        <input type="text" id="he-name-${h.id}" value="${esc(h.name)}">
      </label>
      <div class="field narrow">
        <span class="field-label">Intent</span>
        <div class="segmented" id="he-intent-${h.id}">
          <button type="button" data-value="build" class="${h.intent !== "quit" ? "active" : ""}" onclick="setHabitEditIntent('${h.id}','build',this)">🎯 Build</button>
          <button type="button" data-value="quit" class="${h.intent === "quit" ? "active" : ""}" onclick="setHabitEditIntent('${h.id}','quit',this)">🚫 Quit</button>
        </div>
      </div>
```

Change the `Name` field's row to add an icon field right after it, and insert a colour row right after that whole `form-row` div closes. Replace the block above with:

```js
function habitEditFormHtml(h) {
  const isCheck = h.type === "check";
  return `<div class="habit-edit-form habit-form-card panel">
    <div class="form-row">
      <label class="field grow"><span class="field-label">Name</span>
        <input type="text" id="he-name-${h.id}" value="${esc(h.name)}">
      </label>
      <label class="field narrow"><span class="field-label">Icon (optional)</span>
        <input type="text" id="he-icon-${h.id}" value="${esc(h.icon || "")}" maxlength="2" placeholder="🎯">
      </label>
      <div class="field narrow">
        <span class="field-label">Intent</span>
        <div class="segmented" id="he-intent-${h.id}">
          <button type="button" data-value="build" class="${h.intent !== "quit" ? "active" : ""}" onclick="setHabitEditIntent('${h.id}','build',this)">🎯 Build</button>
          <button type="button" data-value="quit" class="${h.intent === "quit" ? "active" : ""}" onclick="setHabitEditIntent('${h.id}','quit',this)">🚫 Quit</button>
        </div>
      </div>
```

Then, immediately after the `Target`/scale-fields `form-row` div closes and before `<div class="habit-edit-actions">` (`app.js:779-780`), insert a colour row. The code currently reads:

```js
      </span>`}
    </div>
    <div class="habit-edit-actions">
```

Change to:

```js
      </span>`}
    </div>
    <div class="field">
      <span class="field-label">Colour</span>
      <div class="swatch-row" id="he-swatches-${h.id}">
        ${PALETTE.map((c) => `<span class="swatch ${c === h.color ? "selected" : ""}" style="background:${c}" onclick="pickHabitColor('${h.id}','${c}',this)"></span>`).join("")}
      </div>
      <input type="hidden" id="he-color-${h.id}" value="${h.color}">
    </div>
    <div class="habit-edit-actions">
```

- [ ] **Step 3: Persist icon + colour on save**

In `saveHabitEdit(id)` (`app.js:787-817`), the function currently ends with:

```js
  const after = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent };
  diffAndLog(h, before, after, "");
  habitEditing.delete(id);
  save();
  renderAll();
}
```

Change to (adding the two new fields right before the diff, since they're read directly — colour/icon are ignored by `diffAndLog` via `HISTORY_IGNORED_FIELDS`, so they don't need to be in `before`/`after`):

```js
  h.icon = document.getElementById(`he-icon-${id}`).value.trim().slice(0, 2);
  h.color = document.getElementById(`he-color-${id}`).value;

  const after = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent };
  diffAndLog(h, before, after, "");
  habitEditing.delete(id);
  save();
  renderAll();
}
```

- [ ] **Step 4: Verify — colour and icon are settable and persist**

Load the fixture, reload, then in the console:

```js
toggleHabitEdit("habit-train"); renderHabits();
```

Take a screenshot of the Habits tab. Expected: "Train"'s row shows an expanded edit form with a "Colour" swatch row (8 circles) and an "Icon (optional)" text box.

Then simulate picking the 3rd swatch and setting an icon, and saving, via console (this exercises exactly what a click+save would do):

```js
document.getElementById("he-icon-habit-train").value = "🏋️";
pickHabitColor("habit-train", PALETTE[2], document.querySelectorAll("#he-swatches-habit-train .swatch")[2]);
saveHabitEdit("habit-train");
state.habits.find(h => h.id === "habit-train").color === PALETTE[2] &&
state.habits.find(h => h.id === "habit-train").icon === "🏋️"
```

Expected: `true`. Then confirm no history entry was created for this cosmetic change:

```js
state.habits.find(h => h.id === "habit-train").editLog.some(e => e.field === "color" || e.field === "icon")
```

Expected: `false`.

- [ ] **Step 5: Commit**

```bash
cd momentum && git add app.js && git commit -m "Habits: add colour swatch and icon input to edit form"
```

---

### Task 3: Finish weekday-specific scheduling — edit-form day picker

**Files:**
- Modify: `momentum/app.js:742-785` (`habitEditFormHtml`, check-type branch)
- Modify: `momentum/app.js:787-817` (`saveHabitEdit`)
- Modify: `momentum/app.js` (two new small functions, placed next to `setHabitEditIntent`)
- Modify: `momentum/style.css` (new `.day-toggle-row` / `.day-toggle` rules)

**Interfaces:**
- Consumes: `DAY_LETTERS` (`app.js:837`), `scheduleLabel(h)` (`app.js:845-852`) — both already exist and are unmodified by this task.
- Produces: `setHabitEditScheduleMode(id, value)` and `toggleHabitEditDay(id, btnEl)` — new. After this task, `scheduleMode`/`scheduleDays` become genuinely user-settable per check-habit; every existing consumer of those fields (`isScheduledDay`, `weeklyDueCount`, `scheduleLabel`, and their call sites) needs no changes because they already handle both modes correctly.

- [ ] **Step 1: Add the two new handler functions**

Add immediately after `setHabitEditIntent` (`app.js:738-740`, right before `habitEditFormHtml`):

```js
function setHabitEditScheduleMode(id, value) {
  document.getElementById(`he-schedule-count-${id}`).style.display = value === "weekdays" ? "none" : "";
  document.getElementById(`he-schedule-days-${id}`).style.display = value === "weekdays" ? "" : "none";
}

function toggleHabitEditDay(id, btnEl) {
  btnEl.classList.toggle("active");
}
```

- [ ] **Step 2: Add the schedule-mode toggle + day picker to the check-type branch of the edit form**

In `habitEditFormHtml(h)`, the check-type Target field currently reads (`app.js:756-758`, after Task 2's edits this is now a few lines further down but unchanged in content):

```js
      ${isCheck ? `<label class="field narrow"><span class="field-label">Target</span>
        <select id="he-target-${h.id}">${cadenceOptionsHtml(h.targetPerWeek)}</select>
      </label>` : `<label class="field narrow"><span class="field-label">Unit</span>
```

Change the check-type branch to add a schedule-mode select next to it, plus the (initially hidden or shown, matching current state) day picker as a second row. Replace:

```js
      ${isCheck ? `<label class="field narrow"><span class="field-label">Target</span>
        <select id="he-target-${h.id}">${cadenceOptionsHtml(h.targetPerWeek)}</select>
      </label>` : `<label class="field narrow"><span class="field-label">Unit</span>
```

with:

```js
      ${isCheck ? `<label class="field narrow"><span class="field-label">Schedule</span>
        <select id="he-schedule-mode-${h.id}" onchange="setHabitEditScheduleMode('${h.id}', this.value)">
          <option value="count" ${h.scheduleMode !== "weekdays" ? "selected" : ""}>By count</option>
          <option value="weekdays" ${h.scheduleMode === "weekdays" ? "selected" : ""}>Specific days</option>
        </select>
      </label>
      <label class="field narrow" id="he-schedule-count-${h.id}" style="display:${h.scheduleMode === "weekdays" ? "none" : ""}">
        <span class="field-label">Target</span>
        <select id="he-target-${h.id}">${cadenceOptionsHtml(h.targetPerWeek)}</select>
      </label>
      <div class="field" id="he-schedule-days-${h.id}" style="display:${h.scheduleMode === "weekdays" ? "" : "none"}">
        <span class="field-label">Days</span>
        <div class="day-toggle-row">
          ${DAY_LETTERS.map((letter, i) => `<button type="button" class="day-toggle ${(h.scheduleDays || []).includes(i) ? "active" : ""}" onclick="toggleHabitEditDay('${h.id}', this)" data-day="${i}">${letter}</button>`).join("")}
        </div>
      </div>` : `<label class="field narrow"><span class="field-label">Unit</span>
```

- [ ] **Step 3: Add the CSS for `.day-toggle-row` / `.day-toggle`**

Add to `style.css`, right after the `.swatch`/`.swatch-row` rules (`style.css:442-450`):

```css
/* ---- weekday picker (habit edit form) ---- */
.day-toggle-row { display: flex; gap: 6px; }
.day-toggle {
  width: 30px; height: 30px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.day-toggle:hover { border-color: var(--accent); }
.day-toggle.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
```

- [ ] **Step 4: Persist schedule changes on save, with a readable history entry**

In `saveHabitEdit(id)` (`app.js:787-817`), the function currently starts:

```js
function saveHabitEdit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const before = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent };
```

and the check-type branch reads:

```js
  if (h.type === "check") {
    h.targetPerWeek = Number(document.getElementById(`he-target-${id}`).value);
  } else {
```

Change the top to capture a `schedule` label before mutation:

```js
function saveHabitEdit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const before = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent, schedule: scheduleLabel(h) };
```

and change the check-type branch to also read the new schedule-mode/day-picker fields:

```js
  if (h.type === "check") {
    h.targetPerWeek = Number(document.getElementById(`he-target-${id}`).value);
    h.scheduleMode = document.getElementById(`he-schedule-mode-${id}`).value;
    if (h.scheduleMode === "weekdays") {
      h.scheduleDays = [...document.querySelectorAll(`#he-schedule-days-${id} .day-toggle.active`)].map((b) => Number(b.dataset.day));
    }
  } else {
```

Note: `scheduleDays` is only overwritten when in `"weekdays"` mode, so switching back to `"count"` and later back to `"weekdays"` remembers the last-picked days (they're never cleared).

Finally, change the `after` object (`app.js:812`, now a few lines further down) from:

```js
  const after = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent };
```

to:

```js
  const after = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent, schedule: scheduleLabel(h) };
```

- [ ] **Step 5: Verify — picking specific days changes scheduling behaviour and logs a readable history entry**

Load the fixture, reload, then in the console (this drives the exact same code path a real click-through would):

```js
toggleHabitEdit("habit-train");
```

Screenshot the Habits tab — expected: Train's edit form shows a "Schedule" dropdown ("By count" / "Specific days") and, since it defaults to "By count", the existing Target dropdown is visible and the day picker is hidden.

```js
document.getElementById("he-schedule-mode-habit-train").value = "weekdays";
setHabitEditScheduleMode("habit-train", "weekdays");
```

Screenshot again — expected: Target dropdown now hidden, seven circular day buttons (M T W T F S S) visible, all showing `.active` (since the default `scheduleDays` is all 7).

```js
const mon = document.querySelector('#he-schedule-days-habit-train .day-toggle[data-day="0"]');
const tue = document.querySelector('#he-schedule-days-habit-train .day-toggle[data-day="1"]');
[tue, ...[2,3,4,5,6].map(d => document.querySelector(`#he-schedule-days-habit-train .day-toggle[data-day="${d}"]`))].forEach(toggleHabitEditDay.bind(null, "habit-train"));
saveHabitEdit("habit-train");
const h = state.habits.find(x => x.id === "habit-train");
h.scheduleMode === "weekdays" && JSON.stringify(h.scheduleDays.sort()) === JSON.stringify([0])
```

Expected: `true` (only Monday left active). Then:

```js
scheduleLabel(h) === "M"
```

Expected: `true`. And confirm the change was logged (schedule is a structural change, not cosmetic):

```js
h.editLog.some(e => e.field === "schedule")
```

Expected: `true`.

- [ ] **Step 6: Commit**

```bash
cd momentum && git add app.js style.css && git commit -m "Habits: finish weekday-specific scheduling with edit-form day picker"
```

---

### Task 4: Today row — colour accent, icon, and layout cleanup

**Files:**
- Modify: `momentum/app.js:2032-2077` (`renderDashboard`, habit rows only)
- Modify: `momentum/style.css:317-330` (`.dash-habit-row` and children)

**Interfaces:**
- Consumes: `h.color`, `h.icon` (Task 1).
- Produces: no new functions — pure markup/CSS change inside `renderDashboard()`.

- [ ] **Step 1: Restyle the Today row markup**

In `renderDashboard()` (`app.js:2042-2076`), the habit-row mapping currently reads:

```js
    habitBox.innerHTML = state.habits.map((hRaw) => {
      const h = resolveHabit(hRaw);
      const skippedToday = isSkipped(hRaw, tk);
      const skipBtn = `<button class="skip-btn" onclick="toggleSkip('${hRaw.id}','${tk}')">${skippedToday ? "↺ Unskip" : "⏭ Skip"}</button>`;

      if (skippedToday) {
        return `<div class="dash-habit-row dash-skipped">
          <span class="check-cell skipped">⏭</span>
          <span class="name muted">${esc(h.name)} — skipped today</span>
          ${skipBtn}
        </div>`;
      }

      if (h.type === "check") {
        const done = !!hRaw.checks[tk];
        return `<div class="dash-habit-row">
          <span class="check-cell ${done ? "done" : ""} ${done && h.intent === "quit" ? "quit-habit" : ""}" onclick="toggleCheck('${hRaw.id}','${tk}')">${done ? (h.intent === "quit" ? "🚫" : "✓") : "·"}</span>
          <span class="name ${done ? "done" : ""}">${esc(h.name)}</span>
          <span class="streak-badge">🔥 ${streak(h)}</span>
          ${skipBtn}
        </div>`;
      }
      const val = hRaw.logs[tk];
      const targetNote = h.mode === "weekly-total" ? ` / ${fmt(h.weeklyTarget, 1)} this wk` : ` / ${fmt(h.dailyTarget, 1)} target`;
      return `<div class="dash-habit-row">
        <div class="scale-stepper">
          <button class="step-btn" onclick="stepScaleLog('${hRaw.id}','${tk}',-1)">−</button>
          <input type="number" class="scale-cell-inline" value="${val !== undefined ? val : ""}" step="any" min="0" placeholder="0"
            onchange="setScaleLog('${hRaw.id}','${tk}',this.value)">
          <button class="step-btn" onclick="stepScaleLog('${hRaw.id}','${tk}',1)">+</button>
        </div>
        <span class="name">${esc(h.name)} <span class="muted">${esc(h.unit)}${targetNote}</span></span>
        ${skipBtn}
      </div>`;
    }).join("");
```

Replace the whole block with a version that (a) adds `style="border-left:3px solid ${h.color}"` to every row, matching the existing `.dash-goal-row` convention, (b) prefixes the name with `h.icon` (falling back to the existing build/quit glyph when empty), and (c) for scale habits, moves the unit/target text out of `.name` into its own right-aligned span so it stops competing for space and wrapping:

```js
    habitBox.innerHTML = state.habits.map((hRaw) => {
      const h = resolveHabit(hRaw);
      const skippedToday = isSkipped(hRaw, tk);
      const skipBtn = `<button class="skip-btn" onclick="toggleSkip('${hRaw.id}','${tk}')">${skippedToday ? "↺ Unskip" : "⏭ Skip"}</button>`;
      const icon = h.icon || (h.intent === "quit" ? "🚫" : "🎯");

      if (skippedToday) {
        return `<div class="dash-habit-row dash-skipped" style="border-left:3px solid ${h.color}">
          <span class="check-cell skipped">⏭</span>
          <span class="habit-icon">${icon}</span>
          <span class="name muted">${esc(h.name)} — skipped today</span>
          ${skipBtn}
        </div>`;
      }

      if (h.type === "check") {
        const done = !!hRaw.checks[tk];
        return `<div class="dash-habit-row" style="border-left:3px solid ${h.color}">
          <span class="check-cell ${done ? "done" : ""} ${done && h.intent === "quit" ? "quit-habit" : ""}" style="${done ? `background:${h.color};border-color:${h.color};color:#fff` : ""}" onclick="toggleCheck('${hRaw.id}','${tk}')">${done ? (h.intent === "quit" ? "🚫" : "✓") : "·"}</span>
          <span class="habit-icon">${icon}</span>
          <span class="name ${done ? "done" : ""}">${esc(h.name)}</span>
          <span class="streak-badge">🔥 ${streak(h)}</span>
          ${skipBtn}
        </div>`;
      }
      const val = hRaw.logs[tk];
      const targetNote = h.mode === "weekly-total" ? `/ ${fmt(h.weeklyTarget, 1)} this wk` : `/ ${fmt(h.dailyTarget, 1)} target`;
      return `<div class="dash-habit-row" style="border-left:3px solid ${h.color}">
        <span class="habit-icon">${icon}</span>
        <div class="scale-stepper">
          <button class="step-btn" onclick="stepScaleLog('${hRaw.id}','${tk}',-1)">−</button>
          <input type="number" class="scale-cell-inline" value="${val !== undefined ? val : ""}" step="any" min="0" placeholder="0"
            onchange="setScaleLog('${hRaw.id}','${tk}',this.value)">
          <button class="step-btn" onclick="stepScaleLog('${hRaw.id}','${tk}',1)">+</button>
        </div>
        <span class="name">${esc(h.name)}</span>
        <span class="habit-target-note muted">${esc(h.unit)} ${targetNote}</span>
        ${skipBtn}
      </div>`;
    }).join("");
```

- [ ] **Step 2: Add supporting CSS**

In `style.css`, the `.dash-habit-row` block currently reads (`style.css:317-328`):

```css
.dash-habit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.dash-habit-row:last-child { border-bottom: none; }
.dash-habit-row .name { flex: 1; font-size: 14px; }
.dash-habit-row .name.done { text-decoration: line-through; color: var(--muted); }
.dash-habit-row.dash-skipped { opacity: 0.75; }
```

Change to (adding `padding-left` so the new left border doesn't crowd the icon, and two new rules for the icon and the scale target note):

```css
.dash-habit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 0 8px 8px;
  border-bottom: 1px solid var(--border);
}
.dash-habit-row:last-child { border-bottom: none; }
.dash-habit-row .name { flex: 1; font-size: 14px; min-width: 80px; }
.dash-habit-row .name.done { text-decoration: line-through; color: var(--muted); }
.dash-habit-row.dash-skipped { opacity: 0.75; }
.habit-icon { font-size: 15px; line-height: 1; }
.habit-target-note { font-size: 12px; white-space: nowrap; }
```

- [ ] **Step 3: Verify — rows no longer wrap, and show the habit's colour + icon**

Load the fixture, reload, resize the browser viewport to something narrow-ish but realistic (e.g. 480px wide, since that's where wrapping was visible before) and screenshot the Today tab. Expected: each row is a single visual line — icon, name, and (for scale habits) a short right-hand "unit / target" note that doesn't force the name onto a second line. Confirm programmatically too:

```js
[...document.querySelectorAll(".dash-habit-row")].every(row => row.style.borderLeftColor !== "")
```

Expected: `true`. And:

```js
document.querySelector(".dash-habit-row .habit-icon").textContent
```

Expected: `"🎯"` (Train has no custom icon set, intent is "build").

- [ ] **Step 4: Commit**

```bash
cd momentum && git add app.js style.css && git commit -m "Today: per-habit colour accent, icon, and single-line row layout"
```

---

### Task 5: Habits tab grid — colour on checked cells (desktop table + mobile card)

**Files:**
- Modify: `momentum/app.js:968-989` (`renderHabits`, desktop `<td>` check-cell)
- Modify: `momentum/app.js:877-896` (`habitCardHtml`, mobile `.wk-dot` strip)
- Modify: `momentum/app.js:925-929` (`habitCardHtml`, mobile card header — icon)

**Interfaces:**
- Consumes: `h.color`, `h.icon` (Task 1).
- Produces: no new functions — inline-style additions to existing render output.

- [ ] **Step 1: Colour the desktop grid's checked cells**

In `renderHabits()` (`app.js:983-988`), the check-type `<td>` currently reads:

```js
      } else {
        const done = !!hRaw.checks[key];
        const cls = `check-cell ${done ? "done" : ""} ${done && h.intent === "quit" ? "quit-habit" : ""} ${skipped ? "skipped" : ""} ${future ? "future" : ""}`;
        const glyph = done ? (h.intent === "quit" ? "🚫" : "✓") : skipped ? "⏭" : "·";
        html += `<td class="${skipped ? "skipped-cell" : ""}"><span class="${cls}"
          ${future ? "" : `onclick="toggleCheck('${hRaw.id}','${key}')"`}>${glyph}</span></td>`;
      }
```

Change to:

```js
      } else {
        const done = !!hRaw.checks[key];
        const cls = `check-cell ${done ? "done" : ""} ${done && h.intent === "quit" ? "quit-habit" : ""} ${skipped ? "skipped" : ""} ${future ? "future" : ""}`;
        const glyph = done ? (h.intent === "quit" ? "🚫" : "✓") : skipped ? "⏭" : "·";
        const style = done ? ` style="background:${h.color};border-color:${h.color};color:#fff"` : "";
        html += `<td class="${skipped ? "skipped-cell" : ""}"><span class="${cls}"${style}
          ${future ? "" : `onclick="toggleCheck('${hRaw.id}','${key}')"`}>${glyph}</span></td>`;
      }
```

Note: scale-type `<td>` cells (the `if (isScale)` branch just above, `app.js:979-982`) render a plain numeric `<input>` with no "done" colour concept today — left unchanged, since there's nothing to recolour there.

- [ ] **Step 2: Colour the mobile week-strip dots and add the icon to the mobile card header**

In `habitCardHtml()` (`app.js:887-896`), the strip-building code currently reads:

```js
    let cls = "wk-dot";
    let glyph = "";
    if (isToday) cls += " wk-today";
    if (future) cls += " wk-future";
    else if (doneState) { cls += " wk-done"; glyph = !isScale && h.intent === "quit" ? "🚫" : isScale ? "" : "✓"; }
    else if (skipped) { cls += " wk-skip"; glyph = "⏭"; }
    else cls += " wk-miss";
    const tap = (!future && !isScale) ? `onclick="toggleCheck('${hRaw.id}','${key}')"` : "";
    return `<div class="wk-day"><span class="${cls}" ${tap}>${glyph}</span><span class="wk-lbl${isToday ? " wk-lbl-today" : ""}">${dayLetters[i]}</span></div>`;
```

Change to:

```js
    let cls = "wk-dot";
    let glyph = "";
    let dotStyle = "";
    if (isToday) cls += " wk-today";
    if (future) cls += " wk-future";
    else if (doneState) { cls += " wk-done"; glyph = !isScale && h.intent === "quit" ? "🚫" : isScale ? "" : "✓"; dotStyle = ` style="background:${h.color};border-color:${h.color};color:#fff"`; }
    else if (skipped) { cls += " wk-skip"; glyph = "⏭"; }
    else cls += " wk-miss";
    const tap = (!future && !isScale) ? `onclick="toggleCheck('${hRaw.id}','${key}')"` : "";
    return `<div class="wk-day"><span class="${cls}"${dotStyle} ${tap}>${glyph}</span><span class="wk-lbl${isToday ? " wk-lbl-today" : ""}">${dayLetters[i]}</span></div>`;
```

Then, in the mobile card header (`app.js:925-929`):

```js
  return `<div class="habit-card">
    <div class="hc-head">
      <div><div class="hc-name">${esc(h.name)}</div><div class="habit-meta">${habitMetaLabel(h)} ${quitTag}</div></div>
      <button class="delete-btn" onclick="deleteHabit('${hRaw.id}')" title="Delete">✕</button>
    </div>
```

Change to prefix the name with the icon (same fallback rule as Task 4):

```js
  const icon = h.icon || (h.intent === "quit" ? "🚫" : "🎯");
  return `<div class="habit-card">
    <div class="hc-head">
      <div><div class="hc-name">${icon} ${esc(h.name)}</div><div class="habit-meta">${habitMetaLabel(h)} ${quitTag}</div></div>
      <button class="delete-btn" onclick="deleteHabit('${hRaw.id}')" title="Delete">✕</button>
    </div>
```

- [ ] **Step 3: Verify**

Load the fixture, reload, go to the Habits tab (desktop width, e.g. 1280px). Screenshot it. Expected: "Train"'s checked-off days (Mon/Tue/Wed) render in Train's own colour (`PALETTE[0]`, blue) rather than the old universal green.

Programmatic check:

```js
const trainCells = [...document.querySelectorAll("#habit-grid tr")].find(tr => tr.textContent.includes("Train"))?.querySelectorAll(".check-cell.done");
trainCells && trainCells.length > 0 && [...trainCells].every(c => c.style.backgroundColor !== "")
```

Expected: `true`.

Then resize to mobile width (< 640px), reload, screenshot the Habits tab again. Expected: Train's card shows a 🎯 icon before its name, and its done-day dots are coloured to match.

- [ ] **Step 4: Commit**

```bash
cd momentum && git add app.js && git commit -m "Habits grid: colour checked cells per habit, add icon to mobile card"
```

---

### Task 6: Progress → Calendar — colour the single-habit heatmap

**Files:**
- Modify: `momentum/app.js:2202-2250` (`renderSingleHabitCalendar`)

**Interfaces:**
- Consumes: `h.color` (Task 1). `renderAllHabitsCalendar()` (`app.js:2252-2289`) is explicitly **not** touched — the spec calls for the combined view to stay neutral since it aggregates multiple habits.

- [ ] **Step 1: Colour done/logged cells and the daily-target progress bar**

In `renderSingleHabitCalendar(hRaw)` (`app.js:2217-2237`), the cell-building logic currently reads:

```js
    } else {
      if (!isFuture) pastCount++;
      if (isScale) {
        const val = hRaw.logs[key];
        if (val !== undefined) {
          loggedCount++; sum += val;
          cellClass += " cal-has-value";
          content += `<div class="cal-value">${fmt(val, 1)}</div>`;
          if (h.mode === "daily-target" && h.dailyTarget > 0) {
            const pct = Math.min(1, val / h.dailyTarget);
            content += `<div class="cal-bar"><div style="width:${pct * 100}%"></div></div>`;
          }
        } else if (!isFuture) {
          cellClass += " cal-empty-val";
        }
      } else {
        const done = !!hRaw.checks[key];
        if (done) { doneCount++; cellClass += " cal-done"; content += `<div class="cal-check">✓</div>`; }
        else if (!isFuture) { cellClass += " cal-missed"; }
      }
    }
```

Change to (adding an inline colour override wherever the cell would otherwise use the generic green/accent):

```js
    } else {
      if (!isFuture) pastCount++;
      if (isScale) {
        const val = hRaw.logs[key];
        if (val !== undefined) {
          loggedCount++; sum += val;
          cellClass += " cal-has-value";
          content += `<div class="cal-value">${fmt(val, 1)}</div>`;
          if (h.mode === "daily-target" && h.dailyTarget > 0) {
            const pct = Math.min(1, val / h.dailyTarget);
            content += `<div class="cal-bar"><div style="width:${pct * 100}%;background:${h.color}"></div></div>`;
          }
        } else if (!isFuture) {
          cellClass += " cal-empty-val";
        }
      } else {
        const done = !!hRaw.checks[key];
        if (done) {
          doneCount++; cellClass += " cal-done";
          content += `<div class="cal-check" style="color:${h.color}">✓</div>`;
        } else if (!isFuture) { cellClass += " cal-missed"; }
      }
    }
```

Then, in the surrounding `calendarSkeleton` callback (`app.js:2207-2210`), the cell wrapper currently reads:

```js
  const gridHtml = calendarSkeleton((day, key, isToday, isFuture) => {
    let cellClass = "cal-cell";
    let content = `<div class="cal-daynum">${day}</div>`;
    if (isToday) cellClass += " cal-today";
```

and finally returns (`app.js:2239`):

```js
    if (isFuture) cellClass += " cal-future";
    return `<div class="${cellClass}">${content}</div>`;
```

Change the return line to add an inline background/border tint on done/has-value cells, using the same `color-mix()` approach the combined-view heatmap already uses for its `.all-alpha-*` classes (`style.css:756-759`):

```js
    if (isFuture) cellClass += " cal-future";
    const tint = (cellClass.includes("cal-done") || cellClass.includes("cal-has-value"))
      ? ` style="background:color-mix(in srgb, ${h.color} 18%, var(--panel));border-color:${h.color}"`
      : "";
    return `<div class="${cellClass}"${tint}>${content}</div>`;
```

(This one line replaces the single `return` statement at the end of the callback — everything above it in `renderSingleHabitCalendar` is unchanged except the two inner blocks already shown.)

- [ ] **Step 2: Verify**

Load the fixture, go to Progress → Calendar, select "Train" from the habit dropdown. Screenshot it. Expected: done days show a light tint of Train's own colour (blue) instead of the previous green, with the border also in that colour.

```js
document.getElementById("calendar-habit-select").value = "habit-train";
renderCalendar();
[...document.querySelectorAll(".cal-cell.cal-done")].every(c => c.style.background.includes("color-mix"))
```

Expected: `true`. Then switch to "All habits" and confirm it's unaffected:

```js
document.getElementById("calendar-habit-select").value = "__all__";
renderCalendar();
[...document.querySelectorAll(".all-cell")].every(c => c.style.background === "")
```

Expected: `true` (combined view still relies purely on its existing `.all-alpha-*` CSS classes, no inline override).

- [ ] **Step 3: Commit**

```bash
cd momentum && git add app.js && git commit -m "Progress calendar: colour single-habit heatmap by habit colour"
```

---

### Task 7: Progress → Stats — colour the progress bar, add icon

**Files:**
- Modify: `momentum/app.js:2347-2372` (`habitStatCardHtml`)

**Interfaces:**
- Consumes: `h.color`, `h.icon` (Task 1).

- [ ] **Step 1: Colour the stat bar and add the icon to the card head**

`habitStatCardHtml(hRaw)` currently reads:

```js
function habitStatCardHtml(hRaw) {
  const h = resolveHabit(hRaw);
  const w = habitStatsWindow(hRaw, 30);
  const isCheck = h.type === "check";
  const isWeeklyTotal = h.type === "scale" && h.mode === "weekly-total";
  const pct = habitStatPct(hRaw, w);
  const avgVal = w.loggedDays ? w.sum / w.loggedDays : 0;

  let metaLine;
  if (!w.totalDays) metaLine = "on vacation the whole window";
  else if (isCheck) metaLine = `${w.doneDays}/${w.totalDays} days done`;
  else if (isWeeklyTotal) metaLine = `${w.loggedDays}/${w.totalDays} days logged · avg ${fmt(avgVal, 1)} ${esc(h.unit)}`;
  else metaLine = `${w.doneDays}/${w.totalDays} days hit target · avg ${fmt(avgVal, 1)} ${esc(h.unit)}`;

  const streaksHtml = isWeeklyTotal ? "" : `<div class="stat-streaks">
    <span><strong>${streak(hRaw)}</strong> current streak</span>
    <span><strong>${longestStreak(hRaw)}</strong> best streak</span>
  </div>`;

  return `<div class="stat-card">
    <div class="stat-head"><strong>${esc(h.name)}</strong><span class="muted">${esc(h.unit || "check-off")}</span></div>
    <div class="stat-bar-row"><div class="stat-bar"><div style="width:${pct ?? 0}%"></div></div><span class="stat-pct">${pct === null ? "–" : pct + "%"}</span></div>
    <div class="stat-meta">${metaLine} <span class="muted">(last 30 days)</span></div>
    ${streaksHtml}
  </div>`;
}
```

Change the `stat-head` and `stat-bar-row` lines to:

```js
  const icon = h.icon || (h.intent === "quit" ? "🚫" : "🎯");
  return `<div class="stat-card">
    <div class="stat-head"><strong>${icon} ${esc(h.name)}</strong><span class="muted">${esc(h.unit || "check-off")}</span></div>
    <div class="stat-bar-row"><div class="stat-bar"><div style="width:${pct ?? 0}%;background:${h.color}"></div></div><span class="stat-pct">${pct === null ? "–" : pct + "%"}</span></div>
    <div class="stat-meta">${metaLine} <span class="muted">(last 30 days)</span></div>
    ${streaksHtml}
  </div>`;
}
```

- [ ] **Step 2: Verify**

Load the fixture, go to Progress → Stats. Screenshot it. Expected: each of the 4 habit cards shows an icon before its name, and each progress bar fill is a different colour matching that habit's colour elsewhere in the app (not all blue).

```js
[...document.querySelectorAll(".stat-bar div")].map(d => d.style.background)
```

Expected: 4 different non-empty colour values, matching `state.habits.map(h => h.color)` in the same order.

- [ ] **Step 3: Commit**

```bash
cd momentum && git add app.js && git commit -m "Progress stats: colour progress bar per habit, add icon to card head"
```

---

### Task 8: Full walkthrough verification (both themes)

**Files:** none — verification only.

- [ ] **Step 1: Dark theme walkthrough**

Load the fixture fresh (clears any state from earlier tasks' manual test edits — re-run the loader snippet from "Testing approach" and reload). Visit, in order: Today, Habits (desktop width), Habits (resize to < 640px), Progress → Calendar (both "All habits" and "Train" selected), Progress → Stats. Screenshot each. Confirm on each screen:
- Every habit shows a distinct, consistent colour (cross-check the same habit's colour looks the same across all five screens).
- Icons render (fallback 🎯/🚫 glyph, since the fixture habits have no custom icon set).
- No row wraps awkwardly on the Today tab.
- No console errors: `read_console_messages` (or open devtools) shows nothing new.

- [ ] **Step 2: Light theme walkthrough**

Toggle light theme (Settings → Customise → Theme → Light, or via console: `settings.theme = "light"; saveSettings(); applySettings(); renderAll();`). Repeat the same five-screen walkthrough. Confirm colours remain readable against the light backgrounds (the `color-mix(... var(--panel))` calendar tint and the light-theme `--panel`/`--panel-2` tokens should already handle this automatically, since they're theme-aware CSS variables — this step is a visual confirmation, not a code change).

- [ ] **Step 3: Regression check on existing interactions**

With the fixture loaded, dark theme: check off a habit on Today, log a scale value via the stepper, click Skip on a habit, expand and Edit a habit (both a check-type and a scale-type one), and confirm each still works exactly as before (no JS errors, state updates, `renderAll()` reflects the change). This confirms none of the seven prior tasks broke an existing code path.

- [ ] **Step 4: Final commit**

If step 1–3 surfaced any fixes, commit them individually with descriptive messages (each fix its own commit, not squashed). If everything passed with no changes needed, no commit is required for this task — it's a verification gate, not a code change.
