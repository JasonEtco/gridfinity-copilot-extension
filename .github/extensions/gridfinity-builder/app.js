import { setupWorkflows } from "./workflows.mjs";
import { openPhotoEditor } from "./photo-editor.mjs";
import { expandedOutline } from "./inlay.mjs";
import { gridPreviewSize } from "./preview.mjs";
import { fitDrawer, layoutSizingOperations } from "./grid.mjs";
import { fillBinControls, readBinControls, syncBinControls } from "./bin-controls.mjs";
import { BIN_OPTION_DEFAULTS, getBinOptions } from "./bin-options.mjs";

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get("token");
const colors = new Set(["blue", "teal", "amber", "rose", "slate"]);
let state = null;
let selectedId = null;
let busy = false;
let connected = false;
let polling = false;
let epoch = 0;
let dragging = null;
let designDirty = false;
let binDirty = false;
let designDraftRevision = null;
let binDraftRevision = null;
let pendingConfirmation = null;
let connectionErrorVisible = false;
let viewer = null;
let viewerLoading = false;
let workflowUI = null;
let fabrication = null;
let fabricationChecked = false;
let fabricationRefreshing = false;
let liveSaveTimer = null;
let liveSavePromise = null;
let liveStatus = "";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function showError(error, connectionError = false) {
  connectionErrorVisible = connectionError || !!error?.connectionError;
  $("error-message").textContent = errorMessage(error);
  $("error-banner").hidden = false;
  $("edit-drawer-error").hidden = error?.code !== "invalid_drawer";
}

function clearError() {
  connectionErrorVisible = false;
  $("error-banner").hidden = true;
}

function setConnection(online, message) {
  connected = online;
  $("connection-status").textContent = message;
  $("connection-dot").className = `connection-dot ${online ? "online" : "offline"}`;
  $("connection-dot").title = message;
  $("connection-dot").setAttribute("aria-label", message);
  updateControls();
}

