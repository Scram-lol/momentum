/* Momentum — habits, goals & flexible funnels. All data lives in localStorage. */

const STORE_KEY = "momentum-v1";
const PALETTE = ["#4f9cf9", "#3ecf8e", "#f5b83d", "#f26d6d", "#b98cf2", "#39c5cf", "#f28cc3", "#9aa5b1"];
const HISTORY_IGNORED_FIELDS = new Set(["color"]);
const goalEditing = new Set();
const habitEditing = new Set();
let expandedFunnelId = null;
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- dates ---------- */

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const todayKey = () => dateKey(new Date());

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Math.round(days));
  return dateKey(d);
}

// Monday-start week containing today
function weekDates() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Mon=0
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/* ---------- state ---------- */

function defaults() {
  return { habits: [], goals: [], funnels: [], profile: defaultProfile(), vacations: [], updatedAt: 0 };
}

function defaultProfile() {
  return { weightKg: null, heightCm: null, age: null, sex: "male", activity: "light", bodyFatPct: null };
}

function normalizeProfile(p) {
  return Object.assign(defaultProfile(), p || {});
}

// matches calculator.net's calorie calculator activity scale
const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.465,
  active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

function usesKatchMcArdle(p) {
  return isFinite(Number(p.bodyFatPct)) && Number(p.bodyFatPct) > 0 && Number(p.bodyFatPct) < 100;
}

function calcBMR(p) {
  if (usesKatchMcArdle(p)) {
    // Katch-McArdle — more accurate when body fat % is known
    const leanMassKg = p.weightKg * (1 - Number(p.bodyFatPct) / 100);
    return 370 + 21.6 * leanMassKg;
  }
  // Mifflin-St Jeor
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === "female" ? base - 161 : base + 5;
}

function calcTDEE(p) {
  return calcBMR(p) * (ACTIVITY_MULTIPLIERS[p.activity] || 1.375);
}

function migrateFunnel(old) {
  return normalizeFunnel({
    id: uid(),
    title: "Revenue funnel",
    unit: "£",
    goalValue: old.goal,
    days: old.days,
    stages: [
      { id: uid(), label: "Clients needed", kind: "ratio", value: old.clientValue },
      { id: uid(), label: "Good-fit calls", kind: "percent", value: old.scr },
      { id: uid(), label: "Show-ups", kind: "percent", value: old.gfr },
      { id: uid(), label: "Bookings", kind: "percent", value: old.sur },
      { id: uid(), label: "Total outreach volume", kind: "percent", value: old.abr },
    ],
  });
}

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

function normalizeVacation(v) {
  return Object.assign({ id: uid(), label: "", start: todayKey(), end: todayKey(), habitIds: [] }, v);
}

function normalizeGoal(g) {
  return Object.assign({
    color: PALETTE[0],
    created: todayKey(),
    linkedFunnelId: null,
    autoCreated: false,
    milestones: [],
    editLog: [],
  }, g);
}

function normalizeFunnel(f) {
  return Object.assign({
    cadence: "day",
    actionUnit: "",
    autoGoal: false,
    autoHabit: false,
    dailyOffset: null,
    editLog: [],
  }, f);
}

// unit of the funnel's final action — may differ from the goal unit (kg goal → kcal action)
function actionUnit(f) {
  return f.actionUnit || f.unit;
}

function hydrate(raw) {
  const s = Object.assign(defaults(), raw || {});
  if (raw && raw.funnel && !raw.funnels) {
    s.funnels = [migrateFunnel(raw.funnel)];
  }
  s.habits = (s.habits || []).map(normalizeHabit);
  s.goals = (s.goals || []).map(normalizeGoal);
  s.funnels = (s.funnels || []).map(normalizeFunnel);
  s.profile = normalizeProfile(s.profile);
  s.vacations = (s.vacations || []).map(normalizeVacation);
  return s;
}

function load() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { raw = null; }
  return hydrate(raw);
}

let state = load();

// writes to localStorage only — no GitHub side effect. Used when applying data
// that just came FROM GitHub, so a pull doesn't immediately trigger a redundant push.
function persistLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

const save = () => {
  state.updatedAt = Date.now();
  persistLocal();
  scheduleGithubSync();
};

/* ---------- shared helpers ---------- */

function isDone(h, key) {
  if (h.type === "check") return !!h.checks[key];
  if (h.mode === "daily-target") {
    // outside the habit's lifetime, an unlogged day has no "0" to default to — future days
    // haven't happened, and days before the habit existed were never being tracked
    if (h.logs[key] === undefined && (key > todayKey() || key < h.created)) return false;
    const logged = h.logs[key] !== undefined ? Number(h.logs[key]) : 0;
    return h.intent === "quit" ? logged <= h.dailyTarget : logged >= h.dailyTarget;
  }
  return false;
}

// true if the habit was touched at all that day (checked, or any value logged) —
// used for aggregate/engagement views where "hit the exact target" is too strict
function habitLoggedOnDay(h, key) {
  if (h.type === "check") return !!h.checks[key];
  return h.logs[key] !== undefined;
}

function inVacation(h, key) {
  return state.vacations.some((v) => v.habitIds.includes(h.id) && key >= v.start && key <= v.end);
}

// false only when the habit is pinned to specific weekdays and this day isn't one of them
function isScheduledDay(h, key) {
  if (h.scheduleMode !== "weekdays") return true;
  const dow = (new Date(key).getDay() + 6) % 7; // Mon=0
  return (h.scheduleDays || []).includes(dow);
}

// an "excused" day — doesn't count as a miss (streaks pass over it, stats exclude it) —
// but only when nothing was actually logged; a real check/log always wins
function isSkipped(h, key) {
  if (habitLoggedOnDay(h, key)) return false;
  if (h.skips && h.skips[key] === true) return true;
  if (h.skips && h.skips[key] === false) return false; // explicit "act on it anyway" override
  if (!isScheduledDay(h, key)) return true;
  return inVacation(h, key);
}

function daysBetweenExclusive(fromKey, toKey) {
  const out = [];
  let d = addDays(fromKey, 1);
  while (d < toKey) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

function streak(h) {
  let s = 0;
  const d = new Date();
  if (!isDone(h, dateKey(d)) && !isSkipped(h, dateKey(d))) d.setDate(d.getDate() - 1);
  while (true) {
    const key = dateKey(d);
    if (isDone(h, key)) { s++; d.setDate(d.getDate() - 1); continue; }
    if (isSkipped(h, key)) { d.setDate(d.getDate() - 1); continue; }
    break;
  }
  return s;
}

function longestStreak(h) {
  const keys = new Set([...Object.keys(h.checks || {}), ...Object.keys(h.logs || {})]);
  const doneKeys = Array.from(keys).filter((k) => isDone(h, k)).sort();
  if (!doneKeys.length) return 0;
  let longest = 1, cur = 1;
  for (let i = 1; i < doneKeys.length; i++) {
    const diff = Math.round((new Date(doneKeys[i]) - new Date(doneKeys[i - 1])) / 86400000);
    const gapAllSkipped = diff > 1 && daysBetweenExclusive(doneKeys[i - 1], doneKeys[i]).every((k) => isSkipped(h, k));
    cur = (diff === 1 || gapAllSkipped) ? cur + 1 : 1;
    longest = Math.max(longest, cur);
  }
  return longest;
}

function fmt(n, dp = 1) {
  if (!isFinite(n)) return "–";
  const r = Number(n.toFixed(dp));
  return r.toLocaleString("en-GB");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- edit history ---------- */

function pushEditLog(entity, field, from, to, note) {
  entity.editLog = entity.editLog || [];
  entity.editLog.push({ ts: new Date().toISOString(), field, from, to, note: note || "" });
}

function diffAndLog(entity, before, after, note) {
  Object.keys(after).forEach((k) => {
    if (HISTORY_IGNORED_FIELDS.has(k)) return;
    if (before[k] !== after[k]) pushEditLog(entity, k, before[k], after[k], note);
  });
}

function renderHistory(entityType, entity) {
  if (!entity.editLog || !entity.editLog.length) return "";
  const reversed = entity.editLog.slice().reverse();
  const items = reversed.map((e, i) => {
    const d = new Date(e.ts);
    const when = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const noteHtml = e.note ? ` — <em>${esc(e.note)}</em>` : "";
    return `<li>${when} — ${esc(String(e.field))}: ${esc(String(e.from))} → ${esc(String(e.to))}${noteHtml}
      <button class="note-btn" onclick="editHistoryNote('${entityType}','${entity.id}',${i})" title="Add/edit note">✎</button></li>`;
  }).join("");
  return `<details class="history"><summary>History (${entity.editLog.length})</summary><ul>${items}</ul></details>`;
}

function editHistoryNote(entityType, entityId, idxFromEnd) {
  const list = entityType === "funnel" ? state.funnels : entityType === "goal" ? state.goals : state.habits;
  const entity = list.find((x) => x.id === entityId);
  if (!entity) return;
  const idx = entity.editLog.length - 1 - idxFromEnd;
  const entry = entity.editLog[idx];
  if (!entry) return;
  const note = prompt("Why did you make this change? (optional)", entry.note || "");
  if (note === null) return;
  entry.note = note.trim();
  save();
  renderAll();
}

function trackFocus(e) {
  e.target.dataset.prevValue = e.target.value;
}

/* ---------- appearance settings ---------- */

const SETTINGS_KEY = "momentum-settings-v1";
const ACCENT_CHOICES = PALETTE;
const RADIUS_PX = { rounded: "12px", soft: "8px", sharp: "3px" };

function defaultSettings() {
  return { theme: "dark", accent: PALETTE[0], density: "comfortable", radius: "rounded", font: "system" };
}

function loadSettings() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { raw = null; }
  return Object.assign(defaultSettings(), raw || {});
}

let settings = loadSettings();
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

function applySettings() {
  const root = document.documentElement;
  root.setAttribute("data-theme", settings.theme);
  root.setAttribute("data-font", settings.font === "system" ? "" : settings.font);
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--accent-dim",
    settings.theme === "light" ? mixHex(settings.accent, "#ffffff", 0.85) : mixHex(settings.accent, "#0a0d12", 0.8));
  root.style.setProperty("--radius", RADIUS_PX[settings.radius] || RADIUS_PX.rounded);
  document.body.classList.toggle("density-compact", settings.density === "compact");

  document.querySelectorAll("#setting-theme button").forEach((b) => b.classList.toggle("active", b.dataset.value === settings.theme));
  document.querySelectorAll("#setting-density button").forEach((b) => b.classList.toggle("active", b.dataset.value === settings.density));
  document.querySelectorAll("#setting-radius button").forEach((b) => b.classList.toggle("active", b.dataset.value === settings.radius));
  document.querySelectorAll("#setting-font button").forEach((b) => b.classList.toggle("active", b.dataset.value === settings.font));

  const accentRow = document.getElementById("setting-accent");
  if (accentRow && !accentRow.dataset.built) {
    accentRow.innerHTML = ACCENT_CHOICES.map((c) =>
      `<span class="swatch" style="background:${c}" data-value="${c}"></span>`).join("");
    accentRow.dataset.built = "1";
    accentRow.querySelectorAll(".swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        settings.accent = sw.dataset.value;
        saveSettings();
        applySettings();
      });
    });
  }
  accentRow?.querySelectorAll(".swatch").forEach((sw) => sw.classList.toggle("selected", sw.dataset.value === settings.accent));

  const picker = document.getElementById("setting-accent-picker");
  const hexInput = document.getElementById("setting-accent-hex");
  if (picker && document.activeElement !== picker) picker.value = settings.accent;
  if (hexInput && document.activeElement !== hexInput) hexInput.value = settings.accent;
}

function isValidHex(s) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
}

