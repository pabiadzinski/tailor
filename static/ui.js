import { $, logs, state, store } from "./state.js";
import { jump, jumpToError, refilter, relayout, rerenderAll, resetBuffer, saveAnchor, schedulePaint, setLevel, showSeq } from "./list.js";
import { clearErrors, renderList } from "./containers.js";
import { connect, leaveSearch, searchHistory } from "./stream.js";

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function setFilter(v) {
  v = v.trim();
  let re = null;
  if (v) {
    const m = v.match(/^\/(.+)\/([a-z]*)$/);
    try { re = m ? new RegExp(m[1], m[2].replace(/[gy]/g, "")) : new RegExp(RegExp.escape(v), "i"); }
    catch { re = null; }
  }
  state.filter = re;
  state.hit = null;
  rerenderAll();
  refilter();
  if (!state.filterMode) jump(0);
}

function toggle(btnSel, key, def, onChange) {
  const btn = $(btnSel);
  const apply = (on) => {
    btn.classList.toggle("on", on);
    store.set(key, on ? "1" : "0");
    onChange(on);
  };
  apply(store.get(key, def) === "1");
  btn.onclick = () => apply(!btn.classList.contains("on"));
}

export function initUi() {
  applyTheme(store.get("theme", window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : ""));
  $("#theme").onclick = () => {
    const t = document.documentElement.dataset.theme === "light" ? "" : "light";
    applyTheme(t);
    store.set("theme", t);
  };

  let filterTimer = null;
  const applyFilter = () => {
    clearTimeout(filterTimer);
    filterTimer = null;
    setFilter($("#filter").value);
  };
  $("#filter").oninput = () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilter, 120);
  };
  const historySearch = () => {
    applyFilter();
    searchHistory($("#filter").value);
  };
  $("#filter").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.altKey) historySearch();
    else if (filterTimer) applyFilter();
    else jump(e.shiftKey ? -1 : 1);
  };
  $("#t-history").onclick = historySearch;
  $("#back-live").onclick = leaveSearch;
  $("#trace").onkeydown = (e) => {
    const id = e.target.value.trim();
    if (e.key === "Enter" && id) location.hash = "trace=" + encodeURIComponent(id);
  };
  $("#levels").onclick = (e) => {
    const b = e.target.closest("button");
    if (b) setLevel(b.dataset.level);
  };
  $("#t-errors").onclick = (e) => jumpToError(e.shiftKey ? 1 : -1);
  $("#marks").onclick = (e) => {
    if (e.target.dataset.seq) showSeq(Number(e.target.dataset.seq));
  };
  $("#tail").onchange = () => state.current && !state.current.trace && connect();
  $("#csearch").oninput = renderList;
  $("#clear-errors").onclick = clearErrors;
  $("#show-all").checked = store.get("showAll", "0") === "1";
  $("#show-all").onchange = (e) => { store.set("showAll", e.target.checked ? "1" : "0"); renderList(); };

  toggle("#t-ts", "ts", "1", (on) => { document.body.classList.toggle("no-ts", !on); relayout(); });
  toggle("#t-wrap", "wrap", "1", (on) => { document.body.classList.toggle("wrap", on); relayout(); });
  toggle("#t-filter", "filterMode", "0", (on) => { state.filterMode = on; refilter(); });

  $("#t-clear").onclick = resetBuffer;
  $("#t-dl").onclick = () => {
    if (!state.current) return;
    const text = state.view.map((l) => `${l.ts} ${l.plain}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const cur = state.current;
    const name = cur.trace ? `trace-${cur.trace}` : cur.project ?? cur.names.join("+");
    a.download = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  logs.addEventListener("scroll", () => {
    state.follow = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 40;
    saveAnchor();
    schedulePaint();
  });
  $("#jump").onclick = () => { state.follow = true; schedulePaint(); };

  let lastWidth = 0;
  new ResizeObserver(([e]) => {
    if (e.contentRect.width !== lastWidth) { lastWidth = e.contentRect.width; relayout(); }
    else schedulePaint();
  }).observe(logs);

  const help = $("#help");
  $("#t-help").onclick = () => help.showModal();
  help.onclick = (e) => { if (e.target === help) help.close(); };

  // Single-key shortcuts, active when not typing; they press the same buttons as the mouse would.
  const keys = {
    "?": () => help.showModal(),
    n: () => jump(1),
    N: () => jump(-1),
    e: () => jumpToError(-1),
    E: () => jumpToError(1),
    j: () => logs.scrollBy(0, 66),
    k: () => logs.scrollBy(0, -66),
    g: () => { logs.scrollTop = 0; },
    G: () => $("#jump").click(),
    f: () => $("#t-filter").click(),
    w: () => $("#t-wrap").click(),
    t: () => $("#t-ts").click(),
    0: () => setLevel(""),
    1: () => setLevel("error"),
    2: () => setLevel("warn"),
    3: () => setLevel("info"),
    4: () => setLevel("debug"),
  };
  document.addEventListener("keydown", (e) => {
    if (help.open) return;
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key === "f")) {
      e.preventDefault();
      $("#filter").focus();
      $("#filter").select();
    } else if (e.key === "Escape") {
      if (document.activeElement === $("#filter")) {
        $("#filter").value = "";
        setFilter("");
        $("#filter").blur();
      } else if (!$("#banner").hidden) {
        $("#back-live").click();
      }
    } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  });
}
