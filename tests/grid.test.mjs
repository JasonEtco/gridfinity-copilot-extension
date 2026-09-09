import test from "node:test";
import assert from "node:assert/strict";
import { ALEX_DRAWER, drawerFromMeasurements, fitDrawer, gridFrame, layoutSizingOperations } from "../.github/extensions/gridfinity-builder/grid.mjs";
import { newDesign, applyOperations, importLayout, metrics } from "../.github/extensions/gridfinity-builder/model.mjs";
import { exportScad } from "../.github/extensions/gridfinity-builder/geometry.mjs";
import { createSceneGeometry, applySceneMode } from "../.github/extensions/gridfinity-builder/scene-geometry.mjs";
import * as THREE from "../.github/extensions/gridfinity-builder/vendor/three.mjs";

const drawer = { widthMm: 300, depthMm: 430, clearanceMm: 0.5, alignment: "center", spacers: true };
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.depth && a.y + a.depth > b.y;

test("drawer fitting keeps the standard pitch and fills only leftover space", () => {
    const grid = fitDrawer(drawer);
    assert.equal(grid.columns, 7);
    assert.equal(grid.rows, 10);
    const frame = gridFrame(grid);
    assert.deepEqual(frame.gaps, { left: 2.5, right: 2.5, front: 4.5, back: 4.5 });
    assert.equal(frame.originX, 3);
    assert.equal(frame.originY, 5);
    assert.equal(frame.gridWidthMm, 294);
    assert.equal(frame.gridDepthMm, 420);
    assert.equal(frame.spacers.length, 4);
    const gridPart = { x: frame.originX, y: frame.originY, width: frame.gridWidthMm, depth: frame.gridDepthMm };
    for (const a of frame.spacers) {
        assert.ok(!overlap(a, gridPart));
        assert.ok(a.x >= 0.5 && a.y >= 0.5);
        assert.ok(a.x + a.width <= 299.5 && a.y + a.depth <= 429.5);
        for (const b of frame.spacers) if (a !== b) assert.ok(!overlap(a, b));
    }
    assert.equal(frame.spacers.reduce((sum, part) => sum + part.width * part.depth, 294 * 420), 299 * 429);
});

test("exact fits, corner alignment and empty edge space have explicit behavior", () => {
    const exact = gridFrame(fitDrawer({ ...drawer, widthMm: 253, depthMm: 169 }));
    assert.equal(exact.spacers.length, 0);
    const corner = gridFrame(fitDrawer({ ...drawer, alignment: "front-left" }));
    assert.equal(corner.originX, 0.5);
    assert.equal(corner.originY, 0.5);
    assert.deepEqual(corner.gaps, { left: 0, right: 5, front: 0, back: 9 });
    assert.equal(corner.spacers.length, 2);
    const empty = gridFrame(fitDrawer({ ...drawer, spacers: false }));
    assert.equal(empty.spacers.length, 0);
    assert.deepEqual(empty.gaps, { left: 2.5, right: 2.5, front: 4.5, back: 4.5 });
});

test("invalid drawer sizes and failed fitting leave all existing work intact", () => {
    const original = applyOperations(newDesign("drawer"), 0, [{
        type: "add_bin",
        bin: { id: "edge", label: "Edge bin", x: 5, y: 0, width: 1, depth: 1, height: 3, rotation: 0, color: "blue" },
    }]);
    assert.throws(() => applyOperations(original, 1, [
        { type: "rename", name: "Must not save" },
        { type: "fit_drawer", drawer: { ...drawer, widthMm: 127 } },
    ]), /outside/);
    assert.equal(original.name, "Workbench");
    assert.equal(original.grid.columns, 6);
    assert.equal(original.bins.length, 1);
    for (const bad of [{ widthMm: 42 }, { widthMm: Infinity }, { depthMm: "430" }, { clearanceMm: -1 }, { alignment: "diagonal" }, { spacers: "yes" }, { widthMm: 2000 }]) {
        assert.throws(() => fitDrawer({ ...drawer, ...bad }));
    }
});

test("alignment presets and custom offsets place excess on the chosen edges", () => {
    const dimensions = { widthMm: 116, depthMm: 140, clearanceMm: 0, spacers: true };
    assert.deepEqual(gridFrame(fitDrawer({ ...dimensions, alignment: "front-left" })).gaps, { left: 0, right: 32, front: 0, back: 14 });
    assert.deepEqual(gridFrame(fitDrawer({ ...dimensions, alignment: "back-right" })).gaps, { left: 32, right: 0, front: 14, back: 0 });
    assert.deepEqual(gridFrame(fitDrawer({ ...dimensions, alignment: "center" })).gaps, { left: 16, right: 16, front: 7, back: 7 });
    const custom = { ...dimensions, alignment: "custom", offsetXmm: 5.5, offsetYmm: 4 };
    assert.deepEqual(gridFrame(fitDrawer(custom)).gaps, { left: 5.5, right: 26.5, front: 4, back: 10 });
    assert.throws(() => gridFrame(fitDrawer({ ...custom, offsetXmm: 33 })), /exceed/);
    assert.throws(() => fitDrawer({ ...dimensions, alignment: "custom" }), /offsets/);
});