async function api(path, body, attachment = false, timeoutMs = 20000) {
  if (!token || !/^[a-f0-9]+$/i.test(token)) {
    throw new Error("This workbench is missing its access token. Reopen it from Copilot.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Gridfinity-Token": token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || `Request failed (${response.status}). Try again.`);
      error.code = payload.code;
      throw error;
    }
    return attachment ? await response.blob() : await response.json();
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      setConnection(false, "Disconnected · retrying");
      const failure = new Error("The workbench could not reach its local server. Your fields are preserved; reconnecting automatically. Check the layout before retrying an edit.");
      failure.connectionError = true;
      throw failure;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function selectedBin() {
  return state?.design.bins.find((bin) => bin.id === selectedId);
}

function footprint(bin) {
  return bin.rotation === 90 ? [bin.depth, bin.width] : [bin.width, bin.depth];
}

function firstFit(width, depth) {
  if (!state) return null;
  const { grid, bins } = state.design;
  for (let y = 0; y <= grid.rows - depth; y++) {
    for (let x = 0; x <= grid.columns - width; x++) {
      if (bins.every((bin) => {
        const [w, d] = footprint(bin);
        return x + width <= bin.x || x >= bin.x + w || y + depth <= bin.y || y >= bin.y + d;
      })) return { x, y };
    }
  }
  return null;
}

function updateControls() {
  const unsaved = designDirty || binDirty;
  const unavailable = busy || !state || !connected || unsaved;
  document.querySelectorAll("[data-requires-state]").forEach((button) => {
    button.disabled = unavailable;
  });
  document.querySelectorAll("[data-needs-selection]").forEach((button) => {
    button.disabled = unavailable || !selectedBin();
  });
  $("remove-inlay").disabled = unavailable || !selectedBin()?.inlay;
  const options = selectedBin() && getBinOptions(selectedBin());
  const photoCompatible = options && options.divisionsX === 1 && options.divisionsY === 1 && options.labelPosition === "none" &&
    options.scoopRadiusMm === 0 && selectedBin().height * 7 - 4.75 - options.floorMm >= 0.1;
  $("edit-inlay").disabled = unavailable || !selectedBin() || !photoCompatible;
  $("edit-inlay").title = photoCompatible ? "Fit an item from a photo" : "Photo recesses need one compartment, no label ledge or scoop, and room above the floor.";
  $("new-design").disabled = busy || !connected || unsaved;
  $("open-design").disabled = busy || !connected || unsaved;
  $("reset-design").disabled = busy || !state;
  $("reset-bin").disabled = busy || !selectedBin();
  $("save-design").disabled = busy || !state || !connected;
  $("clear-bins").disabled = unavailable || !state?.design.bins.length;
  const part = $("fabrication-part").value;
  const validPart = part === "bin" ? !!selectedBin() : part === "bins" ? !!state?.design.bins.length :
    part === "spacers" ? !!state?.metrics.drawer?.spacers.length : true;
  const creating = $("workflow-layout").hidden;
  $("export-stl").disabled = unavailable || creating || fabricationRefreshing || !fabrication?.stl || !validPart;
  $("open-bambu").disabled = unavailable || creating || fabricationRefreshing || !fabrication?.stl || !fabrication?.bambu || !validPart;
  $("export-stl").title = $("open-bambu").title = creating ? "Create or apply your part first, then export it from Layout." : "Exports use the saved layout, not unapplied fields.";
  $("refresh-fabrication").disabled = busy || fabricationRefreshing || !connected;
  document.querySelectorAll("#design-dialog button[type='submit']").forEach((button) => {
    button.disabled = busy || !connected || (button.id === "open-submit" && !$("saved-designs").value);
  });
  workflowUI?.syncAvailability();
}

function updateDraftStatus() {
  $("draft-status").textContent = designDirty || binDirty ? liveStatus || "Changes will save automatically." : "All changes saved.";
}

function fillDesignForm(force = false) {
  if (!state || (designDirty && !force)) return;
  $("design-name").value = state.design.name;
  $("grid-columns").value = state.design.grid.columns;
  $("grid-rows").value = state.design.grid.rows;
  const drawer = state.design.grid.drawer;
  $("layout-drawer-enabled").checked = !!drawer;
  $("layout-drawer-width").value = (drawer?.widthMm ?? state.design.grid.columns * 42 + 1) / 10;
  $("layout-drawer-depth").value = (drawer?.depthMm ?? state.design.grid.rows * 42 + 1) / 10;
  $("layout-drawer-clearance").value = drawer?.clearanceMm ?? 0.5;
  syncDrawerInputState();
}

function syncDrawerInputState(recalculate = false) {
  const automatic = $("layout-drawer-enabled").checked;
  $("layout-drawer-fields").disabled = !automatic;
  $("grid-columns").disabled = automatic;
  $("grid-rows").disabled = automatic;
  $("grid-sizing-help").textContent = automatic
    ? "Calculated from drawer dimensions. Switch off Use drawer dimensions to edit cells manually."
    : "1–32 cells per side. Resizing must keep every bin inside the grid.";
  if (automatic && recalculate) {
    try {
      const [{ drawer }] = layoutSizingOperations(designFields(), state?.design.grid.drawer);
      const grid = fitDrawer(drawer);
      $("grid-columns").value = grid.columns;
      $("grid-rows").value = grid.rows;
    } catch (error) {
      $("grid-columns").value = "";
      $("grid-rows").value = "";
      $("grid-sizing-help").textContent = error.message;
    }
  }
}

function fillBinForm(force = false) {
  const bin = selectedBin();
  $("bin-form").hidden = !bin;
  $("no-selection").hidden = !!bin;
  $("selection-count").textContent = bin ? "1 selected" : "None";
  if (!bin) return;
  if (!binDirty || force) {
    for (const key of ["label", "width", "depth", "x", "y", "height", "rotation", "color"]) {
      $(`bin-${key}`).value = bin[key];
    }
    fillBinControls("bin", bin);
  }
  const metric = state.metrics.bins.find((item) => item.id === bin.id);
  $("bin-dimensions").textContent = metric
    ? `${metric.widthMm} × ${metric.depthMm} × ${metric.heightMm} mm · current geometry`
    : "";
  $("inlay-summary").textContent = bin.inlay ? `${bin.inlay.depth} mm deep · ${bin.inlay.clearance} mm clearance per side${bin.inlay.photo ? " · photo saved" : ""}` : "This is an open bin.";
  $("edit-inlay").textContent = bin.inlay?.photo ? "Edit photo recess" : "Fit item from photo";
}

function selectBin(id, focus = false) {
  if (id !== selectedId && binDirty) {
    void flushLiveEdits().then(saved => { if (saved && !binDirty) selectBin(id, focus); });
    return;
  }
  if (id !== selectedId) {
    selectedId = id;
    binDirty = false;
  }
  document.querySelectorAll("[data-bin-id]").forEach((element) => {
    const selected = element.dataset.binId === selectedId;
    element.classList.toggle("selected", selected);
    element.setAttribute("aria-pressed", String(selected));
  });
  fillBinForm();
  updateDraftStatus();
  updateControls();
  viewer?.update(state.design, selectedId);
  if (focus) {
    [...$("board").children].find((node) => node.dataset.binId === id)?.focus({ preventScroll: true });
  }
}

function renderBoard() {
  const { grid, bins } = state.design;
  const focused = document.activeElement?.classList.contains("bin") ? document.activeElement.dataset.binId : null;
  $("board-frame").style.setProperty("--columns", grid.columns);
  $("board-frame").style.setProperty("--rows", grid.rows);
  for (const [axis, count] of [["x", grid.columns], ["y", grid.rows]]) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const tick = document.createElement("span");
      tick.textContent = i;
      fragment.append(tick);
    }
    $(`ruler-${axis}`).replaceChildren(fragment);
  }
  const board = document.createDocumentFragment();
  const inventory = document.createDocumentFragment();
  for (const bin of bins) {
    const [width, depth] = footprint(bin);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `bin${bin.id === selectedId ? " selected" : ""}${grid.columns > 14 ? " compact" : ""}`;
    button.dataset.binId = bin.id;
    button.style.setProperty("--bin-color", `var(--${colors.has(bin.color) ? bin.color : "blue"})`);
    button.style.left = `calc(${bin.x / grid.columns * 100}% + 3px)`;
    button.style.top = `calc(${bin.y / grid.rows * 100}% + 3px)`;
    button.style.width = `calc(${width / grid.columns * 100}% - 6px)`;
    button.style.height = `calc(${depth / grid.rows * 100}% - 6px)`;
    button.setAttribute("aria-pressed", String(bin.id === selectedId));
    button.setAttribute("aria-label", `${bin.label || "Unlabeled bin"}, ${width} by ${depth} cells, ${bin.height} U tall, column ${bin.x}, row ${bin.y}. Arrow keys move; R rotates; D duplicates; Delete removes.`);
    button.title = `${bin.label} · ${width} × ${depth} cells · ${bin.height}U`;
    const label = document.createElement("span");
    label.className = "bin-label";
    label.textContent = bin.label || "Bin";
    const size = document.createElement("span");
    size.className = "bin-size";
    size.textContent = `${width} × ${depth} · ${bin.height}U`;
    button.append(label, size);
    if (bin.inlay) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const outerWidth = bin.width * 42 - 0.5, outerDepth = bin.depth * 42 - 0.5;
      svg.setAttribute("viewBox", `0 0 ${bin.rotation === 90 ? outerDepth : outerWidth} ${bin.rotation === 90 ? outerWidth : outerDepth}`);
      svg.setAttribute("class", "bin-inlay");
      svg.setAttribute("aria-hidden", "true");
      polygon.setAttribute("points", expandedOutline(bin.inlay).map(([x, y]) => bin.rotation === 90 ? `${outerDepth - y},${x}` : `${x},${y}`).join(" "));
      svg.append(polygon);
      button.prepend(svg);
    }
    button.addEventListener("click", () => selectBin(bin.id));
    button.addEventListener("keydown", binKeydown);
    button.addEventListener("pointerdown", beginDrag);
    board.append(button);

    const item = document.createElement("button");
    item.type = "button";
    item.dataset.binId = bin.id;
    item.setAttribute("aria-pressed", String(bin.id === selectedId));
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.setProperty("--bin-color", `var(--${colors.has(bin.color) ? bin.color : "blue"})`);
    swatch.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "inventory-label";
    name.textContent = bin.label || "Unlabeled bin";
    const dimensions = document.createElement("span");
    dimensions.className = "quiet";
    dimensions.textContent = `${width}×${depth}`;
    item.append(swatch, name, dimensions);
    item.addEventListener("click", () => selectBin(bin.id, true));
    inventory.append(item);
  }
  $("board").replaceChildren(board);
  $("bin-list").replaceChildren(inventory);
  if (focused) [...$("board").children].find((node) => node.dataset.binId === focused)?.focus({ preventScroll: true });
  $("bin-count").textContent = bins.length;
  $("empty-hint").hidden = !!bins.length;
  fitGridPreview();
}

