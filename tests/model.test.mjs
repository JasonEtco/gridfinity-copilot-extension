import test from "node:test";
import assert from "node:assert/strict";
import { applyOperations, newDesign, validateDesign, metrics, importLayout } from "../.github/extensions/gridfinity-builder/model.mjs";
import { exportScad, GEOMETRY } from "../.github/extensions/gridfinity-builder/geometry.mjs";

const bin = (changes = {}) => ({ id: "bin-a", label: "Screws", x: 0, y: 0, width: 2, depth: 1, height: 3, rotation: 0, color: "blue", ...changes });
const add = value => ({ type: "add_bin", bin: value });

test("dimensions, rotation and occupancy use the Gridfinity units", () => {
    const design = applyOperations(newDesign("dimensions", "Workbench", { columns: 6, rows: 4 }), 0, [add(bin({ rotation: 90 }))]);
    assert.deepEqual(metrics(design), {
        widthMm: 252, depthMm: 168, totalCells: 24, occupiedCells: 2, freeCells: 22, occupancyPercent: 8,
        bins: [{ id: "bin-a", widthMm: 41.5, depthMm: 83.5, heightMm: 21 }],
    });
});

test("overlap and boundary failures roll back every edit", () => {
    const original = applyOperations(newDesign("atomic", "Workbench", { columns: 6, rows: 4 }), 0, [add(bin())]);
    const before = structuredClone(original);
    for (const operations of [
        [{ type: "rename", name: "Not saved" }, add(bin({ id: "other", x: 1 }))],
        [{ type: "resize_grid", columns: 1, rows: 1 }],
        [{ type: "update_bin", id: "bin-a", changes: { x: 5 } }],
        [{ type: "update_bin", id: "bin-a", changes: { y: 3, rotation: 90 } }],
    ]) {
        assert.throws(() => applyOperations(original, 1, operations), /overlaps|outside/);
        assert.deepEqual(original, before);
    }
});

test("final-state validation allows atomic swaps and edge-adjacent bins", () => {
    const design = applyOperations(newDesign("swap"), 0, [add(bin()), add(bin({ id: "bin-b", x: 2 }))]);
    const next = applyOperations(design, 1, [
        { type: "update_bin", id: "bin-a", changes: { x: 2 } },
        { type: "update_bin", id: "bin-b", changes: { x: 0 } },
    ]);
    assert.equal(next.bins[0].x, 2);
    assert.equal(next.revision, 2);
});

test("duplicate, rotate, remove, rename and clear are transactional", () => {
    let design = applyOperations(newDesign("ops"), 0, [add(bin())]);
    design = applyOperations(design, 1, [{ type: "duplicate_bin", id: "bin-a", newId: "bin-b", x: 2, y: 1 }]);
    design = applyOperations(design, 2, [
        { type: "update_bin", id: "bin-b", changes: { rotation: 90 } },
        { type: "remove_bin", id: "bin-a" },
        { type: "rename", name: "Fasteners" },
    ]);
    assert.equal(design.bins.length, 1);
    assert.equal(design.name, "Fasteners");
    assert.equal(design.bins[0].rotation, 90);
    assert.equal(applyOperations(design, 3, [{ type: "clear_bins" }]).bins.length, 0);
});

test("invalid fields and dimensions never become saved designs", () => {
    for (const changes of [{ x: -1 }, { depth: 1.5 }, { height: 0 }, { width: "2" }, { rotation: 180 }, { color: "red" }, { id: "../escape" }, { label: "" }, { extra: true }]) {
        assert.throws(() => applyOperations(newDesign("invalid"), 0, [add(bin(changes))]));
    }
    assert.throws(() => applyOperations(newDesign("invalid"), 2, [add(bin())]), /changed/);
    assert.throws(() => applyOperations(newDesign("invalid"), 0, [add(bin()), add(bin())]), /Duplicate/);
    assert.throws(() => applyOperations(newDesign("invalid"), 0, [{ type: "update_bin", id: "missing", changes: {} }]), /not found/);
    assert.throws(() => applyOperations(newDesign("invalid"), 0, [{ type: "unknown" }]), /Unknown/);
    assert.throws(() => validateDesign({ ...newDesign("bad"), version: 2 }), /version/);
});

test("JSON round trip validates input and preserves current document identity", () => {
    const source = applyOperations(newDesign("source"), 0, [add(bin())]);
    const imported = importLayout(newDesign("target"), 0, JSON.parse(JSON.stringify(source)));
    assert.equal(imported.designId, "target");
    assert.equal(imported.revision, 1);
    assert.deepEqual(imported.bins, source.bins);
    source.bins[0].x = 20;
    assert.equal(imported.bins[0].x, 0);
    assert.throws(() => importLayout(imported, 0, imported), /changed/);
    assert.throws(() => importLayout(imported, 1, source), /outside/);
});

test("SCAD exports measured profiles, exact cells and honest fabrication limits", () => {
    const design = applyOperations(newDesign("export"), 0, [add(bin({ label: '"); malicious(); //', rotation: 90 }))]);
    const plate = exportScad(design);
    const bins = exportScad(design, "bins");
    assert.match(plate, /pitch = 42;/);
    assert.match(plate, /columns = 6;/);
    assert.match(plate, /baseplate\(columns, rows\);/);
    assert.match(bins, /bin\(1, 2, 3\);/);
    assert.match(bins, /Not certified print-ready/);
    assert.ok(!bins.includes("malicious"));
    assert.equal(GEOMETRY.footSections.at(-1)[0], 4.75);
    assert.equal(GEOMETRY.socketSections.at(-1)[0], 4.65);
    assert.equal(GEOMETRY.plateFloor + GEOMETRY.socketRelief + 4.65, 7);
    assert.match(exportScad(design, "bin", "bin-a"), /translate\(\[0\*pitch, 0\*pitch/);
    assert.throws(() => exportScad(design, "bin", "missing"), /existing/);
    assert.throws(() => exportScad(newDesign("empty"), "bins"), /Add a bin/);
    assert.throws(() => exportScad(design, "stl"), /SCAD part/);
});
