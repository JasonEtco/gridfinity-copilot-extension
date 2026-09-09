import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FabricationService } from "../.github/extensions/gridfinity-builder/fabrication.mjs";
import { newDesign, applyOperations } from "../.github/extensions/gridfinity-builder/model.mjs";

function inspectMesh(bytes) {
    const triangles = [];
    if (bytes.length >= 84 && bytes.length === 84 + 50 * bytes.readUInt32LE(80)) {
        for (let i = 84; i < bytes.length; i += 50) {
            triangles.push([0, 1, 2].map(v => [0, 1, 2].map(axis => bytes.readFloatLE(i + 12 + 12 * v + 4 * axis))));
        }
    } else {
        const vertices = [...bytes.toString().matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].map(match => match.slice(1).map(Number));
        assert.equal(vertices.length % 3, 0);
        for (let i = 0; i < vertices.length; i += 3) triangles.push(vertices.slice(i, i + 3));
    }
    assert.ok(triangles.length > 0);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const edges = new Map();
    let volume = 0;
    for (const triangle of triangles) {
        for (const point of triangle) for (let axis = 0; axis < 3; axis++) {
            assert.ok(Number.isFinite(point[axis]));
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
        }
        for (let i = 0; i < 3; i++) {
            const key = [triangle[i], triangle[(i + 1) % 3]].map(point => point.map(value => Math.round(value * 1e5)).join(",")).sort().join("|");
            edges.set(key, (edges.get(key) || 0) + 1);
        }
        const [a, b, c] = triangle;
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    assert.ok([...edges.values()].every(count => count === 2), "Every mesh edge must have exactly two faces");
    assert.ok(volume > 0, "The mesh must have positive volume");
    return { min, max, volume };
}

test("installed OpenSCAD renders closed bin, inlay, grid and spacer meshes", { timeout: 180000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), "gridfinity-cad-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const service = new FabricationService({ artifactRoot: root });
    if (!(await service.status()).stl) {
        t.skip("Install OpenSCAD to run real fabrication integration checks.");
        return;
    }
    let design = applyOperations(newDesign("render"), 0, [
        { type: "resize_grid", columns: 1, rows: 1 },
        { type: "add_bin", bin: { id: "bin", label: "Test bin", x: 0, y: 0, width: 1, depth: 1, height: 3, rotation: 0, color: "blue" } },
    ]);
    const bin = inspectMesh((await service.render(design, { part: "bin", binId: "bin" })).content);
    assert.deepEqual(bin.min, [0.25, 0.25, 0]);
    assert.deepEqual(bin.max, [41.75, 41.75, 21]);
    const plate = inspectMesh((await service.render(design, { part: "baseplate" })).content);
    assert.deepEqual(plate.min, [0, 0, 0]);
    assert.deepEqual(plate.max, [42, 42, 7]);
    design = applyOperations(design, 1, [{ type: "update_bin", id: "bin", changes: { inlay: {
        outline: [[6, 6], [30, 6], [30, 20], [6, 20]], depth: 8, clearance: 0.5,
    } } }]);
    const inlay = inspectMesh((await service.render(design, { part: "bin", binId: "bin" })).content);
    assert.equal(inlay.max[2], 21);
    assert.ok(inlay.volume > bin.volume);
    design = applyOperations(design, 2, [{ type: "fit_drawer", drawer: {
        widthMm: 50, depthMm: 55, clearanceMm: 0.5, alignment: "center", spacers: true,
    } }]);
    const spacers = inspectMesh((await service.render(design, { part: "spacers" })).content);
    assert.equal(spacers.max[2], 7);
    design = applyOperations(design, 3, [
        { type: "set_baseplate", baseplate: { type: "frame", floorMm: 2 } },
        { type: "fit_drawer", drawer: { widthMm: 116, depthMm: 126, clearanceMm: 0, alignment: "front-left", spacers: true, margin: "integrated" } },
    ]);
    const integrated = inspectMesh((await service.render(design, { part: "baseplate" })).content);
    assert.deepEqual(integrated.min, [0, 0, 0]);
    assert.deepEqual(integrated.max, [116, 126, 5]);
    const configured = applyOperations(newDesign("configured-stl", "Configured", { columns: 2, rows: 2 }), 0, [{
        type: "add_bin",
        bin: { id: "parts", label: "Parts organizer", x: 0, y: 0, width: 2, depth: 2, height: 4, rotation: 0, color: "teal",
            options: { divisionsX: 2, divisionsY: 2, wallMm: 1.4, floorMm: 1.4, stackingLip: true,
                labelPosition: "full", labelDepthMm: 6, scoopRadiusMm: 4, magnetHoles: true, screwHoles: true } },
    }]);
    const configuredMesh = inspectMesh((await service.render(configured, { part: "bin", binId: "parts" })).content);
    assert.ok(Math.abs(configuredMesh.max[2] - 32.4) < 1e-4);
    for (const [id, height, options, inlay] of [
        ["thick-lip", 3, { wallMm: 2.6, stackingLip: true }, undefined],
        ["short-lip", 1, { wallMm: 0.8, floorMm: 0.8, stackingLip: true }, undefined],
        ["solid-recess", 3, { solid: true, stackingLip: true, floorMm: 2, screwHoles: true, screwDepthMm: 6 },
            { outline: [[8, 8], [30, 8], [30, 25], [8, 25]], depth: 5, clearance: 0.5 }],
    ]) {
        const sample = applyOperations(newDesign(id, id, { columns: 1, rows: 1 }), 0, [{
            type: "add_bin", bin: { id, label: id, x: 0, y: 0, width: 1, depth: 1, height, rotation: 0, color: "blue", options, ...(inlay ? { inlay } : {}) },
        }]);
        const mesh = inspectMesh((await service.render(sample, { part: "bin", binId: id })).content);
        assert.ok(Math.abs(mesh.max[2] - (height * 7 + 4.4)) < 1e-4);
    }
});