function fitGridPreview() {
  if (!state || $("layout-preview").clientWidth <= 35) return;
  const size = gridPreviewSize({
    columns: state.design.grid.columns, rows: state.design.grid.rows,
    availableWidth: $("layout-preview").clientWidth, viewportHeight: window.innerHeight,
    zoom: Number($("grid-zoom").value) / 100,
  });
  const width = `${size.width}px`;
  $("board-frame").dataset.compact = String(size.cell < 40);
  if ($("board-frame").style.width !== width) $("board-frame").style.width = width;
}

function applyState(next) {
  const identityChanged = state && state.design.designId !== next.design.designId;
  const changed = !state || identityChanged || state.design.revision !== next.design.revision;
  if (identityChanged) {
    selectedId = null;
    designDirty = false;
    binDirty = false;
  }
  state = next;
  if (connectionErrorVisible) clearError();
  setConnection(true, "Connected");
  if (!selectedBin()) {
    if (binDirty && selectedId) showError("The selected bin was removed in another view. Its unsaved fields could not be saved.");
    selectedId = null;
    binDirty = false;
  }
  if (changed) {
    $("layout-heading").textContent = state.design.name;
    $("revision-label").textContent = `rev ${state.design.revision}`;
    $("physical-size").textContent = `${state.metrics.widthMm} × ${state.metrics.depthMm}`;
    $("cell-size").textContent = `${state.design.grid.columns} × ${state.design.grid.rows}`;
    $("drawer-summary").hidden = !state.metrics.drawer;
    if (state.metrics.drawer) {
      const drawer = state.metrics.drawer;
      $("drawer-summary").textContent = `Drawer ${drawer.widthMm} × ${drawer.depthMm} mm. Excess: L ${drawer.gaps.left}, R ${drawer.gaps.right}, front ${drawer.gaps.front}, back ${drawer.gaps.back} mm. ${drawer.marginMode === "integrated" ? "Integrated solid border" : `${drawer.spacers.length} spacer parts`}. Alignment and excess controls are in New grid.`;
    }
    $("layout-summary").textContent = `${state.design.bins.length} bins · ${state.metrics.freeCells} / ${state.metrics.totalCells} cells free · ${state.metrics.occupancyPercent}% filled`;
    $("occupancy-fill").style.width = `${Math.max(0, Math.min(100, state.metrics.occupancyPercent))}%`;
    $("save-status").textContent = `Saved · rev ${state.design.revision}`;
    renderBoard();
    fillDesignForm();
    fillBinForm();
    viewer?.update(state.design, selectedId);
  }
  updateControls();
  updateDraftStatus();
  workflowUI?.update();
  if (!fabricationChecked) { fabricationChecked = true; void refreshFabrication(); }
}

