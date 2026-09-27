import { $, state } from "./state.js";
import { invalidate } from "./list.js";
import { prettyJson } from "./render.js";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function initRows() {
  $("#rows").addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    const l = row.line;
    if (e.target.closest(".trace")) {
      location.hash = "trace=" + encodeURIComponent(l.trace);
      return;
    }
    const btn = e.target.closest(".copy");
    if (btn) {
      copyText(l.open ? prettyJson(l) : l.plain);
      btn.classList.add("done");
      setTimeout(() => btn.classList.remove("done"), 1000);
      return;
    }
    if (!l.json || e.target.closest("pre") || !getSelection().isCollapsed) return;
    l.open = !l.open;
    if (l.open) state.follow = false;
    invalidate(l);
  });

  document.addEventListener("copy", (e) => {
    const sel = getSelection();
    if (sel.isCollapsed) return;
    const rows = [...$("#rows").children].filter((el) => sel.containsNode(el, true));
    if (rows.length < 2) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", rows.map((el) => el.line.plain).join("\n"));
  });
}
