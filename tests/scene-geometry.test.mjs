import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../.github/extensions/gridfinity-builder/vendor/three.mjs";
import { createSceneGeometry, getBinPlacement, applySceneMode, getViewBounds } from "../.github/extensions/gridfinity-builder/scene-geometry.mjs";
import { newDesign as createDesign, applyOperations } from "../.github/extensions/gridfinity-builder/model.mjs";

const newDesign = id => createDesign(id, "Workbench", { columns: 6, rows: 4 });

const add = (bin) => ({ type: "add_bin", bin });
const bin = (changes = {}) => ({
    id: "bin-a",
    label: "Driver bits",
    x: 0,
    y: 0,
    width: 1,
    depth: 1,
    height: 3,
    rotation: 0,
    color: "blue",
    ...changes,
});

function pointBounds(box) {
    return {
        minX: round(box.min.x), maxX: round(box.max.x),
        minY: round(box.min.y), maxY: round(box.max.y),
        minZ: round(box.min.z), maxZ: round(box.max.z),
    };
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

function castDown(object, x, y, z = 120) {
    object.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, -1));
    return raycaster.intersectObject(object, true)[0];
}

test("single-cell bins keep the 0.25 mm inset and full height", () => {
    const design = applyOperations(newDesign("single"), 0, [add(bin())]);
    const sceneData = createSceneGeometry(design);
    const bounds = pointBounds(new THREE.Box3().setFromObject(sceneData.bins.get("bin-a").group));
    assert.deepEqual(bounds, {
        minX: 0.25,
        maxX: 41.75,
        minY: 0.25,
        maxY: 41.75,
        minZ: 2,
        maxZ: 23,
    });
    sceneData.dispose();
});

test("rotated bins pivot inside their footprint instead of spilling into neighbors", () => {
    const design = applyOperations(newDesign("rotated"), 0, [
        add(bin({ x: 1, y: 2, width: 2, depth: 1, rotation: 90 })),
    ]);
    const placement = getBinPlacement(design.bins[0]);
    assert.equal(placement.widthMm, 41.5);
    assert.equal(placement.depthMm, 83.5);

    const sceneData = createSceneGeometry(design);
    const bounds = pointBounds(new THREE.Box3().setFromObject(sceneData.bins.get("bin-a").group));
    assert.deepEqual(bounds, {
        minX: 42.25,
        maxX: 83.75,
        minY: 84.25,
        maxY: 167.75,
        minZ: 2,
        maxZ: 23,
    });
    sceneData.dispose();
});

test("baseplates occupy the full grid footprint and expose recessed socket floors", () => {
    const design = applyOperations(newDesign("plate"), 0, [add(bin({ x: 1, y: 0 }))]);
    const resized = applyOperations(design, 1, [{ type: "resize_grid", columns: 3, rows: 2 }]);
    const sceneData = createSceneGeometry(resized);
    const bounds = pointBounds(sceneData.baseplate.bounds);
    assert.deepEqual(bounds, {
        minX: 0,
        maxX: 126,
        minY: 0,
        maxY: 84,
        minZ: 0,
        maxZ: 7,
    });
    assert.equal(round(castDown(sceneData.baseplate.group, 21, 21).point.z), 2);
    assert.equal(round(castDown(sceneData.baseplate.group, 63, 21).point.z), 2);
    assert.equal(round(castDown(sceneData.baseplate.group, 42, 42).point.z), 7);
    assert.equal(round(castDown(sceneData.baseplate.group, 41.5, 41.5).point.z), 7);
    assert.equal(castDown(sceneData.baseplate.group, 0.1, 0.1), undefined);
    sceneData.dispose();
});

test("inlay bins stay solid outside the recess and drop only inside the outline", () => {
    const design = applyOperations(newDesign("inlay-preview"), 0, [
        add(bin({
            height: 4,
            inlay: {
                outline: [[10, 10], [28, 10], [28, 24], [10, 24]],
                depth: 8,
                clearance: 0.5,
            },
        })),
    ]);
    const sceneData = createSceneGeometry(design);
    const inlayHit = castDown(sceneData.bins.get("bin-a").group, 15.25, 15.25);
    const solidHit = castDown(sceneData.bins.get("bin-a").group, 34.25, 34.25);
    assert.equal(round(inlayHit.point.z), 22);
    assert.equal(round(solidHit.point.z), 30);
    sceneData.dispose();
});

test("selected mode places the bin on Z=0 and layout mode seats it on the plate floor", () => {
    const data = createSceneGeometry(applyOperations(newDesign("modes"), 0, [add(bin())]));
    applySceneMode(data, "selected", "bin-a");
    assert.equal(new THREE.Box3().setFromObject(data.bins.get("bin-a").group).min.z, 0);
    assert.equal(getViewBounds(data, "selected", "bin-a").max.z, 21);
    assert.equal(data.baseplate.group.visible, false);
    applySceneMode(data, "layout", "bin-a");
    assert.equal(new THREE.Box3().setFromObject(data.bins.get("bin-a").group).min.z, 2);
    assert.equal(data.baseplate.group.visible, true);
    data.dispose();
});

test("equal inlay outlines with different heights have independent pocket elevations", () => {
    const inlay = { outline: [[8, 8], [30, 8], [30, 30], [8, 30]], depth: 8, clearance: 0.5 };
    const data = createSceneGeometry(applyOperations(newDesign("inlay-cache"), 0, [
        add(bin({ inlay, height: 3 })),
        add(bin({ id: "tall", x: 1, inlay, height: 5 })),
    ]));
    assert.equal(round(castDown(data.bins.get("bin-a").group, 20, 20).point.z), 15);
    assert.equal(round(castDown(data.bins.get("tall").group, 62, 20).point.z), 29);
    assert.equal(round(castDown(data.bins.get("tall").group, 78, 36).point.z), 37);
    data.dispose();
});

test("hollow bins keep rounded openings and outward foot surfaces", () => {
    const data = createSceneGeometry(applyOperations(newDesign("surfaces"), 0, [add(bin())]));
    const group = data.bins.get("bin-a").group;
    assert.equal(round(castDown(group, 21, 21).point.z), 7.95);
    assert.equal(round(castDown(group, 1, 21).point.z), 23);
    const sideRay = new THREE.Raycaster(new THREE.Vector3(-5, 21, 3), new THREE.Vector3(1, 0, 0));
    assert.ok(sideRay.intersectObject(group, true).length > 0);
    group.traverse(object => {
        const normals = object.geometry?.getAttribute("normal");
        if (normals) assert.ok([...normals.array].every(Number.isFinite));
    });
    data.dispose();
});
