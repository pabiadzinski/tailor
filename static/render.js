import { state } from "./state.js";

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ENTITIES[c]);

let markFilter = null, markRe = null;

function highlight(text) {
  if (!state.filter || !text) return esc(text);
  if (state.filter !== markFilter) {
    markFilter = state.filter;
    markRe = new RegExp(markFilter.source, markFilter.flags + "g");
  }
  let out = "", last = 0;
  for (const m of text.matchAll(markRe)) {
    if (!m[0]) break;
    out += esc(text.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

function segsToHtml(plain, segs) {
  let html = "", at = 0;
  for (const [cls, len] of segs) {
    const text = plain.slice(at, at + len);
    at += len;
    html += cls ? `<span class="${cls}">${highlight(text)}</span>` : highlight(text);
  }
  return html;
}

const valueText = (v) => (typeof v === "string" ? v : JSON.stringify(v));

function jsonToHtml(plain, layout) {
  const obj = JSON.parse(plain);
  const msg = layout.msg ? valueText(obj[layout.msg]) : "";
  let html = highlight(msg);
  if (layout.fields.length) {
    html += (msg ? "  " : "") + '<span class="kv">' +
      layout.fields.map((k) => `<b>${esc(k)}=</b>${highlight(valueText(obj[k]))}`).join(" ") + "</span>";
  }
  return html;
}

export const prettyJson = (l) => JSON.stringify(JSON.parse(l.plain), null, 2);

// String (optionally followed by a colon, making it a key), literal or number.
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function prettyJsonToHtml(l) {
  const text = prettyJson(l);
  let html = "", last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    const [token, str, colon] = m;
    const cls = str ? (colon ? "j-key" : "j-str") : /^[tfn]/.test(token) ? "j-lit" : "j-num";
    html += highlight(text.slice(last, m.index));
    html += `<span class="${cls}">${highlight(str ?? token)}</span>` + (colon ? highlight(colon) : "");
    last = m.index + token.length;
  }
  return html + highlight(text.slice(last));
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return ts;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const today = new Date().toDateString() === d.toDateString();
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  return today ? time : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}

const LEVEL_LABEL = { error: "ERR", warn: "WARN", info: "INFO", debug: "DBG" };
const COPY_BUTTON =
  `<button class="copy" title="Copy line">` +
  `<svg class="cp" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>` +
  `<svg class="ok" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 12 5 5 9-10"/></svg>` +
  `</button>`;

export function renderLine(l) {
  const el = document.createElement("div");
  el.line = l;
  if (l.sep) {
    el.className = "row sep";
    el.innerHTML = `<span class="ts">${fmtTime(l.ts)}</span><span class="lvl"></span><span class="msg">── ${esc(l.plain)} ──</span>`;
    return el;
  }
  const source = state.sources.length > 1 ? state.sources[l.c] : null;
  el.className = "row" + (l.level === "error" ? " err" : "") + (l.json ? " json" : "");
  el.innerHTML =
    `<span class="ts" title="${esc(l.ts)}">${fmtTime(l.ts)}</span>` +
    `<span class="lvl ${l.level}">${LEVEL_LABEL[l.level] || "·"}</span>` +
    `<span class="msg">${source ? `<span class="src ${source.color}">${esc(source.label)}</span>` : ""}${l.json ? jsonToHtml(l.plain, l.json) : l.segs ? segsToHtml(l.plain, l.segs) : highlight(l.plain)}</span>` +
    (l.open ? `<pre>${prettyJsonToHtml(l)}</pre>` : "") +
    COPY_BUTTON;
  if (l.trace) linkTrace(el.querySelector(".msg"), l.trace);
  return el;
}

// Wraps the first occurrence of the trace id in the rendered text so it can be clicked.
function linkTrace(root, id) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.data.indexOf(id);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + id.length);
    const link = document.createElement("span");
    link.className = "trace";
    link.title = "Show this trace across all containers";
    range.surroundContents(link);
    return;
  }
}
