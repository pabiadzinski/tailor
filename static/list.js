import { $, logs, state } from "./state.js";
import { renderLine } from "./render.js";

const MAX_LINES = 100000;
const PAD = 8;
const OVERSCAN = 800;

let pending = [];
let seq = 0;
let anchor = null, anchorOff = 0;
// Error line last jumped to with jumpToError.
let focused = null;
let tops = new Float64Array(1024), estH = 0;
let rendered = new Map();
let frameQueued = false;
let marksTimer = null;

export function schedulePaint() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    ingest();
    paint();
  });
}

export function pushLine(data) {
  pending.push(data);
  if (pending.length > 2 * MAX_LINES) pending = pending.slice(-MAX_LINES);
  schedulePaint();
}

function ingest() {
  if (!pending.length) return;
  const batch = pending.slice(-MAX_LINES);
  pending = [];
  for (const data of batch) append(JSON.parse(data));
  if (state.lines.length > MAX_LINES * 1.1) {
    state.lines.splice(0, state.lines.length - MAX_LINES);
    const first = state.lines[0].seq;
    state.view.splice(0, indexOfSeq(state.view, first));
    state.hits.splice(0, indexOfSeq(state.hits, first));
  }
}

function append(l) {
  l.seq = seq++;
  l.h = 0;
  state.lines.push(l);
  admit(l);
}

function admit(l) {
  if (l.sep) {
    state.view.push(l);
    return;
  }
  if (state.level && l.level !== state.level) return;
  const hit = !!state.filter?.test(l.plain);
  if (state.filterMode && state.filter && !hit) return;
  state.view.push(l);
  if (hit) state.hits.push(l);
}

export function resetBuffer() {
  state.lines = [];
  state.view = [];
  state.hits = [];
  state.hit = null;
  focused = null;
  pending = [];
  schedulePaint();
}

export function refilter() {
  state.view = [];
  state.hits = [];
  for (const l of state.lines) admit(l);
  schedulePaint();
}

export function replaceLines(lines) {
  resetBuffer();
  for (const l of lines) append(l);
}

export function addSeparator(text) {
  ingest();
  append({ ts: new Date().toISOString(), level: "", plain: text, sep: true });
  schedulePaint();
}

// First index in [0, n) for which pred is false; pred must be true then false.
function bisect(n, pred) {
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (pred(m)) lo = m + 1;
    else hi = m;
  }
  return lo;
}

const indexOfSeq = (lines, s) => bisect(lines.length, (i) => lines[i].seq < s);
const rowAt = (y) => Math.max(0, bisect(state.view.length + 1, (i) => tops[i] <= y) - 1);

function hitIndex() {
  const i = state.hit ? indexOfSeq(state.hits, state.hit.seq) : -1;
  return state.hits[i] === state.hit ? i : -1;
}

export function relayout() {
  for (const l of state.lines) l.h = 0;
  estH = 0;
  schedulePaint();
}

export function invalidate(l) {
  rendered.delete(l);
  schedulePaint();
}

export function rerenderAll() {
  rendered.clear();
  schedulePaint();
}

export function jump(dir) {
  const hits = state.hits;
  if (!hits.length) return;
  let i = hitIndex();
  if (i < 0) i = Math.min(anchor ? indexOfSeq(hits, anchor.seq) : 0, hits.length - 1);
  else i = (i + dir + hits.length) % hits.length;
  state.hit = hits[i];
  showLine(state.hit);
}

// Scrolls a line into the upper third of the view and stops following.
function showLine(l) {
  state.follow = false;
  anchor = l;
  anchorOff = -logs.clientHeight / 3;
  schedulePaint();
}

// Moves to the previous (-1) or next (+1) error line. From the live tail, -1 goes to the latest error.
export function jumpToError(dir) {
  const errors = state.view.filter((l) => l.level === "error");
  if (!errors.length) return;
  let i = errors.indexOf(focused);
  if (i >= 0) {
    i = (i + dir + errors.length) % errors.length;
  } else {
    const from = state.follow ? Infinity : anchor?.seq ?? 0;
    i = dir > 0 ? errors.findIndex((l) => l.seq >= from) : errors.findLastIndex((l) => l.seq <= from);
    if (i < 0) i = dir > 0 ? 0 : errors.length - 1;
  }
  focused = errors[i];
  showLine(focused);
}

export function showSeq(s) {
  const l = state.view[indexOfSeq(state.view, s)];
  if (l?.seq === s) showLine(l);
}

