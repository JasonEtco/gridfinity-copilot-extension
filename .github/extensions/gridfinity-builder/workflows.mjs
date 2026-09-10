import { ALEX_DRAWER, baseplateOptions, drawerFromMeasurements, fitDrawer, gridFrame } from "./grid.mjs";
import { BIN_OPTION_DEFAULTS, binDimensions, validateBinOptions } from "./bin-options.mjs";
import { fillBinControls, readBinControls } from "./bin-controls.mjs";
import { validateDesign } from "./model.mjs";

export function setupWorkflows({ getState, edit, findSpace, onCreated, onPhoto, onError, onTabChange, canEdit = () => true, canExport = () => false, onExportDraft }) {
    const $ = id => document.getElementById(id);
    const tabs = [...document.querySelectorAll("[data-workflow]")];
    const number = id => Number($(id).value);
    const previews = {
        bin: { viewer: null, pending: null, desired: null, key: null, failed: null },
        grid: { viewer: null, pending: null, desired: null, key: null, failed: null },
    };
    let activeTab = "layout", gridDirty = false, gridRevision = null, drawerUnit = "cm";
    let binValid = false, gridValid = false, photoCompatible = true, hasDraftSpacers = false, previewRevision = 0;

    function disposePreview(kind) {
        previews[kind].viewer?.dispose();
        previews[kind].viewer = null;
        previews[kind].key = null;
        previews[kind].failed = null;
    }
    function show(name) {
        activeTab = name;
        for (const tab of tabs) {
            const selected = tab.dataset.workflow === name;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            $(`workflow-${tab.dataset.workflow}`).hidden = !selected;
        }
        for (const kind of ["bin", "grid"]) if (kind !== name) disposePreview(kind);
        update();
        onTabChange?.(name);
    }
    for (const tab of tabs) {
        tab.addEventListener("click", () => show(tab.dataset.workflow));
        tab.addEventListener("keydown", event => {
            let index = tabs.indexOf(tab);
            if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") index = (index + tabs.length - 1) % tabs.length;
            else if (event.key === "Home") index = 0;
            else if (event.key === "End") index = tabs.length - 1;
            else return;
            event.preventDefault();
            show(tabs[index].dataset.workflow);
            tabs[index].focus();
        });
    }

    async function update3D(kind, grid, bins, selectedId = null) {
        const preview = previews[kind];
        const key = JSON.stringify({ grid, bins, selectedId });
        preview.desired = { key, grid, bins, selectedId };
        if (activeTab !== kind || preview.failed === key) return;
        if (!preview.viewer) {
            if (preview.pending) return;
            preview.pending = import("./viewer.mjs");
            try {
                const { createViewer } = await preview.pending;
                if (activeTab !== kind) return;
                preview.viewer = createViewer($(`new-${kind}-viewer`), {
                    initialMode: kind === "bin" ? "selected" : "baseplate",
                    lockMode: true,
                    onError: error => { $(`new-${kind}-error`).textContent = error.message; },
                });
            } catch (error) {
                preview.failed = key;
                $(`new-${kind}-error`).textContent = `3D preview unavailable: ${error.message}`;
                return;
            } finally {
                preview.pending = null;
            }
        }
        if (!preview.viewer || activeTab !== kind) return;
        const latest = preview.desired;
        if (preview.key !== latest.key) {
            preview.viewer.update({
                version: 1, designId: `${kind}-preview`, name: `${kind} preview`, revision: ++previewRevision,
                grid: latest.grid, bins: latest.bins,
            }, latest.selectedId);
            preview.key = latest.key;
        }
        if (kind === "grid") preview.viewer.setExcessHighlight($("highlight-excess").checked);
    }

    function binDraft(newId = false) {
        const bin = {
            id: newId ? crypto.randomUUID() : "draft-bin", label: $("new-bin-label").value.trim(),
            x: 0, y: 0, width: number("new-bin-width"), depth: number("new-bin-depth"),
            height: number("new-bin-height"), rotation: number("new-bin-rotation"),
            color: $("new-bin-color").value, options: readBinControls("new-bin"),
        };
        validateBinOptions(bin);
        const grid = { columns: bin.rotation === 90 ? bin.depth : bin.width, rows: bin.rotation === 90 ? bin.width : bin.depth };
        validateDesign({ version: 1, designId: "draft", name: "Draft", revision: 0, grid, bins: [bin] });
        return bin;
    }

    function binDraftLabel(label) {
        const clean = (label || "bin").trim() || "bin";
        return `New ${clean}`.slice(0, 80);
    }

    function useBinAsDraft(bin) {
        validateBinOptions(bin);
        $("new-bin-preset").value = "custom";
        $("new-bin-label").value = binDraftLabel(bin.label);
        for (const key of ["width", "depth", "height", "rotation", "color"]) {
            $(`new-bin-${key}`).value = bin[key];
        }
        fillBinControls("new-bin", { options: structuredClone(bin.options || {}) });
        $("new-bin-template-status").textContent = bin.inlay
            ? `Started from ${bin.label || "the selected bin"}. Size and construction were copied; the photo recess was not copied.`
            : `Started from ${bin.label || "the selected bin"}. Edit the draft, then create and place it.`;
        show("bin");
        updateBinPreview();
        $("new-bin-label").focus();
        $("new-bin-label").select();
    }

    function updateBinPreview() {
        try {
            const bin = binDraft();
            const width = bin.rotation === 90 ? bin.depth : bin.width;
            const depth = bin.rotation === 90 ? bin.width : bin.depth;
            const size = binDimensions(bin);
            binValid = true;
            photoCompatible = bin.options.divisionsX === 1 && bin.options.divisionsY === 1 &&
                bin.options.labelPosition === "none" && bin.options.scoopRadiusMm === 0 &&
                bin.height * 7 - 4.75 - bin.options.floorMm >= 0.1;
            $("new-bin-viewer").dataset.stale = "false";
            $("new-bin-error").textContent = "";
            $("new-bin-size").textContent = `${bin.rotation === 90 ? size.depthMm : size.widthMm} × ${bin.rotation === 90 ? size.widthMm : size.depthMm} × ${size.heightMm} mm`;
            const place = getState() && findSpace(width, depth);
            $("new-bin-fit").textContent = place ? `Fits at column ${place.x}, row ${place.y}.` : "No free space for this size. Resize the layout before placement.";
            void update3D("bin", { columns: width, rows: depth }, [bin], bin.id);
        } catch (error) {
            binValid = false;
            $("new-bin-viewer").dataset.stale = "true";
            $("new-bin-size").textContent = "Check the bin settings";
            $("new-bin-error").textContent = `${error.message} The preview keeps the last valid shape.`;
        }
        syncAvailability();
    }

    $("create-bin-form").addEventListener("input", event => {
        if (event.target.id !== "new-bin-preset") $("new-bin-preset").value = "custom";
        updateBinPreview();
    });
    $("new-bin-preset").addEventListener("change", () => {
        const preset = $("new-bin-preset").value;
        if (preset === "custom") return;
        const options = { ...BIN_OPTION_DEFAULTS };
        $("new-bin-width").value = preset === "solid" ? 3 : preset === "parts" ? 2 : 1;
        $("new-bin-depth").value = preset === "standard" ? 1 : 2;
        $("new-bin-height").value = preset === "parts" ? 4 : 3;
        $("new-bin-rotation").value = 0;
        if (preset === "parts") Object.assign(options, { divisionsX: 2, divisionsY: 2, labelPosition: "full", labelDepthMm: 6, scoopRadiusMm: 4 });
        if (preset === "solid") options.solid = true;
        fillBinControls("new-bin", { options });
        updateBinPreview();
    });
    $("create-bin-form").addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const bin = binDraft(true);
            const place = findSpace(bin.rotation === 90 ? bin.depth : bin.width, bin.rotation === 90 ? bin.width : bin.depth);
            if (!place) throw new Error("This bin does not fit in the current layout. Resize the grid or remove a bin first.");
            if (event.submitter?.dataset.photo && !photoCompatible) throw new Error("Photo recesses need one compartment with no label ledge or scoop.");
            if (!await edit([{ type: "add_bin", bin: { ...bin, ...place } }])) return;
            show("layout");
            onCreated(bin.id);
            if (event.submitter?.dataset.photo) onPhoto();
        } catch (error) { onError(error); }
    });

    function drawerDraft() {
        const alignment = $("drawer-alignment").value;
        return drawerFromMeasurements({
            width: number("drawer-width"), depth: number("drawer-depth"), unit: $("drawer-unit").value,
            clearanceMm: number("drawer-clearance"), alignment, spacers: $("drawer-spacers").checked,
            margin: $("drawer-margin").value,
            ...(alignment === "custom" ? { offsetXmm: number("grid-offset-x-mm"), offsetYmm: number("grid-offset-y-mm") } : {}),
        });
    }
    function unitLabels() {
        const unit = $("drawer-unit").value;
        $("drawer-width-label").textContent = `Width (${unit})`;
        $("drawer-depth-label").textContent = `Depth (${unit})`;
        for (const id of ["drawer-width", "drawer-depth"]) {
            $(id).min = unit === "cm" ? "4.2" : "42";
            $(id).max = unit === "cm" ? "200" : "2000";
        }
    }
    function fillDrawer(drawer) {
        const divisor = $("drawer-unit").value === "cm" ? 10 : 1;
        $("drawer-width").value = drawer.widthMm / divisor;
        $("drawer-depth").value = drawer.depthMm / divisor;
        $("drawer-clearance").value = drawer.clearanceMm;
        $("drawer-alignment").value = drawer.alignment;
        $("drawer-spacers").checked = drawer.spacers;
        $("drawer-margin").value = drawer.margin ?? "separate";
        $("grid-offset-x-mm").value = drawer.offsetXmm ?? 0;
        $("grid-offset-y-mm").value = drawer.offsetYmm ?? 0;
        unitLabels();
    }
    function proposedGrid() {
        let grid;
        if ($("new-grid-mode").value === "drawer") grid = fitDrawer(drawerDraft());
        else {
            const columns = number("new-grid-columns"), rows = number("new-grid-rows");
            if (![columns, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 32)) throw new Error("Choose 1 to 32 whole cells per side.");
            grid = { columns, rows };
        }
        grid.baseplate = { type: $("new-plate-type").value, floorMm: number("new-plate-floor") };
        baseplateOptions(grid);
        return grid;
    }
    function setGridFields() {
        const grid = getState()?.design.grid;
        if (!grid || gridDirty) return;
        $("new-grid-columns").value = grid.columns;
        $("new-grid-rows").value = grid.rows;
        $("new-grid-mode").value = grid.drawer ? "drawer" : "cells";
        $("new-plate-type").value = grid.baseplate?.type ?? "solid";
        $("new-plate-floor").value = grid.baseplate?.floorMm ?? 2;
        fillDrawer(grid.drawer || ALEX_DRAWER);
    }

    function updateGridPreview() {
        const drawerMode = $("new-grid-mode").value === "drawer";
        $("new-grid-cells").hidden = drawerMode;
        $("new-grid-cells").disabled = drawerMode;
        $("new-grid-drawer").hidden = !drawerMode;
        $("new-grid-drawer").disabled = !drawerMode;
        $("new-plate-floor").disabled = $("new-plate-type").value === "frame";
        $("drawer-margin").disabled = !$("drawer-spacers").checked;
        document.querySelectorAll("[data-alignment]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.alignment === $("drawer-alignment").value)));
        try {
            const grid = proposedGrid();
            if (grid.drawer) {
                for (const [axis, available] of [
                    ["x", grid.drawer.widthMm - 2 * grid.drawer.clearanceMm - grid.columns * 42],
                    ["y", grid.drawer.depthMm - 2 * grid.drawer.clearanceMm - grid.rows * 42],
                ]) {
                    $(`grid-offset-${axis}`).max = Math.max(0, available);
                    $(`grid-offset-${axis}-mm`).max = Math.max(0, available);
                    $(`grid-offset-${axis}`).disabled = available <= 0;
                }
            }
            const frame = gridFrame(grid);
            gridValid = true;
            hasDraftSpacers = frame.spacers.length > 0;
            $("new-grid-viewer").dataset.stale = "false";
            $("new-grid-error").textContent = "";
            if (grid.drawer && grid.drawer.alignment !== "custom") {
                $("grid-offset-x-mm").value = frame.gaps.left;
                $("grid-offset-y-mm").value = frame.gaps.front;
            }
            $("grid-offset-x").value = $("grid-offset-x-mm").value;
            $("grid-offset-y").value = $("grid-offset-y-mm").value;
            $("horizontal-excess").textContent = `Left ${frame.gaps.left} mm · Right ${frame.gaps.right} mm`;
            $("vertical-excess").textContent = `Front ${frame.gaps.front} mm · Back ${frame.gaps.back} mm`;
            drawFitPlan(frame);
            const marginLabel = frame.marginMode === "integrated" ? "solid border" : frame.marginMode === "empty" ? "empty excess" : `${frame.spacers.length} spacers`;
            $("grid-fit-size").textContent = `${grid.columns} × ${grid.rows} cells · ${marginLabel} · ${frame.heightMm} mm high`;
            $("grid-fit-gaps").textContent = `Grid ${frame.gridWidthMm} × ${frame.gridDepthMm} mm. Excess: left ${frame.gaps.left}, right ${frame.gaps.right}, front ${frame.gaps.front}, back ${frame.gaps.back} mm.`;
            const outside = getState()?.design.bins.filter(bin => bin.x + (bin.rotation === 90 ? bin.depth : bin.width) > grid.columns ||
                bin.y + (bin.rotation === 90 ? bin.width : bin.depth) > grid.rows).length || 0;
            $("grid-fit-warning").textContent = outside ? `${outside} existing bins would be outside this grid. Applying it will be rejected.` :
                frame.marginParts.some(part => Math.min(part.width, part.depth) < 0.8) ? "Some excess strips are thinner than 0.8 mm. Check your nozzle and slicer." :
                    "Choose an alignment preset or set offsets. Front is at the bottom of the plan.";
            void update3D("grid", grid, []);
        } catch (error) {
            gridValid = false;
            $("new-grid-viewer").dataset.stale = "true";
            $("new-grid-error").textContent = `${error.message} The 3D preview keeps the last valid shape.`;
            $("grid-fit-size").textContent = "Check the grid settings";
            $("grid-fit-warning").textContent = error.message;
        }
        syncAvailability();
    }

    function drawFitPlan(frame) {
        const svg = $("grid-fit-diagram"), ns = "http://www.w3.org/2000/svg";
        const node = (name, attributes, text) => {
            const element = document.createElementNS(ns, name);
            for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
            if (text) element.textContent = text;
            return element;
        };
        svg.replaceChildren();
        const padding = Math.max(frame.widthMm, frame.depthMm) * 0.045;
        svg.setAttribute("viewBox", `${-padding} ${-padding} ${frame.widthMm + 2 * padding} ${frame.depthMm + 2 * padding}`);
        const defs = node("defs", {});
        const pattern = node("pattern", { id: "fit-cell-pattern", x: frame.originX, y: frame.originY, width: 42, height: 42, patternUnits: "userSpaceOnUse" });
        pattern.append(node("rect", { width: 42, height: 42, fill: "var(--surface)", stroke: "var(--accent)", "stroke-width": 1 }));
        defs.append(pattern);
        const group = node("g", { transform: `translate(0,${frame.depthMm}) scale(1,-1)` });
        group.append(node("rect", { width: frame.widthMm, height: frame.depthMm, fill: "var(--background)", stroke: "var(--muted)", "stroke-width": 1 }));
        for (const part of frame.excess) group.append(node("rect", {
            x: part.x, y: part.y, width: part.width, height: part.depth,
            fill: $("highlight-excess").checked ? "var(--amber)" : "var(--border)",
            opacity: frame.marginMode === "empty" ? 0.3 : 0.9,
        }));
        group.append(node("rect", { x: frame.originX, y: frame.originY, width: frame.gridWidthMm, height: frame.gridDepthMm, fill: "url(#fit-cell-pattern)", stroke: "var(--accent)", "stroke-width": 1 }));
        svg.append(defs, group, node("text", { x: frame.widthMm / 2, y: frame.depthMm + padding * 0.75, "text-anchor": "middle", fill: "var(--muted)", "font-size": padding * 0.65 }, "Front"));
    }

    function markGridDirty() {
        if (!gridDirty) gridRevision = getState()?.design.revision;
        gridDirty = true;
    }
    $("drawer-unit").addEventListener("input", event => {
        event.stopPropagation();
        const nextUnit = $("drawer-unit").value;
        const factor = (drawerUnit === "cm" ? 10 : 1) / (nextUnit === "cm" ? 10 : 1);
        for (const id of ["drawer-width", "drawer-depth"]) if ($(id).value !== "" && Number.isFinite(number(id))) $(id).value = Math.round(number(id) * factor * 1e6) / 1e6;
        drawerUnit = nextUnit;
        unitLabels();
        updateGridPreview();
    });
    $("alex-preset").addEventListener("click", () => { markGridDirty(); $("new-grid-mode").value = "drawer"; fillDrawer(ALEX_DRAWER); updateGridPreview(); });
    document.querySelectorAll("[data-alignment]").forEach(button => button.addEventListener("click", () => {
        markGridDirty();
        $("drawer-alignment").value = button.dataset.alignment;
        updateGridPreview();
    }));
    for (const axis of ["x", "y"]) for (const suffix of ["", "-mm"]) {
        $(`grid-offset-${axis}${suffix}`).addEventListener("input", () => {
            markGridDirty();
            $("drawer-alignment").value = "custom";
            $(`grid-offset-${axis}${suffix ? "" : "-mm"}`).value = $(`grid-offset-${axis}${suffix}`).value;
            updateGridPreview();
        });
    }
    $("highlight-excess").addEventListener("input", updateGridPreview);
    $("create-grid-form").addEventListener("input", () => { markGridDirty(); updateGridPreview(); });
    $("create-grid-form").addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const grid = proposedGrid();
            gridFrame(grid);
            const operations = [{ type: "set_baseplate", baseplate: grid.baseplate }, ...(grid.drawer
                ? [{ type: "fit_drawer", drawer: grid.drawer }]
                : [{ type: "clear_drawer" }, { type: "resize_grid", columns: grid.columns, rows: grid.rows }])];
            const saved = await edit(operations, () => { gridDirty = false; }, gridDirty ? gridRevision : getState().design.revision);
            if (saved) { $("fabrication-part").value = "baseplate"; show("layout"); }
        } catch (error) { onError(error); }
    });
    $("reset-new-grid").addEventListener("click", () => { gridDirty = false; setGridFields(); updateGridPreview(); });
    async function exportDraft(kind, format, partOverride) {
        try {
            const bin = kind === "bin" ? binDraft() : null;
            const grid = bin ? { columns: bin.rotation === 90 ? bin.depth : bin.width, rows: bin.rotation === 90 ? bin.width : bin.depth } : proposedGrid();
            const design = { version: 1, designId: `${kind}-draft`, name: `${kind} draft`, revision: ++previewRevision, grid, bins: bin ? [bin] : [] };
            validateDesign(design);
            $(`new-${kind}-export-status`).textContent = format === "stl" ? "Rendering draft STL..." : "Preparing draft source...";
            const completed = await onExportDraft(design, { format, part: partOverride || (bin ? "bin" : "baseplate"), ...(bin ? { binId: bin.id } : {}) });
            $(`new-${kind}-export-status`).textContent = completed ? "Draft exported. Your saved layout is unchanged." : "Export did not complete. Check the error message.";
        } catch (error) {
            $(`new-${kind}-export-status`).textContent = error.message;
            onError(error);
        }
    }
    for (const kind of ["bin", "grid"]) for (const format of ["stl", "scad"]) {
        $(`export-${kind}-draft-${format}`).addEventListener("click", () => void exportDraft(kind, format));
    }
    $("export-grid-draft-spacers").addEventListener("click", () => void exportDraft("grid", "stl", "spacers"));
    function syncAvailability() {
        $("create-bin-submit").disabled = !canEdit() || !binValid;
        $("create-bin-photo").disabled = !canEdit() || !binValid || !photoCompatible;
        $("create-grid-submit").disabled = !canEdit() || !gridValid;
        for (const kind of ["bin", "grid"]) for (const format of ["stl", "scad"]) {
            $(`export-${kind}-draft-${format}`).disabled = !(kind === "bin" ? binValid : gridValid) || !canExport(format);
        }
        $("export-grid-draft-spacers").disabled = !gridValid || !hasDraftSpacers || !canExport("stl");
        syncHeaderExport();
    }
    function syncHeaderExport() {
        const draft = activeTab !== "layout";
        $("export-context").textContent = draft
            ? `Current ${activeTab === "bin" ? "bin" : "grid"} draft only. The saved layout is unchanged.`
            : "Export from the saved layout.";
        $("fabrication-part").hidden = draft;
        document.querySelector('label[for="fabrication-part"]').hidden = draft;
        $("open-bambu").hidden = draft;
        $("export-json").hidden = draft;
        $("saved-scad-menu").hidden = draft;
        $("export-active-scad").hidden = !draft;
        if (draft) {
            const valid = activeTab === "bin" ? binValid : gridValid;
            $("export-stl").disabled = !valid || !canExport("stl");
            $("export-active-scad").disabled = !valid || !canExport("scad");
            $("export-stl").textContent = activeTab === "bin" ? "Export bin STL" : "Export grid STL";
            $("export-stl").title = "Export the current draft without placing it in the layout.";
        } else $("export-stl").textContent = "Export STL";
    }
    function update() {
        setGridFields();
        updateGridPreview();
        updateBinPreview();
    }
    window.addEventListener("pagehide", () => { disposePreview("bin"); disposePreview("grid"); });
    update();
    return {
        show, update, syncAvailability, useBinAsDraft,
        exportActiveDraft(format) {
            if (activeTab === "layout") return false;
            void exportDraft(activeTab, format);
            return true;
        },
    };
}