function updateSetting(key, value) {
  settings[key] = value;
  saveSettings();
  applySettings();
}

document.getElementById("setting-theme").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (btn) updateSetting("theme", btn.dataset.value);
});
document.getElementById("setting-density").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (btn) updateSetting("density", btn.dataset.value);
});
document.getElementById("setting-radius").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (btn) updateSetting("radius", btn.dataset.value);
});
document.getElementById("setting-font").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (btn) updateSetting("font", btn.dataset.value);
});
document.getElementById("setting-accent-picker").addEventListener("input", (e) => updateSetting("accent", e.target.value));
document.getElementById("setting-accent-hex").addEventListener("change", (e) => {
  const v = e.target.value.trim();
  if (isValidHex(v)) {
    const full = v.length === 4 ? "#" + v.slice(1).split("").map((c) => c + c).join("") : v;
    updateSetting("accent", full.toLowerCase());
  } else {
    e.target.value = settings.accent;
  }
});

function openSettings() {
  document.getElementById("settings-panel").hidden = false;
  document.getElementById("settings-scrim").hidden = false;
  populateBackupUI();
}
function closeSettings() {
  document.getElementById("settings-panel").hidden = true;
  document.getElementById("settings-scrim").hidden = true;
}
document.getElementById("settings-btn").addEventListener("click", openSettings);
document.getElementById("settings-close-btn").addEventListener("click", closeSettings);
document.getElementById("settings-scrim").addEventListener("click", closeSettings);
document.getElementById("settings-reset-btn").addEventListener("click", () => {
  settings = defaultSettings();
  saveSettings();
  applySettings();
});

applySettings();

/* ---------- tabs ---------- */

document.querySelectorAll("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

/* ---------- progress sub-nav (calendar / stats) ---------- */

document.querySelectorAll("#progress-subnav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#progress-subnav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".progress-view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("progress-" + btn.dataset.view).classList.add("active");
  });
});

/* ---------- more menu ---------- */

document.getElementById("more-menu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("more-menu").hidden = !document.getElementById("more-menu").hidden;
});
document.getElementById("more-menu").addEventListener("click", (e) => {
  if (e.target.closest("#export-btn, #vacation-btn, #settings-btn, .import-label")) {
    document.getElementById("more-menu").hidden = true;
  }
});
document.addEventListener("click", (e) => {
  const menu = document.getElementById("more-menu");
  if (!menu.hidden && !e.target.closest("#more-menu, #more-menu-btn")) menu.hidden = true;
});

/* ---------- funnel math ---------- */

function funnelStagesCompute(f) {
  let running = f.goalValue;
  const rows = [{ label: "Goal", value: running }];
  f.stages.forEach((st) => {
    if (st.kind === "percent") running = st.value > 0 ? running / (st.value / 100) : NaN;
    else if (st.kind === "ratio") running = st.value > 0 ? running / st.value : NaN;
    else running = running * st.value; // multiply
    rows.push({ label: st.label, value: running, kind: st.kind, rateValue: st.value });
  });
  const offset = Number(f.dailyOffset) || 0;
  const rawPerDay = f.days > 0 ? running / f.days : NaN;
  const rawPerWeek = f.days > 0 ? running / (f.days / 7) : NaN;
  const rawPerMonth = f.days > 0 ? running / (f.days / 30.44) : NaN;
  const perDay = rawPerDay + offset;
  const perWeek = rawPerWeek + offset * 7;
  const perMonth = rawPerMonth + offset * 30.44;
  const cadence = f.cadence || "day";
  const cadenceValue = cadence === "day" ? perDay : cadence === "week" ? perWeek : cadence === "month" ? perMonth : running;
  const cadenceLabel = cadence === "day" ? "/day" : cadence === "week" ? "/week" : cadence === "month" ? "/month" : "total";
  const cadenceRaw = cadence === "day" ? rawPerDay : cadence === "week" ? rawPerWeek : cadence === "month" ? rawPerMonth : running;
  return { rows, finalValue: running, perDay, perWeek, perMonth, cadenceValue, cadenceLabel, cadence, offset, cadenceRaw };
}

function lastStageLabel(f) {
  if (f.dailyOffset != null) return "Calories";
  return f.stages.length ? f.stages[f.stages.length - 1].label : f.title;
}

/* ---------- auto-created linked goal & habit ---------- */

function habitHasProgress(h) {
  return Object.keys(h.checks || {}).length > 0 || Object.keys(h.logs || {}).length > 0;
}

function ensureAutoItems(f) {
  const g = state.goals.find((x) => x.linkedFunnelId === f.id);
  if (f.autoGoal && !g) {
    state.goals.push(normalizeGoal({
      id: uid(),
      title: f.title,
      target: f.goalValue,
      unit: f.unit,
      current: 0,
      deadline: addDays(todayKey(), f.days),
      linkedFunnelId: f.id,
      autoCreated: true,
    }));
  } else if (!f.autoGoal && g && g.autoCreated) {
    if ((Number(g.current) || 0) > 0) {
      const rg = resolveGoal(g);
      g.title = rg.title; g.target = rg.target; g.unit = rg.unit; g.deadline = rg.deadline;
      g.linkedFunnelId = null; g.autoCreated = false;
    } else {
      state.goals = state.goals.filter((x) => x.id !== g.id);
    }
  }

  const h = state.habits.find((x) => x.linkedFunnelId === f.id);
  if (f.autoHabit && !h) {
    const calc = funnelStagesCompute(f);
    state.habits.push(normalizeHabit({
      id: uid(),
      name: lastStageLabel(f),
      type: "scale",
      unit: actionUnit(f),
      mode: f.cadence === "day" ? "daily-target" : "weekly-total",
      dailyTarget: calc.perDay,
      weeklyTarget: calc.perWeek,
      targetPerWeek: 7,
      linkedFunnelId: f.id,
      autoCreated: true,
    }));
  } else if (!f.autoHabit && h && h.autoCreated) {
    if (habitHasProgress(h)) {
      const rh = resolveHabit(h);
      h.name = rh.name; h.unit = rh.unit; h.mode = rh.mode;
      h.dailyTarget = rh.dailyTarget; h.weeklyTarget = rh.weeklyTarget;
      h.linkedFunnelId = null; h.autoCreated = false;
    } else {
      state.habits = state.habits.filter((x) => x.id !== h.id);
    }
  }
}

function toggleAutoLink(funnelId, kind, on) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  if (kind === "goal") f.autoGoal = on;
  else f.autoHabit = on;
  ensureAutoItems(f);
  save();
  renderAll();
}

/* ---------- live-link resolution ---------- */

function resolveHabit(h) {
  if (!h.linkedFunnelId) return h;
  const f = state.funnels.find((x) => x.id === h.linkedFunnelId);
  if (!f) return h;
  const calc = funnelStagesCompute(f);
  const resolved = Object.assign({}, h, { unit: actionUnit(f) });
  if (h.autoCreated) resolved.name = lastStageLabel(f);
  if (f.cadence === "day") {
    resolved.mode = "daily-target";
    resolved.dailyTarget = calc.perDay;
    resolved.targetPerWeek = h.targetPerWeek || 7;
  } else {
    resolved.mode = "weekly-total";
    resolved.weeklyTarget = calc.perWeek;
  }
  return resolved;
}

function resolveGoal(g) {
  if (!g.linkedFunnelId) return g;
  const f = state.funnels.find((x) => x.id === g.linkedFunnelId);
  if (!f) return g;
  const resolved = Object.assign({}, g, {
    target: f.goalValue,
    unit: f.unit,
    deadline: addDays(g.created, f.days),
  });
  if (g.autoCreated) resolved.title = f.title;
  return resolved;
}

/* ---------- habits ---------- */

function updateHabitFormVisibility() {
  const type = document.getElementById("habit-type").value;
  document.getElementById("check-fields").style.display = type === "check" ? "" : "none";
  document.getElementById("scale-fields").style.display = type === "scale" ? "" : "none";
  if (type === "scale") updateScaleModeVisibility();
}

function updateScaleModeVisibility() {
  const mode = document.getElementById("habit-mode").value;
  document.getElementById("weekly-total-fields").style.display = mode === "weekly-total" ? "" : "none";
  document.getElementById("daily-target-fields").style.display = mode === "daily-target" ? "" : "none";
}

document.getElementById("habit-type").addEventListener("change", updateHabitFormVisibility);
document.getElementById("habit-mode").addEventListener("change", updateScaleModeVisibility);
updateHabitFormVisibility();

let habitFormIntent = "build";
document.getElementById("habit-intent").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  habitFormIntent = btn.dataset.value;
  document.querySelectorAll("#habit-intent button").forEach((b) => b.classList.toggle("active", b === btn));
});

document.getElementById("habit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("habit-name").value.trim();
  if (!name) return;
  const type = document.getElementById("habit-type").value;
  const habit = normalizeHabit({ id: uid(), name, type, intent: habitFormIntent });
  if (type === "check") {
    habit.targetPerWeek = Number(document.getElementById("habit-cadence-check").value);
  } else {
    habit.unit = document.getElementById("habit-unit").value.trim() || "units";
    habit.mode = document.getElementById("habit-mode").value;
    if (habit.mode === "weekly-total") {
      habit.weeklyTarget = Number(document.getElementById("habit-weekly-target").value) || 0;
    } else {
      habit.dailyTarget = Number(document.getElementById("habit-daily-target").value) || 0;
      habit.targetPerWeek = Number(document.getElementById("habit-cadence-scale").value);
    }
  }
  state.habits.push(habit);
  e.target.reset();
  updateHabitFormVisibility();
  habitFormIntent = "build";
  document.querySelectorAll("#habit-intent button").forEach((b) => b.classList.toggle("active", b.dataset.value === "build"));
  save();
  renderAll();
});

function toggleCheck(habitId, key) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  if (h.checks[key]) delete h.checks[key];
  else { h.checks[key] = true; if (h.skips) delete h.skips[key]; }
  save();
  renderAll();
}

function setScaleLog(habitId, key, rawValue) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  const v = rawValue === "" ? undefined : Number(rawValue);
  if (v === undefined || !isFinite(v)) delete h.logs[key];
  else { h.logs[key] = v; if (h.skips) delete h.skips[key]; }
  save();
  renderAll();
}

function stepScaleLog(habitId, key, delta) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  const next = Math.max(0, (Number(h.logs[key]) || 0) + delta);
  h.logs[key] = next;
  if (h.skips) delete h.skips[key];
  save();
  renderAll();
}

function toggleSkip(habitId, key) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  h.skips = h.skips || {};
  if (isSkipped(h, key)) {
    // Un-skip. If the day is only skipped because of a vacation, record an explicit
    // "not skipped" override (false) so today can be acted on without ending the vacation;
    // otherwise just drop the stored skip.
    if (inVacation(h, key) && h.skips[key] !== true) h.skips[key] = false;
    else delete h.skips[key];
  } else {
    h.skips[key] = true;
    delete h.checks[key];
    delete h.logs[key];
  }
  save();
  renderAll();
}

function deleteHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  if (!confirm(`Delete habit "${resolveHabit(h).name}" and its history?`)) return;
  if (h.autoCreated && h.linkedFunnelId) {
    const f = state.funnels.find((x) => x.id === h.linkedFunnelId);
    if (f) f.autoHabit = false;
  }
  state.habits = state.habits.filter((x) => x.id !== id);
  save();
  renderAll();
}

function toggleHabitEdit(id) {
  if (habitEditing.has(id)) habitEditing.delete(id);
  else habitEditing.add(id);
  renderHabits();
}

function toggleHabitEditModeFields(id) {
  const mode = document.getElementById(`he-mode-${id}`).value;
  document.getElementById(`he-weekly-${id}`).style.display = mode === "weekly-total" ? "" : "none";
  document.getElementById(`he-daily-${id}`).style.display = mode === "daily-target" ? "" : "none";
}

