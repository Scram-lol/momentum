/* Momentum — habits, goals & flexible funnels. All data lives in localStorage. */

const STORE_KEY = "momentum-v1";
const PALETTE = ["#4f9cf9", "#3ecf8e", "#f5b83d", "#f26d6d", "#b98cf2", "#39c5cf", "#f28cc3", "#9aa5b1"];
const HISTORY_IGNORED_FIELDS = new Set(["color"]);
const goalEditing = new Set();
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
  return { habits: [], goals: [], funnels: [] };
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
    targetPerWeek: 7,
    checks: {},
    logs: {},
    linkedFunnelId: null,
    autoCreated: false,
    editLog: [],
  }, h);
}

function normalizeGoal(g) {
  return Object.assign({
    color: PALETTE[0],
    created: todayKey(),
    linkedFunnelId: null,
    autoCreated: false,
    editLog: [],
  }, g);
}

function normalizeFunnel(f) {
  return Object.assign({
    cadence: "day",
    actionUnit: "",
    autoGoal: false,
    autoHabit: false,
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
  return s;
}

function load() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { raw = null; }
  return hydrate(raw);
}

let state = load();
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

/* ---------- shared helpers ---------- */

function isDone(h, key) {
  if (h.type === "check") return !!h.checks[key];
  if (h.mode === "daily-target") return (Number(h.logs[key]) || 0) >= h.dailyTarget;
  return false;
}

function streak(h) {
  let s = 0;
  const d = new Date();
  if (!isDone(h, dateKey(d))) d.setDate(d.getDate() - 1);
  while (isDone(h, dateKey(d))) {
    s++;
    d.setDate(d.getDate() - 1);
  }
  return s;
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

function openSettings() {
  document.getElementById("settings-panel").hidden = false;
  document.getElementById("settings-scrim").hidden = false;
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
  const perDay = f.days > 0 ? running / f.days : NaN;
  const perWeek = f.days > 0 ? running / (f.days / 7) : NaN;
  const perMonth = f.days > 0 ? running / (f.days / 30.44) : NaN;
  const cadence = f.cadence || "day";
  const cadenceValue = cadence === "day" ? perDay : cadence === "week" ? perWeek : cadence === "month" ? perMonth : running;
  const cadenceLabel = cadence === "day" ? "/day" : cadence === "week" ? "/week" : cadence === "month" ? "/month" : "total";
  return { rows, finalValue: running, perDay, perWeek, perMonth, cadenceValue, cadenceLabel, cadence };
}

function lastStageLabel(f) {
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

document.getElementById("habit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("habit-name").value.trim();
  if (!name) return;
  const type = document.getElementById("habit-type").value;
  const habit = normalizeHabit({ id: uid(), name, type });
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
  save();
  renderAll();
});

function toggleCheck(habitId, key) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  if (h.checks[key]) delete h.checks[key];
  else h.checks[key] = true;
  save();
  renderAll();
}

function setScaleLog(habitId, key, rawValue) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  const v = rawValue === "" ? undefined : Number(rawValue);
  if (v === undefined || !isFinite(v)) delete h.logs[key];
  else h.logs[key] = v;
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

function editHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  if (h.autoCreated && h.linkedFunnelId) {
    alert("This habit is managed by its funnel — edit the funnel instead, or unlink it first.");
    return;
  }
  const before = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget };
  const newName = prompt("Habit name:", h.name);
  if (newName === null) return;
  if (newName.trim()) h.name = newName.trim();

  if (h.type === "check") {
    const tw = prompt("Times per week target (1-7):", h.targetPerWeek);
    if (tw !== null && Number(tw) >= 1 && Number(tw) <= 7) h.targetPerWeek = Number(tw);
  } else if (!h.linkedFunnelId) {
    const unit = prompt("Unit (e.g. pages, min):", h.unit);
    if (unit !== null && unit.trim()) h.unit = unit.trim();
    if (h.mode === "weekly-total") {
      const wt = prompt("Weekly target:", h.weeklyTarget);
      if (wt !== null && isFinite(Number(wt))) h.weeklyTarget = Number(wt);
    } else {
      const dt = prompt("Daily target:", h.dailyTarget);
      if (dt !== null && isFinite(Number(dt))) h.dailyTarget = Number(dt);
      const tw = prompt("Days per week target (1-7):", h.targetPerWeek);
      if (tw !== null && Number(tw) >= 1 && Number(tw) <= 7) h.targetPerWeek = Number(tw);
    }
  }
  const after = { name: h.name, targetPerWeek: h.targetPerWeek, unit: h.unit, weeklyTarget: h.weeklyTarget, dailyTarget: h.dailyTarget };
  diffAndLog(h, before, after, "");
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

