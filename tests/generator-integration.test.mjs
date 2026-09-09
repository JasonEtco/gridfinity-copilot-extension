import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../.github/extensions/gridfinity-builder/vendor/three.mjs";
import { newDesign, applyOperations, metrics, importLayout } from "../.github/extensions/gridfinity-builder/model.mjs";
import { createSceneGeometry, applySceneMode } from "../.github/extensions/gridfinity-builder/scene-geometry.mjs";
import { exportScad } from "../.github/extensions/gridfinity-builder/geometry.mjs";

const bin = {
    id: "configured", label: "Parts", x: 0, y: 0, width: 2, depth: 2, height: 4, rotation: 0, color: "teal",
    options: { wallMm: 1.4, floorMm: 1.4, divisionsX: 2, divisionsY: 2, dividerMm: 1.2, stackingLip: true,
        labelPosition: "full", labelDepthMm: 6, scoopRadiusMm: 4, magnetHoles: true, screwHoles: true },
};

test("configured bins survive transactions and JSON with matching preview dimensions", () => {
    const design = applyOperations(newDesign("configured", "Parts", { columns: 2, rows: 2 }), 0, [{ type: "add_bin", bin }]);
    const size = metrics(design).bins[0];
    assert.equal(size.heightMm, 32.4);
    assert.equal(size.widthMm, 83.5);
    assert.deepEqual(importLayout(newDesign("imported"), 0, JSON.parse(JSON.stringify(design))).bins[0].options, bin.options);
    const scene = createSceneGeometry(design);
    applySceneMode(scene, "selected", bin.id);
    const bounds = new THREE.Box3().setFromObject(scene.bins.get(bin.id).group);
    assert.ok(Math.abs(bounds.min.z) < 1e-5);
    assert.ok(Math.abs(bounds.max.z - size.heightMm) < 1e-4);
    assert.ok(Math.abs(bounds.max.x - bounds.min.x - size.widthMm) < 1e-4);
    scene.dispose();
    const scad = exportScad(design, "bin", bin.id);
    assert.match(scad, /configured_bin/);
    assert.ok(!scad.includes('label: "Parts"'));
});

test("invalid construction edits and incompatible photo recesses do not replace work", () => {
    const design = applyOperations(newDesign("guarded"), 0, [{ type: "add_bin", bin }]);
    assert.throws(() => applyOperations(design, 1, [{ type: "update_bin", id: bin.id, changes: { options: { wallMm: -1 } } }]));
    assert.throws(() => applyOperations(design, 1, [{ type: "update_bin", id: bin.id, changes: { inlay: {
        outline: [[10, 10], [30, 10], [30, 25], [10, 25]], depth: 10, clearance: 0.5,
    } } }]), /compartment|inlay|recess/i);
    assert.equal(design.revision, 1);
    assert.deepEqual(design.bins[0].options, bin.options);
});

test("rotated configured bins keep their footprint and construction settings", () => {
    const design = applyOperations(newDesign("rotation", "Rotated", { columns: 2, rows: 3 }), 0, [
        { type: "add_bin", bin: { ...bin, width: 3, depth: 2, rotation: 90 } },
    ]);
    const scene = createSceneGeometry(design);
    const bounds = new THREE.Box3().setFromObject(scene.bins.get(bin.id).group);
    assert.ok(Math.abs(bounds.max.x - bounds.min.x - 83.5) < 1e-4);
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - 125.5) < 1e-4);
    scene.dispose();
    assert.match(exportScad(design, "bin", bin.id), /translate\(\[84, 0, 0\]\) rotate\(\[0,0,90\]\)/);
});