const CADENCE_OPTIONS = [7, 6, 5, 4, 3, 2, 1];
function cadenceOptionsHtml(selected) {
  return CADENCE_OPTIONS.map((n) =>
    `<option value="${n}" ${Number(selected) === n ? "selected" : ""}>${n === 7 ? "Every day" : n + "× / week"}</option>`).join("");
}

function setHabitEditIntent(id, value, btnEl) {
  document.getElementById(`he-intent-${id}`).querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btnEl));
}

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
      ${isCheck ? `<label class="field narrow"><span class="field-label">Target</span>
        <select id="he-target-${h.id}">${cadenceOptionsHtml(h.targetPerWeek)}</select>
      </label>` : `<label class="field narrow"><span class="field-label">Unit</span>
        <input type="text" id="he-unit-${h.id}" value="${esc(h.unit)}">
      </label>
      <label class="field narrow"><span class="field-label">Track as</span>
        <select id="he-mode-${h.id}" onchange="toggleHabitEditModeFields('${h.id}')">
          <option value="weekly-total" ${h.mode === "weekly-total" ? "selected" : ""}>Weekly total</option>
          <option value="daily-target" ${h.mode === "daily-target" ? "selected" : ""}>Daily target</option>
        </select>
      </label>
      <span id="he-weekly-${h.id}" class="field narrow" style="display:${h.mode === "weekly-total" ? "" : "none"}">
        <span class="field-label">Weekly target</span>
        <input type="number" id="he-weeklytarget-${h.id}" value="${h.weeklyTarget || 0}" step="any" min="0">
      </span>
      <span id="he-daily-${h.id}" class="form-row-nested" style="display:${h.mode === "daily-target" ? "" : "none"}">
        <label class="field narrow"><span class="field-label">Daily target</span>
          <input type="number" id="he-dailytarget-${h.id}" value="${h.dailyTarget || 0}" step="any" min="0">
        </label>
        <label class="field narrow"><span class="field-label">Days/week</span>
          <select id="he-cadence-${h.id}">${cadenceOptionsHtml(h.targetPerWeek)}</select>
        </label>
      </span>`}
    </div>
    <div class="habit-edit-actions">
      <button class="btn" onclick="saveHabitEdit('${h.id}')">Save</button>
      <button class="btn-link" onclick="toggleHabitEdit('${h.id}')">Cancel</button>
    </div>
  </div>`;
}

function saveHabitEdit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const before = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent };

  const name = document.getElementById(`he-name-${id}`).value.trim();
  if (name) h.name = name;

  const intentBtn = document.querySelector(`#he-intent-${id} button.active`);
  if (intentBtn) h.intent = intentBtn.dataset.value;

  if (h.type === "check") {
    h.targetPerWeek = Number(document.getElementById(`he-target-${id}`).value);
  } else {
    const unit = document.getElementById(`he-unit-${id}`).value.trim();
    if (unit) h.unit = unit;
    h.mode = document.getElementById(`he-mode-${id}`).value;
    if (h.mode === "weekly-total") {
      h.weeklyTarget = Number(document.getElementById(`he-weeklytarget-${id}`).value) || 0;
    } else {
      h.dailyTarget = Number(document.getElementById(`he-dailytarget-${id}`).value) || 0;
      h.targetPerWeek = Number(document.getElementById(`he-cadence-${id}`).value);
    }
  }

  const after = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, mode: h.mode, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget, intent: h.intent };
  diffAndLog(h, before, after, "");
  habitEditing.delete(id);
  save();
  renderAll();
}

function unlinkHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h || !h.linkedFunnelId) return;
  const f = state.funnels.find((x) => x.id === h.linkedFunnelId);
  const rh = resolveHabit(h);
  h.name = rh.name;
  h.unit = rh.unit;
  h.mode = rh.mode;
  h.dailyTarget = rh.dailyTarget;
  h.weeklyTarget = rh.weeklyTarget;
  h.linkedFunnelId = null;
  h.autoCreated = false;
  if (f) f.autoHabit = false;
  pushEditLog(h, "linkedFunnelId", "linked", "unlinked", "Unlinked from funnel");
  save();
  renderAll();
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

// how many days per week the habit is actually due — the count target itself
// for "count" mode, or the number of pinned weekdays for "weekdays" mode
function weeklyDueCount(h) {
  return h.scheduleMode === "weekdays" ? (h.scheduleDays || []).length : h.targetPerWeek;
}

function scheduleLabel(h) {
  if (h.scheduleMode === "weekdays") {
    const days = h.scheduleDays || [];
    if (days.length === 7) return "every day";
    return days.slice().sort((a, b) => a - b).map((d) => DAY_LETTERS[d]).join("·") || "no days set";
  }
  return `${h.targetPerWeek}×/wk`;
}

function habitMetaLabel(h) {
  if (h.type === "check") return `target ${scheduleLabel(h)}`;
  if (h.mode === "weekly-total") return `${fmt(h.weeklyTarget, 1)} ${esc(h.unit)}/wk`;
  return `${fmt(h.dailyTarget, 1)} ${esc(h.unit)}/day, ${scheduleLabel(h)}`;
}

function isMobileView() {
  return window.matchMedia("(max-width: 640px)").matches;
}

// Mobile habit card — a vertical layout instead of the wide 7-day table, with a compact
// week strip (7 dots) that fits the screen so there's no horizontal scrolling.
function habitCardHtml(hRaw, days, tk) {
  const h = resolveHabit(hRaw);
  const isScale = h.type === "scale";
  const isWeeklyTotal = isScale && h.mode === "weekly-total";
  const funnel = hRaw.linkedFunnelId ? state.funnels.find((x) => x.id === hRaw.linkedFunnelId) : null;
  const editable = !(funnel && hRaw.autoCreated);

  if (editable && habitEditing.has(hRaw.id)) {
    return `<div class="habit-card">${habitEditFormHtml(hRaw)}</div>`;
  }

  const quitTag = h.intent === "quit" ? `<span class="quit-tag">🚫 quitting</span>` : "";
  const dayLetters = DAY_LETTERS;
  const strip = days.map((d, i) => {
    const key = dateKey(d);
    const future = key > tk;
    const isToday = key === tk;
    const skipped = !future && isSkipped(hRaw, key);
    const doneState = isScale
      ? (h.mode === "daily-target" ? isDone(h, key) : hRaw.logs[key] !== undefined)
      : !!hRaw.checks[key];
    let cls = "wk-dot";
    let glyph = "";
    if (isToday) cls += " wk-today";
    if (future) cls += " wk-future";
    else if (doneState) { cls += " wk-done"; glyph = !isScale && h.intent === "quit" ? "🚫" : isScale ? "" : "✓"; }
    else if (skipped) { cls += " wk-skip"; glyph = "⏭"; }
    else cls += " wk-miss";
    const tap = (!future && !isScale) ? `onclick="toggleCheck('${hRaw.id}','${key}')"` : "";
    return `<div class="wk-day"><span class="${cls}" ${tap}>${glyph}</span><span class="wk-lbl${isToday ? " wk-lbl-today" : ""}">${dayLetters[i]}</span></div>`;
  }).join("");

  const skippedToday = isSkipped(hRaw, tk);
  let todayControl = "";
  if (isScale) {
    const val = hRaw.logs[tk];
    todayControl = skippedToday
      ? `<div class="hc-today"><span class="muted">Skipped today</span></div>`
      : `<div class="hc-today">
          <div class="scale-stepper">
            <button class="step-btn" onclick="stepScaleLog('${hRaw.id}','${tk}',-1)">−</button>
            <input type="number" class="scale-cell-inline" value="${val !== undefined ? val : ""}" step="any" min="0" placeholder="0" onchange="setScaleLog('${hRaw.id}','${tk}',this.value)">
            <button class="step-btn" onclick="stepScaleLog('${hRaw.id}','${tk}',1)">+</button>
          </div>
          <span class="muted">${esc(h.unit)} today</span>
        </div>`;
  }

  let weekSummary;
  if (isWeeklyTotal) {
    const sum = days.reduce((s, d) => s + (hRaw.logs[dateKey(d)] || 0), 0);
    weekSummary = `${fmt(sum, 1)}/${fmt(h.weeklyTarget, 1)} ${esc(h.unit)} this week`;
  } else {
    const cnt = days.filter((d) => isDone(h, dateKey(d))).length;
    weekSummary = `${cnt}/${weeklyDueCount(h)} this week · <span class="streak-badge">🔥 ${streak(h)}</span>`;
  }

  const skipBtn = `<button class="btn-link" onclick="toggleSkip('${hRaw.id}','${tk}')">${skippedToday ? "↺ Unskip" : "⏭ Skip today"}</button>`;

  return `<div class="habit-card">
    <div class="hc-head">
      <div><div class="hc-name">${esc(h.name)}</div><div class="habit-meta">${habitMetaLabel(h)} ${quitTag}</div></div>
      <button class="delete-btn" onclick="deleteHabit('${hRaw.id}')" title="Delete">✕</button>
    </div>
    ${todayControl}
    <div class="wk-strip">${strip}</div>
    <div class="hc-summary">${weekSummary}</div>
    <div class="hc-actions">
      ${funnel ? `<span class="linked-tag">${hRaw.autoCreated ? "⚡ auto" : "🔗 linked"}</span> <button class="btn-link" onclick="unlinkHabit('${hRaw.id}')">Unlink</button>` : ""}
      ${editable ? `<button class="btn-link" onclick="toggleHabitEdit('${hRaw.id}')">✎ Edit</button>` : ""}
      ${skipBtn}
      ${renderHistory("habit", hRaw)}
    </div>
  </div>`;
}