function habitMetaLabel(h) {
  if (h.type === "check") return `target ${h.targetPerWeek}×/wk`;
  if (h.mode === "weekly-total") return `${fmt(h.weeklyTarget, 1)} ${esc(h.unit)}/wk`;
  return `${fmt(h.dailyTarget, 1)} ${esc(h.unit)}/day, ${h.targetPerWeek}×/wk`;
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

    html += `<tr><td class="habit-name">${esc(h.name)}<div class="habit-meta">${habitMetaLabel(h)}</div></td>`;
    days.forEach((d) => {
      const key = dateKey(d);
      const future = key > tk;
      if (isScale) {
        const val = hRaw.logs[key];
        html += `<td>${future ? '<span class="check-cell future">·</span>' :
          `<input type="number" class="scale-cell" value="${val !== undefined ? val : ""}" step="any" min="0" placeholder="–" onchange="setScaleLog('${hRaw.id}','${key}',this.value)">`}</td>`;
      } else {
        const done = !!hRaw.checks[key];
        html += `<td><span class="check-cell ${done ? "done" : ""} ${future ? "future" : ""}"
          ${future ? "" : `onclick="toggleCheck('${hRaw.id}','${key}')"`}>${done ? "✓" : "·"}</span></td>`;
      }
    });

    if (isWeeklyTotal) {
      const sum = days.reduce((s, d) => s + (hRaw.logs[dateKey(d)] || 0), 0);
      html += `<td class="habit-meta">${fmt(sum, 1)}/${fmt(h.weeklyTarget, 1)}</td>`;
      html += `<td><span class="week-frac">${esc(h.unit)}/wk</span></td>`;
    } else {
      const cnt = days.filter((d) => isDone(h, dateKey(d))).length;
      html += `<td class="habit-meta">${cnt}/${h.targetPerWeek}</td>`;
      html += `<td><span class="streak-badge">🔥 ${streak(h)}</span></td>`;
    }
    html += `<td><button class="delete-btn" onclick="deleteHabit('${hRaw.id}')" title="Delete">✕</button></td></tr>`;

    const funnel = hRaw.linkedFunnelId ? state.funnels.find((x) => x.id === hRaw.linkedFunnelId) : null;
    html += `<tr class="habit-extra"><td colspan="11"><div class="habit-extra-inner">
      ${funnel ? `<span class="linked-tag">${hRaw.autoCreated ? "⚡ auto from" : "🔗 linked to"} ${esc(funnel.title)}</span> <button class="btn-link" onclick="unlinkHabit('${hRaw.id}')">Unlink</button>` : ""}
      ${funnel && hRaw.autoCreated ? "" : `<button class="btn-link" onclick="editHabit('${hRaw.id}')">✎ Edit</button>`}
      ${renderHistory("habit", hRaw)}
    </div></td></tr>`;
  });
  html += `</tbody></table>`;
  grid.innerHTML = html;
}

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
    <div class="progress-track"><div class="progress-fill" style="width:${m.progressPct}%;background:${g.color}"></div></div>
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
  bulk: () => ({
    title: "Bulk to 80kg",
    unit: "kg",
    actionUnit: "kcal",
    goalValue: 8,
    days: 122,
    cadence: "day",
    stages: [
      { id: uid(), label: "Calorie surplus", kind: "multiply", value: 7700 },
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
    createFunnelFromTemplate(btn.dataset.template);
  });
});

function createFunnelFromTemplate(key) {
  const tpl = (FUNNEL_TEMPLATES[key] || FUNNEL_TEMPLATES.blank)();
  const f = normalizeFunnel(Object.assign({ id: uid(), autoGoal: true, autoHabit: true }, tpl));
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
  f[field] = (field === "goalValue" || field === "days") ? Number(rawValue) : rawValue;
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

function stageRowHtml(f, stage, idx, total) {
  return `<div class="stage-row">
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
  html += `<div class="daily-banner"><div><strong>${bannerTitle}</strong><span class="muted"> to hit ${fmt(f.goalValue, 1)} ${esc(f.unit)} in ${f.days} days</span>${alts}</div><div class="big-number">${fmt(calc.cadenceValue, 1)}<span class="muted" style="font-size:15px"> ${esc(actionUnit(f))} ${calc.cadenceLabel}</span></div></div>`;
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
      if (h.type === "check") {
        const done = !!hRaw.checks[tk];
        return `<div class="dash-habit-row">
          <span class="check-cell ${done ? "done" : ""}" onclick="toggleCheck('${hRaw.id}','${tk}')">${done ? "✓" : "·"}</span>
          <span class="name ${done ? "done" : ""}">${esc(h.name)}</span>
          <span class="streak-badge">🔥 ${streak(h)}</span>
        </div>`;
      }
      const val = hRaw.logs[tk];
      const targetNote = h.mode === "weekly-total" ? ` / ${fmt(h.weeklyTarget, 1)} this wk` : ` / ${fmt(h.dailyTarget, 1)} target`;
      return `<div class="dash-habit-row">
        <input type="number" class="scale-cell-inline" value="${val !== undefined ? val : ""}" step="any" min="0" placeholder="0"
          onchange="setScaleLog('${hRaw.id}','${tk}',this.value)">
        <span class="name">${esc(h.name)} <span class="muted">${esc(h.unit)}${targetNote}</span></span>
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
      return `<div class="dash-goal-row" style="border-left:3px solid ${g.color};padding-left:8px;">
        <span class="pace-tag ${m.paceClass}">${m.pace}</span> ${esc(rg.title)}
        <div class="sub">${fmt(m.perDay, 1)} ${esc(rg.unit)}/day for ${m.daysLeft} more days</div>
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

/* ---------- misc ---------- */

function renderAll() {
  renderHabits();
  renderGoals();
  renderFunnels();
  renderDashboard();
}

renderAll();