export function setLevel(level) {
  state.level = level;
  for (const b of $("#levels").children) b.classList.toggle("on", b.dataset.level === level);
  refilter();
}

// Error and warning ticks next to the scrollbar, at most one per pixel; errors win over warnings.
function drawMarks() {
  marksTimer = null;
  const track = $("#marks"), v = state.view;
  const total = layout() || 1, height = track.clientHeight - 3;
  const ticks = new Map();
  let errors = 0;
  for (let i = 0; i < v.length; i++) {
    const level = v[i].level;
    if (level !== "error" && level !== "warn") continue;
    if (level === "error") errors++;
    const px = Math.floor((tops[i] / total) * height);
    if (ticks.get(px)?.level !== "error") ticks.set(px, { level, seq: v[i].seq });
  }
  track.replaceChildren(...[...ticks].map(([px, t]) => {
    const tick = document.createElement("i");
    tick.className = t.level;
    tick.style.top = `${px}px`;
    tick.dataset.seq = t.seq;
    return tick;
  }));
  const chip = $("#t-errors");
  chip.hidden = !errors;
  setText(chip, String(errors));
  chip.title = `${errors} ${errors === 1 ? "error" : "errors"}: previous (e), Shift: next (Shift+E)`;
}

function layout() {
  const v = state.view;
  if (tops.length <= v.length) tops = new Float64Array(v.length * 2 + 1);
  let y = 0;
  for (let i = 0; i < v.length; i++) {
    tops[i] = y;
    y += v[i].h || estH;
  }
  tops[v.length] = y;
  return y;
}

function probeHeight() {
  const el = renderLine({ ts: "", level: "", plain: "x" });
  $("#rows").appendChild(el);
  const h = el.offsetHeight;
  el.remove();
  return h || 20;
}

function paint() {
  const rows = $("#rows"), spacer = $("#spacer"), v = state.view;
  if (!estH) estH = probeHeight();
  const sel = getSelection();
  const selecting = !sel.isCollapsed && rows.contains(sel.anchorNode);
  for (let pass = 0; pass < 3; pass++) {
    const total = layout();
    spacer.style.height = `${total + 4 * PAD}px`;
    if (state.follow && !selecting) logs.scrollTop = logs.scrollHeight;
    else if (anchor) logs.scrollTop = tops[indexOfSeq(v, anchor.seq)] + PAD + anchorOff;

    const start = rowAt(logs.scrollTop - PAD - OVERSCAN);
    const bottom = logs.scrollTop - PAD + logs.clientHeight + OVERSCAN;
    let end = start;
    while (end < v.length && tops[end] < bottom) end++;

    const next = new Map(), els = [];
    for (let i = start; i < end; i++) {
      const el = rendered.get(v[i]) ?? renderLine(v[i]);
      el.classList.toggle("cur", v[i] === state.hit || v[i] === focused);
      next.set(v[i], el);
      els.push(el);
    }
    for (const el of [...rows.children]) if (next.get(el.line) !== el) el.remove();
    let ref = rows.firstChild;
    for (const el of els) {
      if (el === ref) ref = ref.nextSibling;
      else rows.insertBefore(el, ref);
    }
    rows.style.transform = `translateY(${tops[start]}px)`;
    rendered = next;

    let changed = false;
    for (let i = 0; i < els.length; i++) {
      const el = els[i], l = v[start + i];
      if (l.h && el.measured) continue;
      el.measured = true;
      const h = el.offsetHeight;
      if (h !== l.h) {
        l.h = h;
        changed = true;
      }
    }
    if (!changed) break;
  }
  saveAnchor();
  updateCounter();
  marksTimer ??= setTimeout(drawMarks, 300);
  $("#jump").classList.toggle("show", !state.follow && v.length > 0);
}

export function saveAnchor() {
  const v = state.view, y = logs.scrollTop - PAD;
  const i = Math.min(rowAt(y), v.length - 1);
  anchor = v[i] ?? null;
  anchorOff = anchor ? y - tops[i] : 0;
}

function updateCounter() {
  const shown = state.view.length, total = state.lines.length;
  setText($("#counter"), total ? (shown === total ? `${total} lines` : `${shown} / ${total} lines`) : "");
  const i = hitIndex();
  setText($("#hits"), state.filter ? (i < 0 ? `${state.hits.length}` : `${i + 1}/${state.hits.length}`) : "");
}

function setText(el, s) {
  if (el.textContent !== s) el.textContent = s;
}