function renderHabits() {
  const grid = document.getElementById("habit-grid");
  const days = weekDates();
  const tk = todayKey();

  document.getElementById("week-label").textContent =
    `· week of ${days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

  if (!state.habits.length) {
    grid.innerHTML = `<p class="empty-note">No habits yet. Add the non-negotiables — training, scripting, outreach.</p>`;
    return;
  }

  if (isMobileView()) {
    grid.innerHTML = state.habits.map((hRaw) => habitCardHtml(hRaw, days, tk)).join("");
    return;
  }

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let html = `<table><thead><tr><th style="text-align:left">Habit</th>`;
  days.forEach((d, i) => {
    const isToday = dateKey(d) === tk;
    html += `<th class="${isToday ? "today-col" : ""}">${dayNames[i]}<br>${d.getDate()}</th>`;
  });
  html += `<th>Week</th><th>Streak</th><th></th></tr></thead><tbody>`;

  state.habits.forEach((hRaw) => {
    const h = resolveHabit(hRaw);
    const isScale = h.type === "scale";
    const isWeeklyTotal = isScale && h.mode === "weekly-total";

    const quitTag = h.intent === "quit" ? `<span class="quit-tag">🚫 quitting</span>` : "";
    html += `<tr><td class="habit-name">${esc(h.name)}<div class="habit-meta">${habitMetaLabel(h)} ${quitTag}</div></td>`;
    days.forEach((d) => {
      const key = dateKey(d);
      const future = key > tk;
      const skipped = !future && isSkipped(hRaw, key);
      if (isScale) {
        const val = hRaw.logs[key];
        html += `<td class="${skipped ? "skipped-cell" : ""}">${future ? '<span class="check-cell future">·</span>' :
          `<input type="number" class="scale-cell" value="${val !== undefined ? val : ""}" step="any" min="0" placeholder="${skipped ? "skip" : "0"}" onchange="setScaleLog('${hRaw.id}','${key}',this.value)">`}</td>`;
      } else {
        const done = !!hRaw.checks[key];
        const cls = `check-cell ${done ? "done" : ""} ${done && h.intent === "quit" ? "quit-habit" : ""} ${skipped ? "skipped" : ""} ${future ? "future" : ""}`;
        const glyph = done ? (h.intent === "quit" ? "🚫" : "✓") : skipped ? "⏭" : "·";
        html += `<td class="${skipped ? "skipped-cell" : ""}"><span class="${cls}"
          ${future ? "" : `onclick="toggleCheck('${hRaw.id}','${key}')"`}>${glyph}</span></td>`;
      }
    });

    if (isWeeklyTotal) {
      const sum = days.reduce((s, d) => s + (hRaw.logs[dateKey(d)] || 0), 0);
      html += `<td class="habit-meta">${fmt(sum, 1)}/${fmt(h.weeklyTarget, 1)}</td>`;
      html += `<td><span class="week-frac">${esc(h.unit)}/wk</span></td>`;
    } else {
      const cnt = days.filter((d) => isDone(h, dateKey(d))).length;
      html += `<td class="habit-meta">${cnt}/${weeklyDueCount(h)}</td>`;
      html += `<td><span class="streak-badge">🔥 ${streak(h)}</span></td>`;
    }
    html += `<td><button class="delete-btn" onclick="deleteHabit('${hRaw.id}')" title="Delete">✕</button></td></tr>`;

    const funnel = hRaw.linkedFunnelId ? state.funnels.find((x) => x.id === hRaw.linkedFunnelId) : null;
    const editable = !(funnel && hRaw.autoCreated);
    if (editable && habitEditing.has(hRaw.id)) {
      html += `<tr class="habit-extra"><td colspan="11">${habitEditFormHtml(hRaw)}</td></tr>`;
    } else {
      html += `<tr class="habit-extra"><td colspan="11"><div class="habit-extra-inner">
        ${funnel ? `<span class="linked-tag">${hRaw.autoCreated ? "⚡ auto from" : "🔗 linked to"} ${esc(funnel.title)}</span> <button class="btn-link" onclick="unlinkHabit('${hRaw.id}')">Unlink</button>` : ""}
        ${editable ? `<button class="btn-link" onclick="toggleHabitEdit('${hRaw.id}')">✎ Edit</button>` : ""}
        ${renderHistory("habit", hRaw)}
      </div></td></tr>`;
    }
  });
  html += `</tbody></table>`;
  grid.innerHTML = html;
}

// re-render the habits tab when crossing the mobile/desktop breakpoint (table <-> cards)
window.matchMedia("(max-width: 640px)").addEventListener("change", () => renderHabits());

/* ---------- goals ---------- */

document.getElementById("goal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  state.goals.push(normalizeGoal({
    id: uid(),
    title: document.getElementById("goal-title").value.trim(),
    target: Number(document.getElementById("goal-target").value),
    unit: document.getElementById("goal-unit").value.trim(),
    current: Number(document.getElementById("goal-current").value) || 0,
    deadline: document.getElementById("goal-deadline").value,
  }));
  e.target.reset();
  save();
  renderAll();
});

function goalMath(g) {
  const msDay = 86400000;
  const today = new Date(todayKey());
  const end = new Date(g.deadline);
  const daysLeft = Math.max(0, Math.ceil((end - today) / msDay));
  const remaining = Math.max(0, g.target - g.current);
  const perDay = daysLeft > 0 ? remaining / daysLeft : remaining;
  const progressPct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;

  let pace, paceClass;
  if (remaining <= 0) { pace = "Done 🎉"; paceClass = "pace-done"; }
  else if (daysLeft === 0) { pace = "Deadline passed"; paceClass = "pace-behind"; }
  else {
    const start = g.created ? new Date(g.created) : new Date(end - 90 * msDay);
    const span = Math.max(1, end - start);
    const timePct = Math.min(100, Math.max(0, ((today - start) / span) * 100));
    if (progressPct >= timePct + 5) { pace = "Ahead"; paceClass = "pace-ahead"; }
    else if (progressPct >= timePct - 5) { pace = "On track"; paceClass = "pace-ontrack"; }
    else { pace = "Behind"; paceClass = "pace-behind"; }
  }
  return { daysLeft, remaining, perDay, progressPct, pace, paceClass };
}

function sortedMilestones(g) {
  return (g.milestones || []).slice().sort((a, b) => a.value - b.value);
}

function nextMilestone(g) {
  const current = Number(g.current) || 0;
  return sortedMilestones(g).find((ms) => Number(ms.value) > current) || null;
}

function milestoneTicksHtml(g) {
  const ms = sortedMilestones(g);
  if (!ms.length || !(g.target > 0)) return "";
  const current = Number(g.current) || 0;
  return ms.map((m) => {
    const pct = Math.min(100, Math.max(0, (Number(m.value) / g.target) * 100));
    const achieved = current >= Number(m.value);
    return `<div class="milestone-tick ${achieved ? "achieved" : ""}" style="left:${pct}%" title="${esc(m.label ? `${fmt(m.value, 1)} — ${m.label}` : fmt(m.value, 1))}"></div>`;
  }).join("");
}

function milestoneChipsHtml(g) {
  const ms = sortedMilestones(g);
  if (!ms.length) return "";
  const current = Number(g.current) || 0;
  const chips = ms.map((m) => {
    const achieved = current >= Number(m.value);
    const label = m.label ? ` · ${esc(m.label)}` : "";
    return `<span class="milestone-chip ${achieved ? "achieved" : ""}">${achieved ? "✓" : "○"} ${fmt(m.value, 1)}${label}</span>`;
  }).join("");
  return `<div class="milestone-row">${chips}</div>`;
}

function milestoneRowHtml(ms) {
  return `<div class="milestone-edit-row">
    <input type="number" step="any" placeholder="Value" value="${ms.value ?? ""}" class="ms-value">
    <input type="text" placeholder="Label (optional)" value="${esc(ms.label || "")}" class="ms-label">
    <button type="button" class="delete-btn" onclick="this.closest('.milestone-edit-row').remove()" title="Remove">✕</button>
  </div>`;
}

function addMilestoneRow(goalId) {
  const container = document.getElementById(`milestone-rows-${goalId}`);
  if (!container) return;
  container.insertAdjacentHTML("beforeend", milestoneRowHtml({}));
}

function readMilestoneRows(goalId) {
  const rows = document.querySelectorAll(`#milestone-rows-${goalId} .milestone-edit-row`);
  const result = [];
  rows.forEach((row) => {
    const v = Number(row.querySelector(".ms-value").value);
    const l = row.querySelector(".ms-label").value.trim();
    if (isFinite(v)) result.push({ id: uid(), value: v, label: l });
  });
  return result.sort((a, b) => a.value - b.value);
}

function updateGoalProgress(id) {
  const g = state.goals.find((x) => x.id === id);
  const input = document.getElementById("gp-" + id);
  if (!g || !input) return;
  g.current = Number(input.value) || 0;
  save();
  renderAll();
}

function stepGoalProgress(id, delta) {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  g.current = Math.max(0, (Number(g.current) || 0) + delta);
  save();
  renderAll();
}

function deleteGoal(id) {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  if (!confirm(`Delete goal "${resolveGoal(g).title}"?`)) return;
  if (g.autoCreated && g.linkedFunnelId) {
    const f = state.funnels.find((x) => x.id === g.linkedFunnelId);
    if (f) f.autoGoal = false;
  }
  state.goals = state.goals.filter((x) => x.id !== id);
  save();
  renderAll();
}

function toggleGoalEdit(id) {
  if (goalEditing.has(id)) goalEditing.delete(id);
  else goalEditing.add(id);
  renderGoals();
}

function pickColor(id, color, el) {
  const hidden = document.getElementById(`ge-color-${id}`);
  if (hidden) hidden.value = color;
  const row = el.parentElement;
  row.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
  el.classList.add("selected");
}

function saveGoalEdit(id) {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  const note = document.getElementById(`ge-note-${id}`).value.trim();
  const before = { title: g.title, target: g.target, unit: g.unit, deadline: g.deadline, color: g.color };
  if (!(g.autoCreated && g.linkedFunnelId)) {
    const newTitle = document.getElementById(`ge-title-${id}`).value.trim();
    if (newTitle) g.title = newTitle;
  }
  if (!g.linkedFunnelId) {
    const t = Number(document.getElementById(`ge-target-${id}`).value);
    const u = document.getElementById(`ge-unit-${id}`).value.trim();
    const d = document.getElementById(`ge-deadline-${id}`).value;
    if (isFinite(t) && t > 0) g.target = t;
    if (u) g.unit = u;
    if (d) g.deadline = d;
  }
  g.color = document.getElementById(`ge-color-${id}`).value;

  const oldMilestones = g.milestones || [];
  const newMilestones = readMilestoneRows(id);
  const oldKey = JSON.stringify(oldMilestones.map((m) => `${m.value}:${m.label}`));
  const newKey = JSON.stringify(newMilestones.map((m) => `${m.value}:${m.label}`));
  if (oldKey !== newKey) {
    pushEditLog(g, "milestones", `${oldMilestones.length} checkpoint(s)`, `${newMilestones.length} checkpoint(s)`, note);
  }
  g.milestones = newMilestones;

  diffAndLog(g, before, { title: g.title, target: g.target, unit: g.unit, deadline: g.deadline, color: g.color }, note);
  goalEditing.delete(id);
  save();
  renderAll();
}

function unlinkGoal(id) {
  const g = state.goals.find((x) => x.id === id);
  if (!g || !g.linkedFunnelId) return;
  const f = state.funnels.find((x) => x.id === g.linkedFunnelId);
  const rg = resolveGoal(g);
  g.title = rg.title;
  g.target = rg.target;
  g.unit = rg.unit;
  g.deadline = rg.deadline;
  g.linkedFunnelId = null;
  g.autoCreated = false;
  if (f) f.autoGoal = false;
  pushEditLog(g, "linkedFunnelId", "linked", "unlinked", "Unlinked from funnel");
  save();
  renderAll();
}