async function runAction(action) {
  if (busy) return false;
  busy = true;
  epoch++;
  updateControls();
  clearError();
  try {
    await action();
    return true;
  } catch (error) {
    showError(error);
    if ($("design-dialog").open) $("dialog-error").textContent = errorMessage(error);
    return false;
  } finally {
    busy = false;
    updateControls();
  }
}

async function edit(operations, onSuccess, expectedRevision = state?.design.revision) {
  if (!state || !connected) return false;
  return runAction(async () => {
    const next = await api("/api/edit", { expectedRevision, operations });
    onSuccess?.();
    applyState(next);
  });
}

async function poll() {
  if (polling || busy || dragging) return;
  polling = true;
  const startedAt = epoch;
  try {
    const next = await api("/api/state");
    if (epoch === startedAt && !busy && !dragging) applyState(next);
  } catch (error) {
    if (epoch === startedAt) {
      setConnection(false, "Disconnected · retrying");
      showError(error, true);
    }
  } finally {
    polling = false;
  }
}

function formNumber(id) {
  return Number($(id).value);
}

function confirmAction(title, message, acceptLabel) {
  if (pendingConfirmation) return Promise.resolve(false);
  $("confirm-heading").textContent = title;
  $("confirm-message").textContent = message;
  $("confirm-accept").textContent = acceptLabel;
  $("confirm-dialog").showModal();
  $("confirm-cancel").focus();
  return new Promise((resolve) => { pendingConfirmation = resolve; });
}

function finishConfirmation(accepted) {
  $("confirm-dialog").close();
  pendingConfirmation?.(accepted);
  pendingConfirmation = null;
}

function beginDrag(event) {
  if (event.button !== 0 || busy || !connected || dragging || designDirty || binDirty) return;
  const button = event.currentTarget;
  selectBin(button.dataset.binId);
  if (selectedId !== button.dataset.binId) return;
  const bin = selectedBin();
  const [width, depth] = footprint(bin);
  const rect = $("board").getBoundingClientRect();
  dragging = { button, id: bin.id, pointerId: event.pointerId, x: bin.x, y: bin.y, startX: event.clientX, startY: event.clientY, nextX: bin.x, nextY: bin.y, cellWidth: rect.width / state.design.grid.columns, cellDepth: rect.height / state.design.grid.rows, width, depth };
  button.setPointerCapture(event.pointerId);
  button.addEventListener("pointermove", moveDrag);
  button.addEventListener("pointerup", endDrag);
  button.addEventListener("pointercancel", cancelDrag);
  button.addEventListener("lostpointercapture", cancelDrag);
}

function moveDrag(event) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const drag = dragging;
  drag.nextX = Math.max(0, Math.min(state.design.grid.columns - drag.width, drag.x + Math.round((event.clientX - drag.startX) / drag.cellWidth)));
  drag.nextY = Math.max(0, Math.min(state.design.grid.rows - drag.depth, drag.y + Math.round((event.clientY - drag.startY) / drag.cellDepth)));
  drag.button.classList.add("dragging");
  drag.button.style.transform = `translate(${(drag.nextX - drag.x) * drag.cellWidth}px, ${(drag.nextY - drag.y) * drag.cellDepth}px)`;
}

function resetDrag() {
  const drag = dragging;
  if (!drag) return;
  dragging = null;
  drag.button.classList.remove("dragging");
  drag.button.style.transform = "";
  drag.button.removeEventListener("pointermove", moveDrag);
  drag.button.removeEventListener("pointerup", endDrag);
  drag.button.removeEventListener("pointercancel", cancelDrag);
  drag.button.removeEventListener("lostpointercapture", cancelDrag);
  if (drag.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId);
  return drag;
}