test("integrated excess exports with an open-frame baseplate and stays visible in 3D", () => {
    let design = applyOperations(newDesign("integrated"), 0, [
        { type: "set_baseplate", baseplate: { type: "frame", floorMm: 2 } },
        { type: "fit_drawer", drawer: { widthMm: 116, depthMm: 126, clearanceMm: 0, alignment: "front-left", spacers: true, margin: "integrated" } },
    ]);
    const frame = gridFrame(design.grid);
    assert.equal(frame.heightMm, 5);
    assert.equal(frame.spacers.length, 0);
    assert.equal(frame.marginParts.length, 1);
    assert.deepEqual(frame.gaps, { left: 0, right: 32, front: 0, back: 0 });
    assert.match(exportScad(design, "baseplate"), /baseplate\(columns, rows, 0, 116, 126, 0, 0\)/);
    assert.throws(() => exportScad(design, "spacers"), /no edge spacers/);
    const scene = createSceneGeometry(design);
    const ray = new THREE.Raycaster(new THREE.Vector3(21, 21, 100), new THREE.Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(scene.baseplate.group, true).length, 0);
    ray.ray.origin.set(100, 60, 100);
    assert.equal(ray.intersectObject(scene.spacers, true)[0].point.z, 5);
    scene.dispose();
    design = applyOperations(design, 1, [{ type: "fit_drawer", drawer: { ...design.grid.drawer, widthMm: 120 } }]);
    assert.equal(design.grid.baseplate.type, "frame");
    const operations = layoutSizingOperations({ drawerEnabled: true, drawerWidthCm: 12, drawerDepthCm: 12.6, drawerClearanceMm: 0 }, design.grid.drawer);
    assert.equal(operations[0].drawer.margin, "integrated");
});

test("manual resizing preserves drawer constraints; JSON retains fit settings", () => {
    const fitted = applyOperations(newDesign("fit"), 0, [{ type: "fit_drawer", drawer }]);
    const smaller = applyOperations(fitted, 1, [{ type: "resize_grid", columns: 6, rows: 4 }]);
    assert.deepEqual(smaller.grid.drawer, drawer);
    assert.equal(metrics(smaller).drawer.spacers.length, 4);
    assert.throws(() => applyOperations(fitted, 1, [{ type: "resize_grid", columns: 8, rows: 10 }]), /larger/);
    assert.deepEqual(importLayout(newDesign("copy"), 0, JSON.parse(JSON.stringify(fitted))).grid, fitted.grid);
    const plain = applyOperations(fitted, 1, [{ type: "clear_drawer" }, { type: "resize_grid", columns: 8, rows: 10 }]);
    assert.equal(plain.grid.drawer, undefined);
    assert.equal(plain.grid.columns, 8);
});

test("spacer fabrication output and 3D layout use the same dimensions", () => {
    const fitted = applyOperations(newDesign("spacers"), 0, [{ type: "fit_drawer", drawer }]);
    const scad = exportScad(fitted, "spacers");
    assert.match(scad, /cube\(\[2.5, 429, 7\]\)/);
    assert.match(scad, /cube\(\[294, 4.5, 7\]\)/);
    assert.throws(() => exportScad(newDesign("plain", "Workbench", { columns: 6, rows: 4 }), "spacers"), /no edge spacers/);
    const scene = createSceneGeometry(fitted);
    assert.equal(scene.spacers.children.length, 4);
    assert.equal(scene.baseplate.group.position.x, 3);
    assert.equal(scene.baseplate.group.position.y, 5);
    assert.equal(scene.bounds.max.x, 300);
    assert.equal(scene.bounds.max.y, 430);
    const bounds = new THREE.Box3().setFromObject(scene.spacers);
    assert.equal(bounds.min.x, 0.5);
    assert.equal(bounds.max.x, 299.5);
    applySceneMode(scene, "selected", null);
    assert.equal(scene.spacers.visible, false);
    scene.dispose();
});

test("20 cm square becomes four by four cells with measured edge spacers", () => {
    const measurements = drawerFromMeasurements({ width: 20, depth: 20, unit: "cm" });
    assert.equal(measurements.widthMm, 200);
    assert.equal(measurements.depthMm, 200);
    const grid = fitDrawer(measurements);
    assert.equal(grid.columns, 4);
    assert.equal(grid.rows, 4);
    assert.deepEqual(gridFrame(grid).gaps, { left: 15.5, right: 15.5, front: 15.5, back: 15.5 });
    assert.deepEqual(measurements, drawerFromMeasurements({ width: 200, depth: 200, unit: "mm" }));
    for (const bad of [{ unit: "in" }, { width: NaN }, { width: 2 }, { depth: Infinity }]) {
        assert.throws(() => drawerFromMeasurements({ width: 20, depth: 20, unit: "cm", ...bad }));
    }
});