function goalCardHtml(g) {
  const rg = resolveGoal(g);
  const m = goalMath(rg);
  const editing = goalEditing.has(g.id);
  const funnel = g.linkedFunnelId ? state.funnels.find((x) => x.id === g.linkedFunnelId) : null;
  const linkedTag = funnel
    ? `<span class="linked-tag">${g.autoCreated ? "⚡ auto from" : "🔗 linked to"} ${esc(funnel.title)}</span> <button class="btn-link" onclick="unlinkGoal('${g.id}')">Unlink</button>`
    : "";

  if (editing) {
    return `<div class="goal-card" style="border-left:4px solid ${g.color}">
      <div class="goal-edit-form">
        ${funnel && g.autoCreated
          ? `<p class="muted">Title, target, unit and deadline come from the funnel "${esc(funnel.title)}" — edit the funnel, or unlink to take manual control. You can still pick a colour here.</p>`
          : `<input type="text" id="ge-title-${g.id}" value="${esc(g.title)}" placeholder="Title">`}
        ${funnel
          ? (g.autoCreated ? "" : `<p class="muted">Target/unit/deadline come from the linked funnel — edit the funnel, or unlink to set them manually.</p>`)
          : `<input type="number" id="ge-target-${g.id}" value="${g.target}" step="any" placeholder="Target">
             <input type="text" id="ge-unit-${g.id}" value="${esc(g.unit)}" placeholder="Unit">
             <input type="date" id="ge-deadline-${g.id}" value="${g.deadline}">`}
        <div class="swatch-row" id="swatches-${g.id}">
          ${PALETTE.map((c) => `<span class="swatch ${c === g.color ? "selected" : ""}" style="background:${c}" onclick="pickColor('${g.id}','${c}',this)"></span>`).join("")}
        </div>
        <input type="hidden" id="ge-color-${g.id}" value="${g.color}">
        <label class="muted">Milestones — checkpoints along the way to the target</label>
        <div class="milestone-edit-rows" id="milestone-rows-${g.id}">
          ${(g.milestones || []).map(milestoneRowHtml).join("")}
        </div>
        <button type="button" class="btn-link" onclick="addMilestoneRow('${g.id}')">+ Add milestone</button>
        <textarea id="ge-note-${g.id}" placeholder="What changed and why? (optional)"></textarea>
        <div class="goal-actions">
          <button class="btn" onclick="saveGoalEdit('${g.id}')">Save</button>
          <button class="btn-link" onclick="toggleGoalEdit('${g.id}')">Cancel</button>
        </div>
      </div>
    </div>`;
  }

  return `<div class="goal-card" style="border-left:4px solid ${g.color}">
    <div class="goal-head">
      <h3>${esc(rg.title)}</h3>
      <span class="pace-tag ${m.paceClass}">${m.pace}</span>
      <button class="btn-link" onclick="toggleGoalEdit('${g.id}')">✎ Edit</button>
      <button class="delete-btn" onclick="deleteGoal('${g.id}')" title="Delete">✕</button>
    </div>
    ${linkedTag ? `<div class="linked-row">${linkedTag}</div>` : ""}
    <div class="progress-track"><div class="progress-fill" style="width:${m.progressPct}%;background:${g.color}"></div>${milestoneTicksHtml(rg)}</div>
    ${milestoneChipsHtml(rg)}
    <div class="goal-stats">
      <span><strong>${fmt(g.current, 0)} / ${fmt(rg.target, 0)}</strong> ${esc(rg.unit)}</span>
      <span><strong>${m.daysLeft}</strong> days left</span>
      <span><strong>${fmt(m.perDay, 1)}</strong> ${esc(rg.unit)}/day needed</span>
      <span><strong>${new Date(rg.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong> deadline</span>
    </div>
    <div class="goal-actions">
      <label class="muted">Update progress:</label>
      <button class="step-btn" onclick="stepGoalProgress('${g.id}',-1)">−</button>
      <input type="number" id="gp-${g.id}" value="${g.current}" min="0" step="any">
      <button class="step-btn" onclick="stepGoalProgress('${g.id}',1)">+</button>
      <button class="btn" onclick="updateGoalProgress('${g.id}')">Save</button>
    </div>
    ${renderHistory("goal", g)}
  </div>`;
}

function renderGoals() {
  const list = document.getElementById("goal-list");
  if (!state.goals.length) {
    list.innerHTML = `<p class="empty-note">No goals yet. Add one here, or build a funnel and it'll create the goal for you.</p>`;
    return;
  }
  list.innerHTML = state.goals.map(goalCardHtml).join("");
}

/* ---------- funnels ---------- */

const FUNNEL_TEMPLATES = {
  blank: () => ({
    title: "New funnel",
    unit: "units",
    goalValue: 100,
    days: 30,
    cadence: "day",
    stages: [{ id: uid(), label: "Stage 1", kind: "percent", value: 50 }],
  }),
  revenue: () => ({
    title: "Coaching revenue",
    unit: "£",
    actionUnit: "touches",
    goalValue: 10000,
    days: 90,
    cadence: "day",
    stages: [
      { id: uid(), label: "Clients needed", kind: "ratio", value: 500 },
      { id: uid(), label: "Good-fit calls", kind: "percent", value: 30 },
      { id: uid(), label: "Show-ups", kind: "percent", value: 60 },
      { id: uid(), label: "Bookings", kind: "percent", value: 70 },
      { id: uid(), label: "Outreach touches", kind: "percent", value: 10 },
    ],
  }),
  audience: () => ({
    title: "1,000 subscribers",
    unit: "subs",
    actionUnit: "views",
    goalValue: 1000,
    days: 90,
    cadence: "day",
    stages: [
      { id: uid(), label: "Views needed", kind: "percent", value: 2 },
    ],
  }),
};

document.getElementById("add-funnel-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = document.getElementById("template-menu");
  menu.hidden = !menu.hidden;
});

document.addEventListener("click", (e) => {
  const menu = document.getElementById("template-menu");
  if (!menu.hidden && !e.target.closest(".new-funnel-wrap")) menu.hidden = true;
});

document.querySelectorAll("#template-menu button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("template-menu").hidden = true;
    if (btn.dataset.template === "bulk") openProfileModal();
    else if (btn.dataset.template === "reading") openReadingModal();
    else createFunnelFromTemplate(btn.dataset.template);
  });
});

function finalizeNewFunnel(f) {
  state.funnels.push(f);
  ensureAutoItems(f);
  expandedFunnelId = f.id;
  save();
  renderAll();
  const card = document.getElementById(`funnel-card-${f.id}`);
  if (card) {
    card.classList.add("flash");
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    const title = card.querySelector(".funnel-title");
    if (title) { title.focus(); title.select(); }
  }
}

function createFunnelFromTemplate(key) {
  const tpl = (FUNNEL_TEMPLATES[key] || FUNNEL_TEMPLATES.blank)();
  const f = normalizeFunnel(Object.assign({ id: uid(), autoGoal: true, autoHabit: true }, tpl));
  finalizeNewFunnel(f);
}

/* ---------- profile modal (bulk funnel tailoring) ---------- */

let profileModalTargetFunnelId = null;

function updateProfileFormulaNote() {
  const bodyFatPct = document.getElementById("profile-bodyfat").value;
  const note = usesKatchMcArdle({ bodyFatPct })
    ? "Using the Katch-McArdle formula (based on lean body mass from your body fat %) — more accurate than weight/height alone."
    : "Using the Mifflin-St Jeor formula. Add a body fat % above for a more accurate estimate.";
  document.getElementById("profile-formula-note").textContent = note;
}

function openProfileModal(funnelId) {
  profileModalTargetFunnelId = funnelId || null;
  const p = state.profile;
  document.getElementById("profile-weight").value = p.weightKg ?? "";
  document.getElementById("profile-height").value = p.heightCm ?? "";
  document.getElementById("profile-age").value = p.age ?? "";
  document.getElementById("profile-sex").value = p.sex;
  document.getElementById("profile-activity").value = p.activity;
  document.getElementById("profile-bodyfat").value = p.bodyFatPct ?? "";
  updateProfileFormulaNote();

  const f = funnelId ? state.funnels.find((x) => x.id === funnelId) : null;
  document.getElementById("profile-gain").value = f ? f.goalValue : 8;
  document.getElementById("profile-days").value = f ? f.days : 122;
  document.getElementById("profile-bulk-label").textContent = f ? "This funnel" : "This bulk";
  document.getElementById("profile-submit-btn").textContent = f ? "Recalculate" : "Build funnel";

  document.getElementById("profile-modal").hidden = false;
  document.getElementById("profile-scrim").hidden = false;
}

document.getElementById("profile-bodyfat").addEventListener("input", updateProfileFormulaNote);

function closeProfileModal() {
  document.getElementById("profile-modal").hidden = true;
  document.getElementById("profile-scrim").hidden = true;
  profileModalTargetFunnelId = null;
}

document.getElementById("profile-cancel-btn").addEventListener("click", closeProfileModal);
document.getElementById("profile-scrim").addEventListener("click", closeProfileModal);

document.getElementById("profile-submit-btn").addEventListener("click", () => {
  const weightKg = Number(document.getElementById("profile-weight").value);
  const heightCm = Number(document.getElementById("profile-height").value);
  const age = Number(document.getElementById("profile-age").value);
  const sex = document.getElementById("profile-sex").value;
  const activity = document.getElementById("profile-activity").value;
  const bodyFatRaw = document.getElementById("profile-bodyfat").value;
  const bodyFatPct = bodyFatRaw === "" ? null : Number(bodyFatRaw);
  const gain = Number(document.getElementById("profile-gain").value);
  const days = Number(document.getElementById("profile-days").value);
  if (!weightKg || !heightCm || !age || !gain || !days) { alert("Fill in all fields."); return; }

  state.profile = { weightKg, heightCm, age, sex, activity, bodyFatPct };
  const tdee = calcTDEE(state.profile);

  if (profileModalTargetFunnelId) {
    const f = state.funnels.find((x) => x.id === profileModalTargetFunnelId);
    if (f) {
      const before = { dailyOffset: f.dailyOffset, goalValue: f.goalValue, days: f.days };
      f.dailyOffset = tdee;
      f.goalValue = gain;
      f.days = days;
      diffAndLog(f, before, { dailyOffset: f.dailyOffset, goalValue: f.goalValue, days: f.days }, "Recalculated from stats");
    }
    save();
    closeProfileModal();
    renderAll();
    return;
  }

  const f = normalizeFunnel(Object.assign({ id: uid(), autoGoal: true, autoHabit: true }, {
    title: `Gain ${fmt(gain, 1)}kg`,
    unit: "kg",
    actionUnit: "kcal",
    goalValue: gain,
    days,
    cadence: "day",
    dailyOffset: tdee,
    stages: [{ id: uid(), label: "Calorie surplus", kind: "multiply", value: 7700 }],
  }));
  save();
  closeProfileModal();
  finalizeNewFunnel(f);
});

/* ---------- reading modal (count → sub-unit funnel tailoring) ---------- */

function openReadingModal() {
  document.getElementById("reading-modal").hidden = false;
  document.getElementById("reading-scrim").hidden = false;
}

function closeReadingModal() {
  document.getElementById("reading-modal").hidden = true;
  document.getElementById("reading-scrim").hidden = true;
}

document.getElementById("reading-cancel-btn").addEventListener("click", closeReadingModal);
document.getElementById("reading-scrim").addEventListener("click", closeReadingModal);

document.getElementById("reading-submit-btn").addEventListener("click", () => {
  const books = Number(document.getElementById("reading-books").value);
  const pagesPerBook = Number(document.getElementById("reading-pages").value);
  const days = Number(document.getElementById("reading-days").value);
  if (!books || !pagesPerBook || !days) { alert("Fill in all fields."); return; }

  const f = normalizeFunnel(Object.assign({ id: uid(), autoGoal: true, autoHabit: true }, {
    title: `Read ${fmt(books, 0)} books`,
    unit: "books",
    actionUnit: "pages",
    goalValue: books,
    days,
    cadence: "day",
    stages: [{ id: uid(), label: "Pages", kind: "multiply", value: pagesPerBook }],
  }));
  closeReadingModal();
  finalizeNewFunnel(f);
});

/* ---------- vacation mode ---------- */

function vacationStatus(v, tk) {
  if (tk < v.start) return "upcoming";
  if (tk > v.end) return "past";
  return "active";
}

function renderVacationList() {
  const el = document.getElementById("vacation-list");
  if (!state.vacations.length) { el.innerHTML = ""; return; }
  const tk = todayKey();
  el.innerHTML = state.vacations.slice().sort((a, b) => a.start.localeCompare(b.start)).map((v) => {
    const status = vacationStatus(v, tk);
    const statusLabel = status === "active" ? "🏖 Active now" : status === "upcoming" ? "Upcoming" : "Past";
    const names = v.habitIds.map((id) => state.habits.find((h) => h.id === id)?.name).filter(Boolean);
    return `<div class="vacation-row">
      <div>
        <strong>${esc(v.label || "Vacation")}</strong>
        <div class="muted">${v.start} → ${v.end} · ${esc(names.join(", ") || "no habits")} · <span class="vacation-status vacation-status-${status}">${statusLabel}</span></div>
      </div>
      <button class="delete-btn" onclick="deleteVacation('${v.id}')" title="Delete">✕</button>
    </div>`;
  }).join("");
}

