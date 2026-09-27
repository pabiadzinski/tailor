import { $, state, store } from "./state.js";
import { setLevel } from "./list.js";

export async function loadContainers() {
  try {
    const res = await fetch("/api/containers");
    state.containers = await res.json();
  } catch {
    state.containers = [];
  }
  renderList();
}

// Color class of a container: its position by name within its compose project, so it stays the same
// in the sidebar and in every view that shows the container.
export function colorOf(name) {
  const project = findContainer(name)?.project ?? "";
  const names = state.containers.filter((c) => (c.project ?? "") === project).map((c) => c.name).sort();
  return `c${Math.max(0, names.indexOf(name)) % 8}`;
}

export async function loadErrors() {
  try {
    state.errors = await (await fetch(`/api/errors?since=${store.get("errorsClearedAt", "0")}`)).json();
  } catch {
    state.errors = {};
  }
  renderList();
}

// Counts only errors from now on, until cleared again.
export function clearErrors() {
  store.set("errorsClearedAt", String(Math.floor(Date.now() / 1000)));
  state.errors = {};
  renderList();
}

export const findContainer = (name) => state.containers.find((c) => c.name === name);

// Names of the containers in the current selection, sorted.
export function selectedNames() {
  const cur = state.current;
  if (!cur || cur.trace) return [];
  if (!cur.project) return cur.names;
  return state.containers.filter((c) => c.project === cur.project).map((c) => c.name).sort();
}

// Hash for the current selection with `name` added or removed.
function toggled(name) {
  const names = new Set(selectedNames());
  if (names.has(name)) names.delete(name);
  else names.add(name);
  return [...names].sort().join(",") || name;
}

// Container name without its compose project prefix.
export function shortName(name) {
  const project = findContainer(name)?.project;
  return project && name.startsWith(project + "-") ? name.slice(project.length + 1) : name;
}

export function renderList() {
  const q = $("#csearch").value.trim().toLowerCase();
  const showAll = $("#show-all").checked;
  const visible = state.containers.filter((c) =>
    (showAll || c.state === "running" || selectedNames().includes(c.name)) &&
    (!q || [c.name, c.image, c.project ?? ""].some((s) => s.toLowerCase().includes(q)))
  );
  const running = state.containers.filter((c) => c.state === "running").length;
  $("#ccount").textContent = `${running} running`;
  $("#clear-errors").hidden = !Object.keys(state.errors).length;

  const groups = Map.groupBy(visible, (c) => c.project || "");
  const keys = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });

  const list = $("#list");
  list.innerHTML = "";
  if (!visible.length) {
    list.innerHTML = `<div class="empty-list">No containers</div>`;
    return;
  }
  for (const k of keys) {
    if (keys.length > 1 || k) {
      const h = document.createElement("div");
      h.className = "group" + (state.current?.project === k ? " active" : "");
      h.textContent = k || "standalone";
      if (k) {
        h.title = "Show all logs of this project";
        h.onclick = () => { location.hash = "@" + k; };
      }
      list.appendChild(h);
    }
    for (const c of groups.get(k)) {
      const el = document.createElement("div");
      el.className = "item" + (selectedNames().includes(c.name) ? " active" : "");
      el.innerHTML = `<span class="dot ${c.state}"></span><div class="meta"><div class="name"></div><div class="sub"></div></div>`;
      const errors = state.errors[c.name];
      if (errors) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = errors;
        badge.title = `${errors} ${errors === 1 ? "error" : "errors"} in the last 5 minutes`;
        badge.onclick = (e) => {
          e.stopPropagation();
          setLevel("error");
          location.hash = c.name;
        };
        el.appendChild(badge);
      }
      el.querySelector(".name").textContent = shortName(c.name);
      el.querySelector(".name").classList.add(colorOf(c.name));
      el.querySelector(".sub").textContent = c.image;
      el.title = `${c.name}\n${c.image}\n${c.status}\n⌘/Ctrl+click to add to the view`;
      el.onclick = (e) => { location.hash = e.metaKey || e.ctrlKey ? toggled(c.name) : c.name; };
      list.appendChild(el);
    }
  }
}
