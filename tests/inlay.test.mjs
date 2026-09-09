import test from "node:test";
import assert from "node:assert/strict";
import { bounds, expandedOutline, outlineFromPhoto, validateOutline, validateInlay } from "../.github/extensions/gridfinity-builder/inlay.mjs";
import { newDesign, applyOperations, importLayout } from "../.github/extensions/gridfinity-builder/model.mjs";
import { exportScad } from "../.github/extensions/gridfinity-builder/geometry.mjs";
import { agentState } from "../.github/extensions/gridfinity-builder/workbench.mjs";
import { photo } from "./photo-fixture.mjs";

const bin = { id: "item", label: "Item", x: 0, y: 0, width: 1, depth: 1, height: 3, rotation: 0, color: "teal" };
const inlay = { outline: [[8, 6], [30, 6], [30, 20], [8, 20]], depth: 10, clearance: 0.5 };

test("a photo outline uses measured width and keeps its aspect ratio", () => {
    const outline = outlineFromPhoto([[10, 20], [210, 20], [210, 120], [10, 120]], 30, bin);
    assert.deepEqual(bounds(outline), { minX: 5.75, maxX: 35.75, minY: 13.25, maxY: 28.25 });
    assert.deepEqual(bounds(outlineFromPhoto([[0, 0], [200, 0], [200, 100], [0, 100]], 30, bin, 50, 40)),
        { minX: 35, maxX: 65, minY: 32.5, maxY: 47.5 });
    assert.throws(() => outlineFromPhoto(inlay.outline, 0, bin), /measured/);
});

test("clearance expands both winding directions and handles a concave silhouette", () => {
    const result = expandedOutline(inlay);
    assert.deepEqual(bounds(result), { minX: 7.5, maxX: 30.5, minY: 5.5, maxY: 20.5 });
    assert.deepEqual(bounds(expandedOutline({ ...inlay, outline: [...inlay.outline].reverse() })), bounds(result));
    assert.ok(result.length > inlay.outline.length);
    const concave = { ...inlay, outline: [[5, 5], [30, 5], [30, 12], [15, 12], [15, 30], [5, 30]] };
    validateInlay(concave, bin);
    assert.deepEqual(bounds(expandedOutline(concave)), { minX: 4.5, maxX: 30.5, minY: 4.5, maxY: 30.5 });
    assert.deepEqual(expandedOutline({ ...inlay, clearance: 0 }), inlay.outline);
});

test("invalid and self-crossing outlines never reach geometry", () => {
    for (const points of [
        [], [[0, 0], [1, 1]],
        [[0, 0], [10, 10], [0, 10], [10, 0]],
        [[0, 0], [10, 0], [10, 0], [0, 10]],
        [[0, 0], [10, 0], [-10, 0], [0, 10]],
        [[0, 0], [Infinity, 10], [0, 10]],
    ]) assert.throws(() => validateOutline(points));
    assert.throws(() => expandedOutline({ ...inlay, clearance: -1 }), /Clearance/);
    assert.throws(() => expandedOutline({ ...inlay, clearance: 4 }), /Clearance/);
});

test("inlay walls, rounded corners and floor are enforced atomically", () => {
    const original = applyOperations(newDesign("inlay"), 0, [{ type: "add_bin", bin }]);
    for (const bad of [
        { ...inlay, depth: 16 },
        { ...inlay, depth: 0 },
        { ...inlay, outline: [[0.5, 8], [10, 8], [10, 20], [0.5, 20]] },
        { ...inlay, outline: [[1.3, 1.3], [10, 1.3], [10, 10], [1.3, 10]], clearance: 0 },
        { ...inlay, photo: { dataUrl: "data:image/svg+xml,<svg/>" } },
        { ...inlay, extra: true },
    ]) {
        assert.throws(() => applyOperations(original, 1, [{ type: "update_bin", id: "item", changes: { inlay: bad } }]));
        assert.equal(original.revision, 1);
        assert.equal(original.bins[0].inlay, undefined);
    }
    const saved = applyOperations(original, 1, [{ type: "update_bin", id: "item", changes: { inlay } }]);
    assert.throws(() => applyOperations(saved, 2, [{ type: "update_bin", id: "item", changes: { height: 1 } }]), /depth/);
    const cleared = applyOperations(saved, 2, [{ type: "update_bin", id: "item", changes: { inlay: null } }]);
    assert.equal(cleared.bins[0].inlay, null);
    assert.equal(importLayout(newDesign("copy"), 0, JSON.parse(JSON.stringify(saved))).bins[0].inlay.depth, 10);
});

test("OpenSCAD uses the same expanded recess and rotates it with its bin", () => {
    const original = { ...bin, width: 2, rotation: 90, inlay };
    const design = applyOperations(newDesign("recess-export"), 0, [{ type: "add_bin", bin: original }]);
    const source = exportScad(design, "bin", "item");
    const rotated = expandedOutline(inlay).map(([x, y]) => [41.5 - y, x]);
    assert.ok(source.includes(`bin(1, 2, 3, ${JSON.stringify(rotated)}, 10);`));
    assert.match(source, /h-recess_depth/);
    assert.match(source, /polygon\(recess\)/);
    assert.match(source, /not 3D scans/);
});

test("agent readback omits image bytes without changing saved state", () => {
    const state = { design: { bins: [{ ...bin, inlay: { ...inlay, photo: { dataUrl: "private photo", width: 600, height: 400, itemWidthMm: 22 } } }] }, metrics: {} };
    const result = agentState(state);
    assert.equal(result.design.bins[0].inlay.photo, undefined);
    assert.deepEqual(result.photoReferences, [{ binId: "item", width: 600, height: 400, itemWidthMm: 22 }]);
    assert.equal(state.design.bins[0].inlay.photo.dataUrl, "private photo");
});

test("photo bytes and scale survive imports and agent inlay edits", () => {
    const original = applyOperations(newDesign("photo"), 0, [{ type: "add_bin", bin: { ...bin, inlay: { ...inlay, photo } } }]);
    const imported = importLayout(newDesign("photo-copy"), 0, JSON.parse(JSON.stringify(original)));
    assert.deepEqual(imported.bins[0].inlay.photo, photo);
    const edited = applyOperations(imported, 1, [{ type: "update_bin", id: "item", changes: { inlay: { ...inlay, depth: 8 } } }]);
    assert.deepEqual(edited.bins[0].inlay.photo, photo);
    assert.equal(edited.bins[0].inlay.depth, 8);
    for (const changes of [
        { width: 1201 }, { height: 3 }, { dataUrl: photo.dataUrl.slice(0, -8) },
        { points: [[0, 0], [3, 0], [0, 2]] },
        { itemWidthMm: 0 },
    ]) assert.throws(() => validateInlay({ ...inlay, photo: { ...photo, ...changes } }, bin));
});