function renderVacationHabitChecklist() {
  const el = document.getElementById("vacation-habit-list");
  if (!state.habits.length) {
    el.innerHTML = `<p class="empty-note">No habits yet — add some in the Habits tab first.</p>`;
    return;
  }
  el.innerHTML = state.habits.map((h) => `
    <label class="vacation-habit-row">
      <span>${esc(h.name)}</span>
      <input type="checkbox" class="vacation-habit-check" value="${h.id}" checked>
    </label>`).join("");
}

function openVacationModal() {
  renderVacationList();
  renderVacationHabitChecklist();
  document.getElementById("vacation-start").value = todayKey();
  document.getElementById("vacation-end").value = addDays(todayKey(), 7);
  document.getElementById("vacation-label").value = "";
  document.getElementById("vacation-modal").hidden = false;
  document.getElementById("vacation-scrim").hidden = false;
}

function closeVacationModal() {
  document.getElementById("vacation-modal").hidden = true;
  document.getElementById("vacation-scrim").hidden = true;
}

document.getElementById("vacation-btn").addEventListener("click", openVacationModal);
document.getElementById("vacation-cancel-btn").addEventListener("click", closeVacationModal);
document.getElementById("vacation-scrim").addEventListener("click", closeVacationModal);

document.getElementById("vacation-submit-btn").addEventListener("click", () => {
  const start = document.getElementById("vacation-start").value;
  const end = document.getElementById("vacation-end").value;
  const label = document.getElementById("vacation-label").value.trim();
  const habitIds = Array.from(document.querySelectorAll(".vacation-habit-check:checked")).map((el) => el.value);
  if (!start || !end || start > end) { alert("Pick a valid date range (end on or after start)."); return; }
  if (!habitIds.length) { alert("Select at least one habit to skip."); return; }

  state.vacations.push(normalizeVacation({ id: uid(), label, start, end, habitIds }));
  save();
  renderAll();
  renderVacationList();
  document.getElementById("vacation-label").value = "";
});

function deleteVacation(id) {
  const v = state.vacations.find((x) => x.id === id);
  if (v) {
    const tk = todayKey();
    v.habitIds.forEach((hid) => {
      const h = state.habits.find((x) => x.id === hid);
      if (!h) return;
      h.skips = h.skips || {};
      // Freeze days already spent on vacation (before today) as excused skips, so turning
      // the vacation off doesn't retroactively turn them into misses / break streaks.
      for (let d = v.start; d < tk && d <= v.end; d = addDays(d, 1)) {
        if (!habitLoggedOnDay(h, d)) h.skips[d] = true;
      }
      // ...but today (the day you turned it off) becomes active again — clear any skip on it.
      delete h.skips[tk];
    });
  }
  state.vacations = state.vacations.filter((x) => x.id !== id);
  save();
  renderAll();
  renderVacationList();
}

/* ---------- backup: GitHub auto-sync + export reminder ----------
   backupConfig (including the token) lives in its own localStorage key —
   deliberately kept out of `state` so it never ends up in an Export file. */

const BACKUP_CONFIG_KEY = "momentum-backup-config-v1";
const BACKUP_FILE_PATH = "data-backup.json";
const EXPORT_REMINDER_DAYS = 7;
const SYNC_DEBOUNCE_MS = 8000;

function loadBackupConfig() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(BACKUP_CONFIG_KEY)); } catch { raw = null; }
  return Object.assign({ enabled: false, owner: "", repo: "", token: "", lastSync: null, lastExport: null, firstSeen: null }, raw || {});
}

let backupConfig = loadBackupConfig();
const saveBackupConfig = () => localStorage.setItem(BACKUP_CONFIG_KEY, JSON.stringify(backupConfig));

function setSyncStatus(text, isError) {
  const el = document.getElementById("backup-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("err", !!isError);
  el.classList.toggle("ok", !isError && !!text);
}

let syncDebounceTimer = null;
let syncInFlight = false;

function scheduleGithubSync() {
  if (!backupConfig.enabled || !backupConfig.token || !backupConfig.owner || !backupConfig.repo) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(syncToGithub, SYNC_DEBOUNCE_MS);
}

function backupApiUrl() {
  return `https://api.github.com/repos/${backupConfig.owner}/${backupConfig.repo}/contents/${BACKUP_FILE_PATH}`;
}
function backupHeaders() {
  return { Authorization: `Bearer ${backupConfig.token}`, Accept: "application/vnd.github+json" };
}
function encodeStateB64() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2))));
}
function decodeContentB64(b64) {
  return JSON.parse(decodeURIComponent(escape(atob(b64.replace(/\n/g, "")))));
}

// Pulls the remote backup and, if it's newer than what's local, replaces local
// state with it. This is what makes two devices actually converge instead of
// each one silently pushing its own version over the other's.
async function pullFromGithub({ silent } = {}) {
  if (!backupConfig.enabled || !backupConfig.token || !backupConfig.owner || !backupConfig.repo) return;
  try {
    const res = await fetch(backupApiUrl(), { headers: backupHeaders() });
    if (res.status === 404) return; // nothing pushed yet from anywhere
    if (!res.ok) throw new Error(`GitHub error ${res.status} pulling`);
    const remote = decodeContentB64((await res.json()).content);
    const remoteAt = remote.updatedAt || 0;
    const localAt = state.updatedAt || 0;
    if (remoteAt > localAt) {
      state = hydrate(remote);
      persistLocal();
      renderAll();
      if (!silent) setSyncStatus(`Pulled newer data from GitHub · ${new Date(remoteAt).toLocaleTimeString("en-GB")}`);
    }
  } catch (e) {
    if (!silent) setSyncStatus(`Pull failed: ${e.message}`, true);
  }
}

async function syncToGithub() {
  clearTimeout(syncDebounceTimer);
  if (!backupConfig.enabled || !backupConfig.token || !backupConfig.owner || !backupConfig.repo) return;
  if (syncInFlight) return;
  syncInFlight = true;
  setSyncStatus("Syncing…");
  try {
    const headers = backupHeaders();
    let sha;
    const getRes = await fetch(backupApiUrl(), { headers });
    if (getRes.ok) {
      sha = (await getRes.json()).sha;
    } else if (getRes.status !== 404) {
      throw new Error(`GitHub error ${getRes.status} reading file`);
    }

    const putRes = await fetch(backupApiUrl(), {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Auto-backup ${new Date().toISOString()}`, content: encodeStateB64(), sha }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub error ${putRes.status}`);
    }

    backupConfig.lastSync = Date.now();
    saveBackupConfig();
    setSyncStatus(`Synced ${new Date(backupConfig.lastSync).toLocaleTimeString("en-GB")}`);
  } catch (e) {
    setSyncStatus(`Sync failed: ${e.message}`, true);
  } finally {
    syncInFlight = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") syncToGithub();
  else pullFromGithub();
});

function updateBackupFieldsUI() {
  const fields = document.getElementById("backup-fields");
  if (backupConfig.enabled) fields.removeAttribute("data-off");
  else fields.setAttribute("data-off", "");
}

function populateBackupUI() {
  document.getElementById("backup-enabled").checked = backupConfig.enabled;
  document.getElementById("backup-owner").value = backupConfig.owner;
  document.getElementById("backup-repo").value = backupConfig.repo;
  document.getElementById("backup-token").value = backupConfig.token;
  updateBackupFieldsUI();
  if (backupConfig.lastSync) setSyncStatus(`Synced ${new Date(backupConfig.lastSync).toLocaleTimeString("en-GB")}`);
}

document.getElementById("backup-enabled").addEventListener("change", (e) => {
  backupConfig.enabled = e.target.checked;
  saveBackupConfig();
  updateBackupFieldsUI();
  if (backupConfig.enabled) scheduleGithubSync();
});
document.getElementById("backup-owner").addEventListener("change", (e) => { backupConfig.owner = e.target.value.trim(); saveBackupConfig(); });
document.getElementById("backup-repo").addEventListener("change", (e) => { backupConfig.repo = e.target.value.trim(); saveBackupConfig(); });
document.getElementById("backup-token").addEventListener("change", (e) => { backupConfig.token = e.target.value.trim(); saveBackupConfig(); });
document.getElementById("backup-sync-now-btn").addEventListener("click", () => pullFromGithub().then(syncToGithub));

/* ---- export reminder banner ---- */

function checkExportReminder() {
  if (!backupConfig.firstSeen) { backupConfig.firstSeen = Date.now(); saveBackupConfig(); }
  const baseline = backupConfig.lastExport || backupConfig.firstSeen;
  const daysSince = (Date.now() - baseline) / 86400000;
  document.getElementById("backup-banner").hidden = daysSince < EXPORT_REMINDER_DAYS;
}

document.getElementById("backup-banner-dismiss-btn").addEventListener("click", () => {
  document.getElementById("backup-banner").hidden = true;
});
document.getElementById("backup-banner-export-btn").addEventListener("click", () => {
  document.getElementById("export-btn").click();
});

function expandFunnel(id) {
  expandedFunnelId = id;
  renderFunnels();
}

function collapseFunnel() {
  expandedFunnelId = null;
  renderFunnels();
}

function deleteFunnel(id) {
  const f = state.funnels.find((x) => x.id === id);
  if (!f) return;
  const linkedGoal = state.goals.find((g) => g.linkedFunnelId === id);
  const linkedHabit = state.habits.find((h) => h.linkedFunnelId === id);
  const keepsSomething = (linkedGoal && (!linkedGoal.autoCreated || Number(linkedGoal.current) > 0)) ||
    (linkedHabit && (!linkedHabit.autoCreated || habitHasProgress(linkedHabit)));
  const msg = keepsSomething
    ? `Delete funnel "${f.title}"? Linked items with progress will be kept (frozen at current numbers); untouched auto-created ones will be removed.`
    : `Delete funnel "${f.title}"?${linkedGoal || linkedHabit ? " Its auto-created goal/habit will be removed too." : ""}`;
  if (!confirm(msg)) return;

  state.goals = state.goals.filter((g) => {
    if (g.linkedFunnelId !== id) return true;
    if (g.autoCreated && Number(g.current) === 0) return false; // remove untouched auto goal
    const rg = resolveGoal(g);
    g.title = rg.title; g.target = rg.target; g.unit = rg.unit; g.deadline = rg.deadline;
    g.linkedFunnelId = null; g.autoCreated = false;
    return true;
  });
  state.habits = state.habits.filter((h) => {
    if (h.linkedFunnelId !== id) return true;
    if (h.autoCreated && !habitHasProgress(h)) return false;
    const rh = resolveHabit(h);
    h.name = rh.name; h.unit = rh.unit; h.mode = rh.mode;
    h.dailyTarget = rh.dailyTarget; h.weeklyTarget = rh.weeklyTarget;
    h.linkedFunnelId = null; h.autoCreated = false;
    return true;
  });
  state.funnels = state.funnels.filter((x) => x.id !== id);
  if (expandedFunnelId === id) expandedFunnelId = null;
  save();
  renderAll();
}

function updateFunnelField(funnelId, field, rawValue) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  f[field] = (field === "goalValue" || field === "days" || field === "dailyOffset") ? Number(rawValue) : rawValue;
  save();
  updateFunnelCalc(funnelId);
  renderDashboard();
  renderGoals();
  renderHabits();
}

function funnelFieldBlur(funnelId, field, e) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  const prev = e.target.dataset.prevValue;
  const now = e.target.value;
  if (prev !== undefined && String(prev) !== String(now)) {
    pushEditLog(f, field, prev, now, "");
    save();
  }
  renderFunnels();
}