test("new designs use the measured ALEX preset without sharing mutable defaults", () => {
    const first = newDesign("alex-one");
    const second = newDesign("alex-two");
    assert.deepEqual(first.grid, fitDrawer(ALEX_DRAWER));
    assert.equal(first.grid.columns, 6);
    assert.equal(first.grid.rows, 12);
    assert.deepEqual(gridFrame(first.grid).gaps, { left: 19.5, right: 19.5, front: 9.5, back: 9.5 });
    first.grid.drawer.widthMm = 300;
    assert.equal(second.grid.drawer.widthMm, 292);
    const legacy = newDesign("old", "Old layout", { columns: 6, rows: 4 });
    assert.deepEqual(importLayout(second, 0, legacy).grid, { columns: 6, rows: 4 });
});

test("drawer dimensions can repair a pending grid resize in one atomic edit", () => {
    const small = { widthMm: 200, depthMm: 200, clearanceMm: 0.5, alignment: "front-left", spacers: false };
    const design = applyOperations(newDesign("resize-recovery"), 0, [
        { type: "fit_drawer", drawer: small },
        { type: "add_bin", bin: { id: "keep", label: "Keep", x: 0, y: 0, width: 3, depth: 2, height: 3, rotation: 0, color: "blue" } },
    ]);
    assert.throws(() => applyOperations(design, 1, [{ type: "resize_grid", columns: 8, rows: 4 }]), /33\.7 by 16\.9 cm/);
    const repaired = applyOperations(design, 1, [
        { type: "resize_grid", columns: 8, rows: 4 },
        { type: "set_drawer", drawer: { ...small, widthMm: 350 } },
    ]);
    assert.equal(repaired.grid.columns, 8);
    assert.equal(repaired.grid.rows, 4);
    assert.equal(repaired.grid.drawer.widthMm, 350);
    assert.equal(repaired.grid.drawer.alignment, "front-left");
    assert.equal(repaired.grid.drawer.spacers, false);
    assert.deepEqual(repaired.bins, design.bins);
    assert.equal(design.grid.columns, 4);
    assert.equal(design.grid.drawer.widthMm, 200);
    assert.throws(() => applyOperations(repaired, 2, [{ type: "set_drawer", drawer: small }]), /larger/);
    assert.throws(() => applyOperations(repaired, 2, [{ type: "set_drawer", drawer: null }]), /object/);
    const noLimit = applyOperations(repaired, 2, [{ type: "clear_drawer" }, { type: "resize_grid", columns: 9, rows: 4 }]);
    assert.equal(noLimit.grid.columns, 9);
    assert.equal(noLimit.grid.drawer, undefined);
});

test("automatic Layout sizing derives cells instead of restoring stale manual counts", () => {
    const previous = { widthMm: 200, depthMm: 200, clearanceMm: 0.5, alignment: "front-left", spacers: false };
    const fields = {
        drawerEnabled: true, drawerWidthCm: 30, drawerDepthCm: 20, drawerClearanceMm: 0.5,
        columns: 4, rows: 4,
    };
    const operations = layoutSizingOperations(fields, previous);
    assert.deepEqual(operations, [{ type: "fit_drawer", drawer: { ...previous, widthMm: 300 } }]);
    const result = applyOperations(newDesign("automatic"), 0, operations);
    assert.equal(result.grid.columns, 7);
    assert.equal(result.grid.rows, 4);
    assert.equal(result.grid.drawer.alignment, "front-left");
    assert.equal(result.grid.drawer.spacers, false);
    const cleared = applyOperations(result, 1, layoutSizingOperations({ ...fields, drawerEnabled: false, columns: 8, rows: 5 }, result.grid.drawer));
    assert.deepEqual(cleared.grid, { columns: 8, rows: 5 });
});

test("automatic sizing responds to clearance and rejects bin loss on shrink", () => {
    const fields = { drawerEnabled: true, drawerWidthCm: 29.5, drawerDepthCm: 20, drawerClearanceMm: 0.5, columns: 1, rows: 1 };
    const original = applyOperations(newDesign("automatic-clearance"), 0, [
        ...layoutSizingOperations(fields),
        { type: "add_bin", bin: { id: "edge", label: "Edge", x: 6, y: 0, width: 1, depth: 1, height: 3, rotation: 0, color: "blue" } },
    ]);
    assert.equal(original.grid.columns, 7);
    assert.throws(() => applyOperations(original, 1, layoutSizingOperations({ ...fields, drawerClearanceMm: 1 }, original.grid.drawer)), /outside/);
    assert.equal(original.grid.columns, 7);
    assert.equal(original.bins.length, 1);
});
