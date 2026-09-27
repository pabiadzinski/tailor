import { state } from "./state.js";
import { loadContainers, loadErrors } from "./containers.js";
import { deselect, select, watchEvents } from "./stream.js";
import { initRows } from "./rows.js";
import { initUi } from "./ui.js";

initUi();
initRows();

// #name selects a container, #a,b several containers, #@name a whole compose project, #trace=id a trace.
function selectFromHash() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash.startsWith("trace=")) {
    select({ trace: hash.slice("trace=".length) });
    return;
  }
  state.lastView = location.hash;
  if (hash.startsWith("@")) {
    const project = hash.slice(1);
    if (state.containers.some((c) => c.project === project)) select({ project });
    return;
  }
  const names = hash.split(",").filter((n) => state.containers.some((c) => c.name === n)).sort();
  if (names.length) select({ names });
  else if (state.current) deselect();
}

await loadContainers();
loadErrors();
setInterval(loadErrors, 30_000);
addEventListener("hashchange", selectFromHash);
selectFromHash();
watchEvents();