function setFunnelDate(funnelId, dateStr) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f || !dateStr) return;
  const days = Math.max(1, Math.ceil((new Date(dateStr) - new Date(todayKey())) / 86400000));
  if (days !== f.days) {
    pushEditLog(f, "days", f.days, days, "Set via target date");
    f.days = days;
    save();
  }
  renderAll();
}

function setFunnelCadence(funnelId, cad) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f || f.cadence === cad) return;
  pushEditLog(f, "cadence", f.cadence, cad, "");
  f.cadence = cad;
  save();
  renderAll();
}

function updateStageField(funnelId, stageId, field, value) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  const st = f.stages.find((s) => s.id === stageId);
  if (!st) return;
  const old = st[field];
  st[field] = field === "value" ? Number(value) : value;
  save();
  updateFunnelCalc(funnelId);
  renderDashboard();
  renderGoals();
  renderHabits();
  if (field === "kind" && old !== st[field]) {
    pushEditLog(f, `stage:${st.label}:kind`, old, st[field], "");
    save();
    renderFunnels();
  }
}

function stageFieldBlur(funnelId, stageId, field, e) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  const st = f.stages.find((s) => s.id === stageId);
  if (!st) return;
  const prev = e.target.dataset.prevValue;
  const now = e.target.value;
  if (prev !== undefined && String(prev) !== String(now)) {
    pushEditLog(f, `stage:${st.label}:${field}`, prev, now, "");
    save();
  }
  renderFunnels();
}

function addStage(funnelId) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  f.stages.push({ id: uid(), label: `Stage ${f.stages.length + 1}`, kind: "percent", value: 50 });
  save();
  renderAll();
}

function deleteStage(funnelId, stageId) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  f.stages = f.stages.filter((s) => s.id !== stageId);
  save();
  renderAll();
}

function moveStage(funnelId, stageId, dir) {
  const f = state.funnels.find((x) => x.id === funnelId);
  if (!f) return;
  const idx = f.stages.findIndex((s) => s.id === stageId);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= f.stages.length) return;
  [f.stages[idx], f.stages[newIdx]] = [f.stages[newIdx], f.stages[idx]];
  save();
  renderAll();
}

function stageHint(stage) {
  const v = fmt(stage.value, 2);
  if (stage.kind === "percent") return `takes ${stage.value}% of the row above — use for conversion/response rates`;
  if (stage.kind === "ratio") return `divides the row above by ${v} — use when you need N of this per 1 of the row above (e.g. clients per big deal)`;
  return `multiplies the row above by ${v} — use for a fixed per-unit amount (e.g. pages per book, kcal per kg)`;
}

function stageRowHtml(f, stage, idx, total) {
  return `<div class="stage-block">
    <div class="stage-row">
      <input type="text" class="stage-label" value="${esc(stage.label)}" placeholder="Stage name"
        onfocus="trackFocus(event)" oninput="updateStageField('${f.id}','${stage.id}','label',this.value)" onblur="stageFieldBlur('${f.id}','${stage.id}','label',event)">
      <select class="stage-kind" onchange="updateStageField('${f.id}','${stage.id}','kind',this.value)">
        <option value="percent" ${stage.kind === "percent" ? "selected" : ""}>% rate</option>
        <option value="ratio" ${stage.kind === "ratio" ? "selected" : ""}>÷ per unit</option>
        <option value="multiply" ${stage.kind === "multiply" ? "selected" : ""}>× per unit</option>
      </select>
      <input type="number" class="stage-value" value="${stage.value}" step="any"
        onfocus="trackFocus(event)" oninput="updateStageField('${f.id}','${stage.id}','value',this.value)" onblur="stageFieldBlur('${f.id}','${stage.id}','value',event)">
      <button class="icon-btn" ${idx === 0 ? "disabled" : ""} onclick="moveStage('${f.id}','${stage.id}',-1)" title="Move up">↑</button>
      <button class="icon-btn" ${idx === total - 1 ? "disabled" : ""} onclick="moveStage('${f.id}','${stage.id}',1)" title="Move down">↓</button>
      <button class="delete-btn" onclick="deleteStage('${f.id}','${stage.id}')" title="Remove stage">✕</button>
    </div>
    <div class="stage-hint">${esc(stageHint(stage))}</div>
  </div>`;
}

function funnelCalcHtml(f) {
  const calc = funnelStagesCompute(f);
  const { rows } = calc;
  let html = `<div class="funnel-stage"><div><div class="stage-label">${esc(f.title)} goal</div><div class="stage-value">${fmt(rows[0].value, 1)} ${esc(f.unit)}</div></div></div>`;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const isFinal = i === rows.length - 1;
    const rateLabel = r.kind === "percent" ? `${r.rateValue}%` : r.kind === "multiply" ? `× ${fmt(r.rateValue, 2)}` : `÷ ${fmt(r.rateValue, 2)}`;
    html += `<div class="funnel-stage ${isFinal ? "final" : ""}">
      <div><div class="stage-label">${esc(r.label)}</div><div class="stage-value">${fmt(r.value, 1)}</div></div>
      <div class="stage-rate">${rateLabel}</div>
    </div>`;
  }
  const bannerTitle = calc.cadence === "total" ? "Total needed" : "Action required";
  const alts = calc.cadence === "total" ? "" :
    `<div class="banner-alts">≈ ${fmt(calc.perDay, 1)}/day · ${fmt(calc.perWeek, 1)}/week · ${fmt(calc.perMonth, 1)}/month</div>`;
  const breakdown = calc.offset && calc.cadence !== "total"
    ? `<div class="banner-breakdown">${fmt(calc.offset, 0)} maintenance + ${fmt(calc.cadenceRaw, 0)} ${calc.cadenceLabel.replace("/", "per ")} surplus</div>`
    : "";
  html += `<div class="daily-banner"><div><strong>${bannerTitle}</strong><span class="muted"> to hit ${fmt(f.goalValue, 1)} ${esc(f.unit)} in ${f.days} days</span>${alts}${breakdown}</div><div class="big-number">${fmt(calc.cadenceValue, 0)}<span class="muted" style="font-size:15px"> ${esc(actionUnit(f))} ${calc.cadenceLabel}</span></div></div>`;
  return html;
}

function updateFunnelCalc(funnelId) {
  const f = state.funnels.find((x) => x.id === funnelId);
  const el = document.getElementById(`funnel-calc-${funnelId}`);
  if (!f || !el) return;
  el.innerHTML = funnelCalcHtml(f);
}

function funnelRowHtml(f) {
  const calc = funnelStagesCompute(f);
  const linkedBits = [];
  if (state.goals.some((g) => g.linkedFunnelId === f.id)) linkedBits.push("🎯 goal");
  if (state.habits.some((h) => h.linkedFunnelId === f.id)) linkedBits.push("✅ habit");
  return `<div class="funnel-row" onclick="expandFunnel('${f.id}')">
    <div class="f-name">
      <strong>${esc(f.title)}</strong>
      <div class="f-sub">${fmt(f.goalValue, 1)} ${esc(f.unit)} in ${f.days} days${linkedBits.length ? " · " + linkedBits.join(" · ") : ""}</div>
    </div>
    <span class="big-inline">${fmt(calc.cadenceValue, 1)}</span>
    <span class="muted">${esc(lastStageLabel(f))} ${calc.cadenceLabel}</span>
    <span class="chevron">▸</span>
  </div>`;
}

function funnelEditorHtml(f) {
  const targetDate = addDays(todayKey(), f.days);
  return `<div class="panel funnel-card" id="funnel-card-${f.id}">
    <div class="funnel-card-head">
      <input type="text" class="funnel-title" value="${esc(f.title)}"
        onfocus="trackFocus(event)" oninput="updateFunnelField('${f.id}','title',this.value)" onblur="funnelFieldBlur('${f.id}','title',event)">
      <button class="btn-link" onclick="collapseFunnel()">▾ Collapse</button>
      <button class="delete-btn" onclick="deleteFunnel('${f.id}')" title="Delete funnel">✕</button>
    </div>
    <div class="funnel-top-inputs">
      <div class="f-input"><label>Goal value</label>
        <input type="number" value="${f.goalValue}" step="any"
          onfocus="trackFocus(event)" oninput="updateFunnelField('${f.id}','goalValue',this.value)" onblur="funnelFieldBlur('${f.id}','goalValue',event)">
      </div>
      <div class="f-input"><label>Goal unit</label>
        <input type="text" value="${esc(f.unit)}"
          onfocus="trackFocus(event)" oninput="updateFunnelField('${f.id}','unit',this.value)" onblur="funnelFieldBlur('${f.id}','unit',event)">
      </div>
      <div class="f-input"><label>Action unit</label>
        <input type="text" value="${esc(f.actionUnit)}" placeholder="${esc(f.unit)}"
          onfocus="trackFocus(event)" oninput="updateFunnelField('${f.id}','actionUnit',this.value)" onblur="funnelFieldBlur('${f.id}','actionUnit',event)">
        <span class="hint">what the final stage counts, e.g. kcal, views</span>
      </div>
      <div class="f-input"><label>Days to achieve</label>
        <input type="number" value="${f.days}" step="1"
          onfocus="trackFocus(event)" oninput="updateFunnelField('${f.id}','days',this.value)" onblur="funnelFieldBlur('${f.id}','days',event)">
      </div>
      <div class="f-input"><label>…or by date</label>
        <input type="date" value="${targetDate}" onchange="setFunnelDate('${f.id}',this.value)">
      </div>
      <div class="f-input"><label>Result as</label>
        <select onchange="setFunnelCadence('${f.id}',this.value)">
          <option value="day" ${f.cadence === "day" ? "selected" : ""}>Per day</option>
          <option value="week" ${f.cadence === "week" ? "selected" : ""}>Per week</option>
          <option value="month" ${f.cadence === "month" ? "selected" : ""}>Per month</option>
          <option value="total" ${f.cadence === "total" ? "selected" : ""}>Total only</option>
        </select>
      </div>
      ${f.dailyOffset != null ? `<div class="f-input"><label>Maintenance (kcal/day)</label>
        <input type="number" value="${Math.round(f.dailyOffset)}" step="1"
          onfocus="trackFocus(event)" oninput="updateFunnelField('${f.id}','dailyOffset',this.value)" onblur="funnelFieldBlur('${f.id}','dailyOffset',event)">
        <span class="hint"><button class="btn-link" style="padding:0;font-size:12px" onclick="openProfileModal('${f.id}')">↻ Recalculate from your stats</button></span>
      </div>` : ""}
    </div>
    <h4 class="section-label">Stages (goal down to the action)</h4>
    <div class="stage-rows">${f.stages.map((st, i) => stageRowHtml(f, st, i, f.stages.length)).join("")}</div>
    <button class="btn-link" onclick="addStage('${f.id}')">+ Add stage</button>
    <div id="funnel-calc-${f.id}">${funnelCalcHtml(f)}</div>
    <div class="auto-links">
      <label><input type="checkbox" ${f.autoGoal ? "checked" : ""} onchange="toggleAutoLink('${f.id}','goal',this.checked)"> Goal</label>
      <label><input type="checkbox" ${f.autoHabit ? "checked" : ""} onchange="toggleAutoLink('${f.id}','habit',this.checked)"> Habit</label>
      <span class="muted">auto-created from this funnel and kept in sync as you edit it</span>
    </div>
    ${renderHistory("funnel", f)}
  </div>`;
}

function renderFunnels() {
  const container = document.getElementById("funnel-list");
  if (!state.funnels.length) {
    container.innerHTML = `<p class="empty-note">No funnels yet. Try the 🏋️ bulk template: "gain 8kg by December" becomes a daily calorie-surplus number, with the goal and habit created for you.</p>`;
    return;
  }
  container.innerHTML = state.funnels.map((f) =>
    f.id === expandedFunnelId ? funnelEditorHtml(f) : funnelRowHtml(f)).join("");
}