function endDrag(event) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const drag = resetDrag();
  if (drag.x !== drag.nextX || drag.y !== drag.nextY) {
    void edit([{ type: "update_bin", id: drag.id, changes: { x: drag.nextX, y: drag.nextY } }]);
  }
}

function cancelDrag() {
  resetDrag();
}

function rotateBin() {
  const bin = selectedBin();
  if (bin) return edit([{ type: "update_bin", id: bin.id, changes: { rotation: bin.rotation === 90 ? 0 : 90 } }]);
}

function duplicateBin() {
  const bin = selectedBin();
  if (!bin) return;
  const position = firstFit(...footprint(bin));
  if (!position) return showError("There is no room for another bin of this size. Enlarge the grid or move a bin first.");
  const newId = crypto.randomUUID();
  void edit([{ type: "duplicate_bin", id: bin.id, newId, ...position }], () => {
    selectedId = newId;
    binDirty = false;
  });
}

function removeBin() {
  const bin = selectedBin();
  if (bin) void edit([{ type: "remove_bin", id: bin.id }]);
}

function binKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || busy || !connected || dragging || designDirty || binDirty) return;
  selectBin(event.currentTarget.dataset.binId);
  const bin = selectedBin();
  const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (offsets[event.key]) {
    event.preventDefault();
    const [dx, dy] = offsets[event.key];
    void edit([{ type: "update_bin", id: bin.id, changes: { x: bin.x + dx, y: bin.y + dy } }]);
  } else if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    void rotateBin();
  } else if (event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateBin();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeBin();
  }
}

