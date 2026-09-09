export const GRID_PITCH = 42;
export const GRID_ALIGNMENTS = Object.freeze({
    "back-left": [0, 1], back: [0.5, 1], "back-right": [1, 1],
    left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
    "front-left": [0, 0], front: [0.5, 0], "front-right": [1, 0],
});
// Measured interior of the common 36 x 58 cm ALEX five-drawer unit; individual drawers vary.
export const ALEX_DRAWER = Object.freeze({
    widthMm: 292, depthMm: 524, clearanceMm: 0.5, alignment: "center", spacers: true,
});
const round = value => Math.round(value * 1e6) / 1e6;

export function drawerFromMeasurements({ width, depth, unit, clearanceMm = 0.5, alignment = "center", spacers = true, offsetXmm, offsetYmm, margin }) {
    if (!["cm", "mm"].includes(unit)) throw new Error("Choose centimetres or millimetres.");
    if (![width, depth].every(Number.isFinite)) throw new Error("Enter finite drawer dimensions.");
    const scale = unit === "cm" ? 10 : 1;
    const drawer = { widthMm: round(width * scale), depthMm: round(depth * scale), clearanceMm, alignment, spacers };
    if (offsetXmm !== undefined) drawer.offsetXmm = offsetXmm;
    if (offsetYmm !== undefined) drawer.offsetYmm = offsetYmm;
    if (margin !== undefined) drawer.margin = margin;
    validateDrawer(drawer);
    return drawer;
}

export function layoutSizingOperations(fields, currentDrawer) {
    if (fields.drawerEnabled) {
        const drawer = drawerFromMeasurements({
            width: fields.drawerWidthCm, depth: fields.drawerDepthCm, unit: "cm",
            clearanceMm: fields.drawerClearanceMm,
            alignment: currentDrawer?.alignment ?? "center", spacers: currentDrawer?.spacers ?? true,
            offsetXmm: currentDrawer?.offsetXmm, offsetYmm: currentDrawer?.offsetYmm, margin: currentDrawer?.margin,
        });
        if (drawer.alignment === "custom") {
            const grid = fitDrawer(drawer);
            drawer.offsetXmm = round(Math.min(drawer.offsetXmm, drawer.widthMm - 2 * drawer.clearanceMm - grid.columns * GRID_PITCH));
            drawer.offsetYmm = round(Math.min(drawer.offsetYmm, drawer.depthMm - 2 * drawer.clearanceMm - grid.rows * GRID_PITCH));
        }
        return [{ type: "fit_drawer", drawer }];
    }
    return [
        ...(currentDrawer ? [{ type: "clear_drawer" }] : []),
        { type: "resize_grid", columns: fields.columns, rows: fields.rows },
    ];
}

export function validateDrawer(drawer) {
    if (drawer === undefined || drawer === null) return;
    const fail = message => { throw new Error(message); };
    if (typeof drawer !== "object" || Array.isArray(drawer) ||
        Object.keys(drawer).some(key => !["widthMm", "depthMm", "clearanceMm", "alignment", "spacers", "offsetXmm", "offsetYmm", "margin"].includes(key))) fail("Drawer settings contain invalid fields.");
    for (const key of ["widthMm", "depthMm"]) {
        if (!Number.isFinite(drawer[key]) || drawer[key] < 42 || drawer[key] > 2000) fail("Drawer dimensions must be from 42 to 2000 mm.");
    }
    if (!Number.isFinite(drawer.clearanceMm) || drawer.clearanceMm < 0 || drawer.clearanceMm > 5) fail("Drawer clearance must be from 0 to 5 mm per side.");
    if (!Object.hasOwn(GRID_ALIGNMENTS, drawer.alignment) && drawer.alignment !== "custom") fail("Choose a grid alignment preset or custom offsets.");
    for (const key of ["offsetXmm", "offsetYmm"]) {
        if ((drawer.alignment === "custom" || drawer[key] !== undefined) &&
            (!Number.isFinite(drawer[key]) || drawer[key] < 0 || drawer[key] > 2000)) fail("Custom grid offsets must be finite millimeters from the left and front edges.");
    }
    if (drawer.margin !== undefined && !["separate", "integrated"].includes(drawer.margin)) fail("Choose separate spacers or an integrated solid border.");
    if (typeof drawer.spacers !== "boolean") fail("Choose whether to create edge spacers.");
}