/* ---------- dashboard ---------- */

function renderDashboard() {
  const now = new Date();
  document.getElementById("today-heading").textContent =
    now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const tk = todayKey();
  const habitBox = document.getElementById("dash-habits");
  if (!state.habits.length) {
    habitBox.innerHTML = `<p class="empty-note">No habits yet — add some in the Habits tab.</p>`;
  } else {
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
  }

  const goalBox = document.getElementById("dash-goals");
  if (!state.goals.length) {
    goalBox.innerHTML = `<p class="empty-note">No goals yet — set one in the Goals tab.</p>`;
  } else {
    goalBox.innerHTML = state.goals.map((g) => {
      const rg = resolveGoal(g);
      const m = goalMath(rg);
      const next = nextMilestone(rg);
      const nextHtml = next ? ` · next checkpoint: ${fmt(next.value, 1)}${next.label ? " " + esc(next.label) : ""}` : "";
      return `<div class="dash-goal-row" style="border-left:3px solid ${g.color};padding-left:8px;">
        <span class="pace-tag ${m.paceClass}">${m.pace}</span> ${esc(rg.title)}
        <div class="sub">${fmt(m.perDay, 1)} ${esc(rg.unit)}/day for ${m.daysLeft} more days${nextHtml}</div>
      </div>`;
    }).join("");
  }

  const funnelBox = document.getElementById("dash-funnels");
  if (!state.funnels.length) {
    funnelBox.innerHTML = `<p class="empty-note">No funnels yet — build one in the Funnels tab.</p>`;
  } else {
    funnelBox.innerHTML = state.funnels.map((f) => {
      const calc = funnelStagesCompute(f);
      return `<div class="dash-funnel-row">
        <span class="name">${esc(f.title)}</span>
        <span class="big-inline">${fmt(calc.cadenceValue, 1)}</span>
        <span class="muted">${esc(lastStageLabel(f))} ${calc.cadenceLabel}</span>
      </div>`;
    }).join("");
  }
}

/* ---------- export / import ---------- */

document.getElementById("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `momentum-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  backupConfig.lastExport = Date.now();
  saveBackupConfig();
  document.getElementById("backup-banner").hidden = true;
});

document.getElementById("import-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((text) => {
    try {
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || !Array.isArray(data.habits)) throw new Error("bad shape");
      if (!confirm("Replace all current data with this backup?")) return;
      state = hydrate(data);
      save();
      renderAll();
    } catch {
      alert("That file doesn't look like a Momentum export.");
    }
    e.target.value = "";
  });
});

/* ---------- calendar ---------- */

let calendarHabitId = null;
let calendarViewYear = new Date().getFullYear();
let calendarViewMonth = new Date().getMonth();

function populateCalendarHabitSelect() {
  const sel = document.getElementById("calendar-habit-select");
  if (!state.habits.length) {
    sel.innerHTML = `<option value="">No habits yet</option>`;
    calendarHabitId = null;
    return;
  }
  const valid = calendarHabitId === "__all__" || state.habits.some((h) => h.id === calendarHabitId);
  if (!calendarHabitId || !valid) calendarHabitId = "__all__";
  const options = [`<option value="__all__" ${calendarHabitId === "__all__" ? "selected" : ""}>📊 All habits</option>`]
    .concat(state.habits.map((h) =>
      `<option value="${h.id}" ${h.id === calendarHabitId ? "selected" : ""}>${esc(resolveHabit(h).name)}</option>`));
  sel.innerHTML = options.join("");
}

document.getElementById("calendar-habit-select").addEventListener("change", (e) => {
  calendarHabitId = e.target.value;
  renderCalendar();
});
document.getElementById("cal-prev-btn").addEventListener("click", () => {
  calendarViewMonth--;
  if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear--; }
  renderCalendar();
});
document.getElementById("cal-next-btn").addEventListener("click", () => {
  calendarViewMonth++;
  if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear++; }
  renderCalendar();
});
document.getElementById("cal-today-btn").addEventListener("click", () => {
  const now = new Date();
  calendarViewYear = now.getFullYear();
  calendarViewMonth = now.getMonth();
  renderCalendar();
});

function calendarSkeleton(cellFn) {
  const firstOfMonth = new Date(calendarViewYear, calendarViewMonth, 1);
  const startDow = (firstOfMonth.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
  const tk = todayKey();

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let html = `<div class="cal-grid">`;
  dayNames.forEach((d) => { html += `<div class="cal-dow">${d}</div>`; });
  for (let i = 0; i < startDow; i++) html += `<div class="cal-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(new Date(calendarViewYear, calendarViewMonth, day));
    html += cellFn(day, key, key === tk, key > tk);
  }
  html += `</div>`;
  return html;
}

function renderSingleHabitCalendar(hRaw) {
  const h = resolveHabit(hRaw);
  const isScale = h.type === "scale";
  let doneCount = 0, pastCount = 0, loggedCount = 0, sum = 0, skippedCount = 0;

  const gridHtml = calendarSkeleton((day, key, isToday, isFuture) => {
    let cellClass = "cal-cell";
    let content = `<div class="cal-daynum">${day}</div>`;
    if (isToday) cellClass += " cal-today";

    const skipped = !isFuture && isSkipped(hRaw, key);
    if (skipped) {
      skippedCount++;
      cellClass += " cal-skipped";
      content += `<div class="cal-value">⏭</div>`;
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
    if (isFuture) cellClass += " cal-future";
    return `<div class="${cellClass}">${content}</div>`;
  });

  const skippedNote = skippedCount ? ` <span><strong>${skippedCount}</strong> skipped</span>` : "";
  const summaryHtml = isScale
    ? `<span><strong>${loggedCount}</strong> / ${pastCount} days logged</span>
       <span><strong>${fmt(sum, 1)}</strong> ${esc(h.unit)} total this month</span>
       <span><strong>${fmt(loggedCount ? sum / loggedCount : 0, 1)}</strong> ${esc(h.unit)} avg on logged days</span>${skippedNote}`
    : `<span><strong>${doneCount}</strong> / ${pastCount} done this month</span>${skippedNote}`;

  return { gridHtml, summaryHtml };
}

function renderAllHabitsCalendar() {
  const habits = state.habits;
  let pastCount = 0;
  let pctSum = 0;
  let bestDay = null;

  const gridHtml = calendarSkeleton((day, key, isToday, isFuture) => {
    let cellClass = "cal-cell all-cell";
    let content = `<div class="cal-daynum">${day}</div>`;
    if (isToday) cellClass += " cal-today";

    if (!isFuture) {
      const applicable = habits.filter((h) => (!h.created || h.created <= key) && !isSkipped(h, key));
      const doneCount = applicable.filter((h) => habitLoggedOnDay(h, key)).length;
      const total = applicable.length;
      const pct = total > 0 ? doneCount / total : 0;
      pastCount++;
      pctSum += pct;
      if (total > 0 && (!bestDay || pct > bestDay.pct)) bestDay = { key, pct, doneCount, total };
      content += `<div class="cal-value">${total ? `${doneCount}/${total}` : "–"}</div>`;
      cellClass += ` all-alpha-${Math.round(pct * 4)}`;
    } else {
      cellClass += " cal-future";
    }
    return `<div class="${cellClass}">${content}</div>`;
  });

  const avgPct = pastCount ? Math.round((pctSum / pastCount) * 100) : 0;
  const bestDayLabel = bestDay
    ? new Date(bestDay.key).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ` (${bestDay.doneCount}/${bestDay.total})`
    : "–";
  const summaryHtml = `
    <span><strong>${avgPct}%</strong> avg habits completed/day</span>
    <span><strong>${habits.length}</strong> habits tracked</span>
    <span><strong>${bestDayLabel}</strong> best day this month</span>`;

  return { gridHtml, summaryHtml };
}

function renderCalendar() {
  populateCalendarHabitSelect();
  const grid = document.getElementById("calendar-grid");
  const summaryEl = document.getElementById("calendar-summary");
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  document.getElementById("calendar-month-label").textContent = `${monthNames[calendarViewMonth]} ${calendarViewYear}`;

  if (!calendarHabitId) {
    grid.innerHTML = `<p class="empty-note">No habits yet — add one in the Habits tab.</p>`;
    summaryEl.innerHTML = "";
    return;
  }

  let result;
  if (calendarHabitId === "__all__") {
    result = renderAllHabitsCalendar();
  } else {
    const hRaw = state.habits.find((h) => h.id === calendarHabitId);
    if (!hRaw) { grid.innerHTML = ""; summaryEl.innerHTML = ""; return; }
    result = renderSingleHabitCalendar(hRaw);
  }
  grid.innerHTML = result.gridHtml;
  summaryEl.innerHTML = result.summaryHtml;
}

/* ---------- stats ---------- */

function habitStatsWindow(h, windowDays) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (windowDays - 1));
  let startKey = dateKey(start);
  if (h.created && h.created > startKey) startKey = h.created;
  const tk = todayKey();
  let totalDays = 0, doneDays = 0, loggedDays = 0, sum = 0, skippedDays = 0;
  for (let d = new Date(startKey); dateKey(d) <= tk; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    if (isSkipped(h, key)) { skippedDays++; continue; }
    totalDays++;
    if (h.type === "check") {
      if (h.checks[key]) doneDays++;
    } else if (h.logs[key] !== undefined) {
      loggedDays++;
      sum += Number(h.logs[key]) || 0;
      if (isDone(h, key)) doneDays++;
    }
  }
  return { totalDays, doneDays, loggedDays, sum, skippedDays };
}

function habitStatPct(h, w) {
  if (!w.totalDays) return null;
  const isWeeklyTotal = h.type === "scale" && h.mode === "weekly-total";
  return Math.round(((isWeeklyTotal ? w.loggedDays : w.doneDays) / w.totalDays) * 100);
}

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

function renderStats() {
  const overview = document.getElementById("stats-overview");
  const content = document.getElementById("stats-content");
  if (!state.habits.length) {
    overview.innerHTML = "";
    content.innerHTML = `<p class="empty-note">No habits yet — add some in the Habits tab to see stats here.</p>`;
    return;
  }

  const perHabit = state.habits.map((h) => {
    const w = habitStatsWindow(h, 30);
    return { h, w, pct: habitStatPct(h, w) };
  });
  const withPct = perHabit.filter((x) => x.pct !== null);
  const avgPct = withPct.length ? Math.round(withPct.reduce((s, x) => s + x.pct, 0) / withPct.length) : 0;
  const bestStreak = Math.max(0, ...state.habits.map((h) => streak(h)));
  const totalEntries = state.habits.reduce((s, h) => s + Object.keys(h.checks || {}).length + Object.keys(h.logs || {}).length, 0);

  overview.innerHTML = `
    <div class="stat-tile"><div class="num">${avgPct}%</div><div class="label">avg consistency</div></div>
    <div class="stat-tile"><div class="num">${state.habits.length}</div><div class="label">habits tracked</div></div>
    <div class="stat-tile"><div class="num">🔥 ${bestStreak}</div><div class="label">best current streak</div></div>
    <div class="stat-tile"><div class="num">${totalEntries}</div><div class="label">total entries logged</div></div>`;

  content.innerHTML = state.habits.map(habitStatCardHtml).join("");
}

/* ---------- misc ---------- */

function renderAll() {
  renderHabits();
  renderGoals();
  renderFunnels();
  renderDashboard();
  renderCalendar();
  renderStats();
}

renderAll();
checkExportReminder();
if (backupConfig.enabled) {
  // pull first so a newer copy from the other device wins; then push, which
  // catches any local-only changes that never made it up (e.g. last session
  // closed before its debounced sync fired)
  pullFromGithub().then(syncToGithub);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