async function download(format, part) {
  await runAction(async () => {
    const query = new URLSearchParams({ format });
    if (part) query.set("part", part);
    if (part === "bin") {
      if (!selectedBin()) throw new Error("Select a bin to export.");
      query.set("binId", selectedId);
    }
    const blob = await api(`/api/export?${query}`, undefined, true);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const name = state.design.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 64) || "gridfinity";
    link.download = `${name}${part ? `-${part}` : ""}.${format === "json" ? "json" : "scad"}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    document.querySelector(".export-menu").open = false;
    closeHeaderMenus();
  });
}

function designFields() {
  return {
    name: $("design-name").value, columns: formNumber("grid-columns"), rows: formNumber("grid-rows"),
    drawerEnabled: $("layout-drawer-enabled").checked,
    drawerWidthCm: formNumber("layout-drawer-width"), drawerDepthCm: formNumber("layout-drawer-depth"),
    drawerClearanceMm: formNumber("layout-drawer-clearance"),
  };
}
function binFields() {
  const fields = { label: $("bin-label").value, color: $("bin-color").value };
  for (const key of ["width", "depth", "x", "y", "height", "rotation"]) fields[key] = formNumber(`bin-${key}`);
  const options = readBinControls("bin", !!selectedBin()?.inlay);
  if (selectedBin()?.options || Object.entries(BIN_OPTION_DEFAULTS).some(([key, value]) => options[key] !== value)) fields.options = options;
  return fields;
}
const sameFields = (a, b) => Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every(key => a[key] === b[key] || JSON.stringify(a[key]) === JSON.stringify(b[key]));

function scheduleLiveSave() {
  clearTimeout(liveSaveTimer);
  liveStatus = "Saving changes...";
  updateDraftStatus();
  updateControls();
  liveSaveTimer = setTimeout(() => void flushLiveEdits(), 250);
}

async function flushLiveEdits() {
  clearTimeout(liveSaveTimer);
  if (liveSavePromise) return liveSavePromise;
  if (!designDirty && !binDirty) return true;
  if (busy || dragging) {
    scheduleLiveSave();
    return false;
  }
  if (!state || !connected) {
    liveStatus = "Not saved. Reconnect, then edit a field or use Save to retry.";
    updateDraftStatus();
    return false;
  }
  if (designDirty && !$("design-form").checkValidity() || binDirty && !$("bin-form").checkValidity()) {
    liveStatus = "Not saved. Complete the highlighted fields with valid values, or reset them.";
    updateDraftStatus();
    return false;
  }
  const design = designDirty ? designFields() : null;
  const bin = binDirty ? { id: selectedId, changes: binFields() } : null;
  const revision = designDirty ? designDraftRevision : binDraftRevision;
  if (binDirty && designDirty && binDraftRevision !== revision) {
    showError("The design changed while you were editing. Reset fields to load the current layout.");
    liveStatus = "Not saved. Reset fields before editing again.";
    updateDraftStatus();
    return false;
  }
  const operations = [];
  liveSavePromise = runAction(async () => {
    if (design) {
      operations.push({ type: "rename", name: design.name }, ...layoutSizingOperations(design, state.design.grid.drawer));
    }
    if (bin) operations.push({ type: "update_bin", ...bin });
    const next = await api("/api/edit", { expectedRevision: revision, operations });
    if (design && sameFields(design, designFields())) designDirty = false;
    if (bin && bin.id === selectedId && sameFields(bin.changes, binFields())) binDirty = false;
    // Later keystrokes are based on our own accepted edit, not an unrelated remote revision.
    if (next.design.revision === revision + 1) {
      if (designDirty && designDraftRevision === revision) designDraftRevision = next.design.revision;
      if (binDirty && binDraftRevision === revision) binDraftRevision = next.design.revision;
    }
    applyState(next);
  });
  const saved = await liveSavePromise;
  liveSavePromise = null;
  const changedDuringSave = designDirty && (!design || !sameFields(design, designFields())) ||
    binDirty && (!bin || bin.id !== selectedId || !sameFields(bin.changes, binFields()));
  if ((saved || changedDuringSave) && (designDirty || binDirty)) scheduleLiveSave();
  else if (!saved) liveStatus = "Not saved. Fix the invalid values, or reset fields if another view changed the design.";
  updateDraftStatus();
  updateControls();
  return saved && !designDirty && !binDirty;
}

$("design-form").addEventListener("input", () => {
  syncDrawerInputState(true);
  if (!designDirty) designDraftRevision = state?.design.revision;
  designDirty = true;
  scheduleLiveSave();
});
$("bin-form").addEventListener("input", () => {
  syncBinControls("bin", !!selectedBin()?.inlay);
  if (!binDirty) binDraftRevision = state?.design.revision;
  binDirty = true;
  scheduleLiveSave();
});
$("design-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void flushLiveEdits();
});
$("bin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void flushLiveEdits();
});
async function resetLiveFields(kind) {
  clearTimeout(liveSaveTimer);
  await runAction(async () => {
    const next = await api("/api/state");
    if (kind === "design") designDirty = false;
    else binDirty = false;
    applyState(next);
    if (kind === "design") fillDesignForm(true);
    else fillBinForm(true);
  });
  updateDraftStatus();
  if (designDirty || binDirty) scheduleLiveSave();
}
$("reset-design").addEventListener("click", () => void resetLiveFields("design"));
$("reset-bin").addEventListener("click", () => void resetLiveFields("bin"));
$("rotate-bin").addEventListener("click", () => void rotateBin());
$("duplicate-bin").addEventListener("click", duplicateBin);
$("remove-bin").addEventListener("click", removeBin);
$("add-bin").addEventListener("click", () => {
  workflowUI.show("bin");
  $("new-bin-label").focus();
});
$("clear-bins").addEventListener("click", async () => {
  const expectedRevision = state.design.revision;
  if (await confirmAction("Clear all bins?", "Remove every bin from this design? This saves immediately and cannot be undone here.", "Clear all bins")) {
    void edit([{ type: "clear_bins" }], undefined, expectedRevision);
  }
});
$("save-design").addEventListener("click", async () => {
  if (!(await flushLiveEdits())) return;
  await runAction(async () => {
    applyState(await api("/api/save", {}));
    $("save-status").textContent = "Saved";
  });
});
$("dismiss-error").addEventListener("click", clearError);
$("edit-drawer-error").addEventListener("click", () => {
  workflowUI.show("layout");
  if ($("layout-drawer-enabled").checked) {
    $("layout-drawer-width").focus();
    $("layout-drawer-width").select();
  } else {
    $("layout-drawer-enabled").focus();
  }
});
$("export-json").addEventListener("click", () => void download("json"));
document.querySelectorAll("[data-export]").forEach((button) => {
  button.addEventListener("click", () => void download("scad", button.dataset.export));
});
$("import-json").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file || !state) return;
  const designId = state.design.designId;
  const expectedRevision = state.design.revision;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error("Choose a JSON layout under 4 MiB.");
    const layout = JSON.parse(await file.text());
    const body = { layout, expectedRevision };
    if (new TextEncoder().encode(JSON.stringify(body)).length > 4 * 1024 * 1024) throw new Error("This layout exceeds the 4 MiB import limit.");
    if ((state.design.bins.length || designDirty || binDirty) && !await confirmAction("Replace current layout?", "Import replaces this design’s grid and bins, while keeping its saved identity. Unapplied fields will be discarded. Export JSON first if you want a backup.", "Replace layout")) return;
    await runAction(async () => {
      if (state.design.designId !== designId) throw new Error("The current design changed. Choose the import file again.");
      const next = await api("/api/import", body);
      designDirty = false;
      binDirty = false;
      selectedId = null;
      applyState(next);
    });
  } catch (error) {
    showError(error instanceof SyntaxError ? "That file is not valid JSON. Choose a Gridfinity v1 JSON layout." : error);
  }
});

$("new-design").addEventListener("click", () => {
  $("design-dialog-heading").textContent = "New design";
  $("open-form").hidden = true;
  $("new-form").hidden = false;
  $("dialog-error").textContent = "";
  $("design-dialog").showModal();
  $("new-name").focus();
  $("new-name").select();
});
$("open-design").addEventListener("click", async () => {
  $("design-dialog-heading").textContent = "Open design";
  $("open-form").hidden = false;
  $("new-form").hidden = true;
  $("dialog-error").textContent = "";
  $("saved-designs").replaceChildren();
  $("design-list-status").textContent = "Loading saved designs…";
  $("design-dialog").showModal();
  await runAction(async () => {
    const { designs } = await api("/api/designs");
    for (const design of designs) {
      const option = document.createElement("option");
      option.value = design.designId;
      option.textContent = `${design.name} · rev ${design.revision}`;
      option.selected = design.designId === state?.design.designId;
      $("saved-designs").append(option);
    }
    $("design-list-status").textContent = designs.length ? "Opens in a new panel. This panel and its unapplied fields stay as they are." : "No saved designs yet. Create a new design.";
  });
});
$("saved-designs").addEventListener("change", updateControls);
$("close-design-dialog").addEventListener("click", () => $("design-dialog").close());
$("open-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const designId = $("saved-designs").value;
  if (!designId) return;
  await runAction(async () => {
    const next = await api("/api/open", { designId });
    applyState(next);
    $("design-dialog").close();
  });
});
$("new-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("new-name").value.trim();
  if (!name) { $("dialog-error").textContent = "Enter a name for the design."; return; }
  await runAction(async () => {
    applyState(await api("/api/new", { designId: crypto.randomUUID(), name }));
    $("design-dialog").close();
  });
});
$("confirm-cancel").addEventListener("click", () => finishConfirmation(false));
$("confirm-accept").addEventListener("click", () => finishConfirmation(true));
$("confirm-dialog").addEventListener("cancel", (event) => { event.preventDefault(); finishConfirmation(false); });
window.addEventListener("blur", cancelDrag);
window.addEventListener("pagehide", event => { if (!event.persisted) viewer?.dispose(); });
async function setView(mode) {
  if (!state || viewerLoading) return;
  if (mode === "3d" && !viewer) {
    viewerLoading = true;
    $("view-3d").disabled = true;
    try {
      const { createViewer } = await import("./viewer.mjs");
      $("model-viewer").hidden = false;
      viewer = createViewer($("model-viewer"), { onError: showError, onSelect: id => selectBin(id) });
      viewer.update(state.design, selectedId);
    } catch (error) {
      $("model-viewer").hidden = true;
      showError(`The 3D viewer could not start: ${error.message}. You can still use Layout.`);
      return;
    } finally {
      viewerLoading = false;
      $("view-3d").disabled = false;
    }
  }
  $("layout-preview").hidden = mode !== "layout";
  $("model-viewer").hidden = mode !== "3d";
  $("layout-zoom").hidden = mode !== "layout";
  $("view-layout").setAttribute("aria-pressed", String(mode === "layout"));
  $("view-3d").setAttribute("aria-pressed", String(mode === "3d"));
  $("preview-label").textContent = mode === "3d" ? "Model / 3D preview" : "Layout / top view";
  document.querySelector(".keyboard-hint").textContent = mode === "3d" ? "Drag to orbit · Wheel to zoom" : "Drag to snap · Arrow keys to move";
  if (mode === "layout") fitGridPreview();
}
$("view-layout").addEventListener("click", () => void setView("layout"));
$("view-3d").addEventListener("click", () => void setView("3d"));
$("edit-inlay").addEventListener("click", () => {
  const bin = selectedBin();
  if (!bin) return;
  const expectedRevision = state.design.revision;
  openPhotoEditor({
    bin: structuredClone(bin),
    onSave: async inlay => {
      if (busy) throw new Error("Another edit is in progress. Try again.");
      busy = true;
      epoch++;
      updateControls();
      try {
        const next = await api("/api/edit", { expectedRevision, operations: [{ type: "update_bin", id: bin.id, changes: { inlay } }] });
        applyState(next);
      } finally {
        busy = false;
        updateControls();
      }
    },
  });
});
$("remove-inlay").addEventListener("click", async () => {
  const bin = selectedBin();
  if (!bin?.inlay) return;
  const expectedRevision = state.design.revision;
  if (await confirmAction("Remove item recess?", "This also removes its saved reference photo. The bin will become a normal open bin.", "Remove recess")) {
    void edit([{ type: "update_bin", id: bin.id, changes: { inlay: null } }], undefined, expectedRevision);
  }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) void poll(); });
$("grid-zoom").addEventListener("input", fitGridPreview);
$("fit-grid").addEventListener("click", () => { $("grid-zoom").value = "100"; fitGridPreview(); });
const gridResizeObserver = new ResizeObserver(fitGridPreview);
gridResizeObserver.observe($("layout-preview"));
window.addEventListener("resize", fitGridPreview);
window.addEventListener("beforeunload", event => {
  if (designDirty || binDirty || liveSavePromise) { event.preventDefault(); event.returnValue = ""; }
});
workflowUI = setupWorkflows({
  getState: () => state,
  edit,
  findSpace: firstFit,
  onCreated: id => {
    selectBin(id, true);
    $("fabrication-part").value = "bin";
    updateControls();
  },
  onPhoto: () => $("edit-inlay").click(),
  onError: showError,
  onTabChange: updateControls,
  canEdit: () => !!state && connected && !busy && !designDirty && !binDirty,
  canExport: format => !!state && connected && !busy && (format !== "stl" || !!fabrication?.stl),
  onExportDraft: (design, input) => runAction(async () => {
    setExportPending(true);
    $("fabrication-status").textContent = `Exporting ${design.name}...`;
    try {
      const blob = await api("/api/export-draft", { design, ...input }, true, 150000);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${design.designId}-${input.part}.${input.format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      $("fabrication-status").textContent = "Draft exported. The saved layout is unchanged.";
    } catch (error) {
      $("fabrication-status").textContent = `Draft export failed: ${errorMessage(error)}`;
      throw error;
    } finally { setExportPending(false); }
  }),
});
async function refreshFabrication() {
  if (fabricationRefreshing || busy) return;
  fabricationRefreshing = true;
  updateControls();
  try {
    fabrication = await api("/api/fabrication/status");
    $("fabrication-status").textContent = fabrication.message;
  } catch (error) {
    fabrication = null;
    $("fabrication-status").textContent = `Export tools unavailable: ${errorMessage(error)}`;
  } finally {
    fabricationRefreshing = false;
  }
  updateControls();
}
function fabricationInput() {
  const part = $("fabrication-part").value;
  const input = { part, expectedRevision: state.design.revision };
  if (part === "bin") {
    if (!selectedBin()) throw new Error("Select a bin to export.");
    input.binId = selectedId;
  }
  return input;
}
$("fabrication-part").addEventListener("change", updateControls);
$("refresh-fabrication").addEventListener("click", () => void refreshFabrication());
function setExportPending(pending) {
  $("export-menu-trigger").setAttribute("aria-busy", String(pending));
  $("export-menu-trigger").title = pending ? "Export in progress. Open for status." : "Export files";
}
$("export-active-scad").addEventListener("click", () => workflowUI?.exportActiveDraft("scad"));
$("export-stl").addEventListener("click", () => {
  if (workflowUI?.exportActiveDraft("stl")) return;
  void runAction(async () => {
  const input = fabricationInput();
  setExportPending(true);
  $("fabrication-status").textContent = "Rendering STL with OpenSCAD. This can take up to two minutes...";
  try {
    const blob = await api(`/api/export?${new URLSearchParams({ format: "stl", ...input })}`, undefined, true, 150000);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.design.designId}-${input.part}-rev${input.expectedRevision}.stl`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("fabrication-status").textContent = `STL exported from revision ${input.expectedRevision}. Inspect it in your slicer.`;
  } catch (error) {
    $("fabrication-status").textContent = `STL export failed: ${errorMessage(error)}`;
    throw error;
  } finally {
    setExportPending(false);
  }
  });
});
$("open-bambu").addEventListener("click", () => void runAction(async () => {
  setExportPending(true);
  $("fabrication-status").textContent = "Rendering STL, then opening Bambu Studio...";
  try {
    const result = await api("/api/open-bambu", fabricationInput(), false, 150000);
    $("fabrication-status").textContent = result.message;
  } catch (error) {
    $("fabrication-status").textContent = `Bambu handoff failed: ${errorMessage(error)}`;
    throw error;
  } finally {
    setExportPending(false);
  }
}));
function closeHeaderMenus(restoreFocus = false) {
  const open = document.querySelector(".header-menu[open]");
  document.querySelectorAll(".header-menu").forEach(menu => { menu.open = false; });
  if (restoreFocus) open?.querySelector("summary").focus();
}
document.querySelectorAll(".header-menu").forEach(menu => {
  menu.addEventListener("toggle", () => {
    if (menu.open) document.querySelectorAll(".header-menu").forEach(other => {
      if (other !== menu) other.open = false;
    });
  });
});
document.addEventListener("click", event => {
  if (!event.target?.closest?.(".header-menu")) closeHeaderMenus();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.querySelector(".header-menu[open]")) {
    event.preventDefault();
    closeHeaderMenus(true);
  }
});
for (const id of ["new-design", "open-design", "import-json"]) $(id).addEventListener("click", () => closeHeaderMenus());
updateControls();
void poll();
setInterval(() => { if (!document.hidden) void poll(); }, 1500);
