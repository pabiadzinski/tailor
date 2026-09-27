import { $, state } from "./state.js";
import { addSeparator, pushLine, replaceLines, resetBuffer } from "./list.js";
import { colorOf, findContainer, loadContainers, renderList, selectedNames, shortName } from "./containers.js";

let source = null;
let cursor = "";
let ids = new Map();
let search = null;

function showNotice(msg) {
  $("#notice").textContent = msg;
  $("#notice").hidden = !msg;
}

function showBanner(msg) {
  $("#banner span").textContent = msg;
  $("#back-live").textContent = state.current?.trace ? "Close" : "Back to live";
  $("#banner").hidden = !msg;
}

function renderHeader() {
  const cur = state.current;
  if (cur.trace) {
    $("#c-name").textContent = "Trace";
    $("#c-sub").textContent = cur.trace;
    $("#c-state").hidden = false;
    $("#c-state").className = "pill";
    $("#c-state").textContent = "trace";
    return;
  }
  const containers = state.sources.map((s) => findContainer(s.name)).filter(Boolean);
  const running = containers.filter((c) => c.state === "running").length;
  const c = containers[0];
  const many = state.sources.length > 1;
  $("#c-name").textContent = cur.project ?? (many ? `${state.sources.length} containers` : state.sources[0]?.name);
  $("#c-sub").textContent = cur.project
    ? `compose project · ${containers.length} containers · ${running} running`
    : many ? state.sources.map((s) => s.label).join(" · ")
    : c ? `${c.image} · ${c.id.slice(0, 12)} · ${c.status}` : "";
  const pill = $("#c-state");
  pill.hidden = false;
  const connecting = source?.readyState === EventSource.CONNECTING;
  const live = running > 0 && source?.readyState === EventSource.OPEN;
  pill.className = "pill" + (live ? " live" : "");
  pill.textContent = search ? "history" : connecting ? "connecting" : live ? "live" : many ? "stopped" : c?.state ?? "gone";
}

export function select(current) {
  state.current = current;
  renderList();
  if (current.trace) showTrace(current.trace);
  else connect();
}

// Nothing selected: stop streaming and show the placeholder.
export function deselect() {
  search?.abort();
  search = null;
  source?.close();
  source = null;
  state.current = null;
  setSources([]);
  resetBuffer();
  showNotice("");
  showBanner("");
  $("#c-name").textContent = "No container selected";
  $("#c-sub").textContent = "Pick a container on the left";
  $("#c-state").hidden = true;
  $("#placeholder").hidden = false;
  renderList();
}

function setSources(names) {
  state.sources = names.map((name) => ({ name, label: shortName(name), color: colorOf(name) }));
  ids = new Map(names.map((name) => [name, findContainer(name)?.id]));
  document.body.classList.toggle("merged", names.length > 1);
}

// Leaves history or trace results: back to the live stream, or to the view the trace was opened from.
export function leaveSearch() {
  if (state.current?.trace) location.hash = state.lastView;
  else connect();
}

export function connect() {
  setSources(selectedNames());
  state.follow = true;
  cursor = "";
  search?.abort();
  search = null;
  resetBuffer();
  $("#placeholder").hidden = true;
  showNotice("");
  showBanner("");
  open(false);
}

// Replaces the live stream with matches from the whole log history, until connect() is called again.
export function searchHistory(query) {
  if (!state.current || state.current.trace || !query.trim()) return;
  runSearch(query, `Searching all history for “${query}”…`, (total, shown) => {
    const more = total > shown ? `, showing the last ${shown}` : "";
    return `${total} ${total === 1 ? "match" : "matches"} in all history for “${query}”${more}`;
  });
}

function showTrace(id) {
  setSources(state.containers.map((c) => c.name).sort());
  $("#placeholder").hidden = true;
  runSearch(id, `Looking for trace ${id} in all containers…`, (total, _, lines) => {
    const containers = new Set(lines.map((l) => l.c)).size;
    return `Trace ${id}: ${total} ${total === 1 ? "line" : "lines"} in ${containers} ${containers === 1 ? "container" : "containers"}`;
  });
}

async function runSearch(query, pending, describe) {
  source?.close();
  source = null;
  search?.abort();
  const controller = (search = new AbortController());
  showNotice("");
  showBanner(pending);
  renderHeader();
  try {
    const c = encodeURIComponent(state.sources.map((s) => s.name).join(","));
    const res = await fetch(`/api/search?c=${c}&q=${encodeURIComponent(query)}`, { signal: controller.signal });
    if (!res.ok) throw new Error(await res.text());
    const { total, lines } = await res.json();
    state.follow = true;
    replaceLines(lines);
    showBanner(describe(total, lines.length, lines));
  } catch (e) {
    if (e.name === "AbortError") return;
    showBanner("");
    showNotice(e.message);
  }
}

// On network errors EventSource reconnects by itself and sends Last-Event-ID, which the server resumes from.
function open(resume) {
  source?.close();
  const q = resume && cursor ? `after=${encodeURIComponent(cursor)}` : `tail=${$("#tail").value}`;
  const c = encodeURIComponent(state.sources.map((s) => s.name).join(","));
  const src = new EventSource(`/api/logs?c=${c}&${q}`);
  source = src;

  src.onopen = renderHeader;
  src.onmessage = (e) => {
    cursor = e.lastEventId;
    pushLine(e.data);
  };
  src.onerror = () => {
    if (source !== src) return;
    if (src.readyState === EventSource.CLOSED) source = null;
    renderHeader();
  };
  const stop = () => {
    src.close();
    if (source === src) {
      source = null;
      renderHeader();
    }
  };
  src.addEventListener("end", stop);
  src.addEventListener("fail", (e) => {
    showNotice(e.data);
    stop();
  });
  renderHeader();
}

export function watchEvents() {
  const es = new EventSource("/api/events");
  let t;
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    clearTimeout(t);
    t = setTimeout(async () => {
      await loadContainers();
      if (state.current) renderHeader();
    }, 300);
    if (ev.action === "start" && ids.has(ev.name) && !search) {
      const what = state.sources.length > 1 ? shortName(ev.name) : "container";
      addSeparator(`${what} ${ids.get(ev.name) === ev.id ? "restarted" : "recreated"}`);
      ids.set(ev.name, ev.id);
      open(true);
    }
  };
}