export function baseplateOptions(grid) {
    const value = grid.baseplate ?? { type: "solid", floorMm: 2 };
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some(key => !["type", "floorMm"].includes(key)) ||
        !["solid", "frame"].includes(value.type) || !Number.isFinite(value.floorMm) || value.floorMm < 0.8 || value.floorMm > 5) {
        throw new Error("Choose a solid-floor or open-frame baseplate with a floor setting from 0.8 to 5 mm.");
    }
    return { type: value.type, floorMm: value.type === "frame" ? 0 : value.floorMm, heightMm: (value.type === "frame" ? 0 : value.floorMm) + 5 };
}

export function fitDrawer(drawer) {
    validateDrawer(drawer);
    if (!drawer) throw new Error("Enter drawer dimensions.");
    const columns = Math.floor((drawer.widthMm - 2 * drawer.clearanceMm + 1e-8) / GRID_PITCH);
    const rows = Math.floor((drawer.depthMm - 2 * drawer.clearanceMm + 1e-8) / GRID_PITCH);
    if (columns < 1 || rows < 1 || columns > 32 || rows > 32) throw new Error("The usable drawer must fit 1 to 32 cells per side.");
    return { columns, rows, drawer: structuredClone(drawer) };
}

export function gridFrame(grid) {
    const plate = baseplateOptions(grid);
    const gridWidthMm = grid.columns * GRID_PITCH;
    const gridDepthMm = grid.rows * GRID_PITCH;
    const drawer = grid.drawer;
    if (!drawer) return {
        widthMm: gridWidthMm, depthMm: gridDepthMm, gridWidthMm, gridDepthMm, originX: 0, originY: 0,
        gaps: { left: 0, right: 0, front: 0, back: 0 }, spacers: [],
        excess: [], marginParts: [], marginMode: "empty", heightMm: plate.heightMm, floorMm: plate.floorMm,
    };
    validateDrawer(drawer);
    const c = drawer.clearanceMm;
    const dx = round(drawer.widthMm - 2 * c - gridWidthMm);
    const dy = round(drawer.depthMm - 2 * c - gridDepthMm);
    if (dx < 0 || dy < 0) throw new Error(`This grid is larger than the usable drawer. ${grid.columns} by ${grid.rows} cells need at least ${round((gridWidthMm + 2 * c) / 10)} by ${round((gridDepthMm + 2 * c) / 10)} cm, including clearance. Edit the drawer dimensions or reduce the cell count.`);
    const factors = GRID_ALIGNMENTS[drawer.alignment];
    const left = drawer.alignment === "custom" ? round(drawer.offsetXmm) : round(dx * factors[0]);
    const front = drawer.alignment === "custom" ? round(drawer.offsetYmm) : round(dy * factors[1]);
    if (left > dx || front > dy) throw new Error(`Grid offsets exceed the excess space. Horizontal offset must be 0-${dx} mm; vertical offset must be 0-${dy} mm.`);
    const right = round(dx - left), back = round(dy - front);
    const originX = round(c + left), originY = round(c + front);
    const parts = [
        { id: "left", x: c, y: c, width: left, depth: round(drawer.depthMm - 2 * c) },
        { id: "right", x: round(originX + gridWidthMm), y: c, width: right, depth: round(drawer.depthMm - 2 * c) },
        { id: "front", x: originX, y: c, width: gridWidthMm, depth: front },
        { id: "back", x: originX, y: round(originY + gridDepthMm), width: gridWidthMm, depth: back },
    ];
    const excess = parts.filter(part => part.width > 0 && part.depth > 0).map(part => ({ ...part, height: plate.heightMm }));
    const marginMode = drawer.spacers ? drawer.margin ?? "separate" : "empty";
    return {
        widthMm: drawer.widthMm, depthMm: drawer.depthMm, gridWidthMm, gridDepthMm, originX, originY,
        gaps: { left, right, front, back },
        spacers: marginMode === "separate" ? excess : [],
        excess, marginParts: marginMode === "empty" ? [] : excess, marginMode,
        heightMm: plate.heightMm, floorMm: plate.floorMm,
    };
}
