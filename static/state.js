export const $ = (s) => document.querySelector(s);
export const logs = $("#logs");

export const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export const state = {
  containers: [],
  // Errors in the last few minutes per container name, from /api/errors.
  errors: {},
  // What is shown: { project } for all containers of a compose project, { names } for chosen containers,
  // or { trace } for the lines of one trace across all containers.
  current: null,
  // Hash of the last live view, to return to from a trace.
  lastView: "",
  // Containers of the current stream; a line's `c` indexes into it.
  sources: [],
  lines: [],
  view: [],
  hits: [],
  hit: null,
  filter: null,
  filterMode: false,
  level: "",
  follow: true,
};
