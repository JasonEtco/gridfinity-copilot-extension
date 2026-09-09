import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../.github/extensions/gridfinity-builder/vendor/three.mjs";
import {
    BIN_OPTION_DEFAULTS,
    BinOptionsError,
    binDimensions,
    getBinOptions,
    validateBinOptions,
} from "../.github/extensions/gridfinity-builder/bin-options.mjs";
import { createConfiguredBinMeshes } from "../.github/extensions/gridfinity-builder/bin-mesh.mjs";
import { exportScad } from "../.github/extensions/gridfinity-builder/geometry.mjs";

function wrap(meshes) {
    const group = new THREE.Group();
    group.add(...meshes);
    group.updateMatrixWorld(true);
    return group;
}

function cast(object, origin, direction) {
    object.updateMatrixWorld(true);
    return new THREE.Raycaster(origin, direction).intersectObject(object, true)[0];
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

function configuredBin(changes = {}) {
    return {
        id: "configured",
        label: "Parts",
        x: 0,
        y: 0,
        width: 2,
        depth: 2,
        height: 4,
        rotation: 0,
        color: "teal",
        ...changes,
    };
}

function basicMaterials() {
    return {
        exteriorMaterial: new THREE.MeshStandardMaterial({ color: "#6699cc" }),
        interiorMaterial: new THREE.MeshStandardMaterial({ color: "#334455" }),
        footMaterial: new THREE.MeshStandardMaterial({ color: "#223344" }),
    };
}

test("defaults merge without mutation and preserve legacy dimensions", () => {
    const raw = { wallMm: 1.4 };
    const merged = getBinOptions({ options: raw });
    assert.deepEqual(raw, { wallMm: 1.4 });
    assert.deepEqual(merged, { ...BIN_OPTION_DEFAULTS, wallMm: 1.4 });

    const dimensions = binDimensions({ width: 1, depth: 1, height: 3, options: {} });
    assert.deepEqual({
        widthMm: dimensions.widthMm,
        depthMm: dimensions.depthMm,
        bodyHeightMm: dimensions.bodyHeightMm,
        heightMm: dimensions.heightMm,
        cavityFloorMm: dimensions.cavityFloorMm,
    }, {
        widthMm: 41.5,
        depthMm: 41.5,
        bodyHeightMm: 21,
        heightMm: 21,
        cavityFloorMm: 5.95,
    });
});

test("validation rejects unknown fields, impossible compartments, and conflicting modes", () => {
    assert.throws(
        () => validateBinOptions({ width: 1, depth: 1, height: 3, options: { unknown: true } }),
        BinOptionsError,
    );
    assert.throws(
        () => validateBinOptions({ width: 1, depth: 1, height: 3, options: { solid: true, divisionsX: 2 } }),
        /Solid bins cannot also use multiple compartments/,
    );
    assert.throws(
        () => validateBinOptions({
            width: 1,
            depth: 1,
            height: 3,
            inlay: { outline: [[8, 8], [30, 8], [30, 24], [8, 24]], depth: 5, clearance: 0.5 },
            options: { scoopRadiusMm: 2 },
        }),
        /Finger scoops need a hollow compartment/,
    );
    assert.throws(
        () => validateBinOptions({ width: 1, depth: 1, height: 3, options: { divisionsX: 12, divisionsY: 12 } }),
        /less than 3 mm/,
    );
    assert.throws(
        () => validateBinOptions({ width: 1, depth: 1, height: 1, options: { screwHoles: true, screwDepthMm: 6 } }),
        /leave at least 0\.6 mm below the cavity floor/,
    );
});

test("configured hollow meshes expose compartments and bottom pockets at the expected heights", () => {
    const bin = configuredBin({
        options: {
            wallMm: 1.4,
            floorMm: 1.4,
            divisionsX: 2,
            divisionsY: 2,
            dividerMm: 1.2,
            magnetHoles: true,
            screwHoles: true,
        },
    });
    const built = createConfiguredBinMeshes(bin, basicMaterials());
    const group = wrap(built.meshes);
    const bounds = new THREE.Box3().setFromObject(group);
    assert.deepEqual({
        minX: round(bounds.min.x),
        maxX: round(bounds.max.x),
        minY: round(bounds.min.y),
        maxY: round(bounds.max.y),
        minZ: Object.is(round(bounds.min.z), -0) ? 0 : round(bounds.min.z),
        maxZ: round(bounds.max.z),
    }, {
        minX: 0,
        maxX: 83.5,
        minY: 0,
        maxY: 83.5,
        minZ: 0,
        maxZ: 28,
    });

    const compartmentHit = cast(group, new THREE.Vector3(20, 20, 80), new THREE.Vector3(0, 0, -1));
    assert.equal(round(compartmentHit.point.z), 6.15);

    const screwHit = cast(group, new THREE.Vector3(7.75, 7.75, -1), new THREE.Vector3(0, 0, 1));
    assert.equal(round(screwHit.point.z), 4);

    const magnetHit = cast(group, new THREE.Vector3(10, 7.75, -1), new THREE.Vector3(0, 0, 1));
    assert.equal(round(magnetHit.point.z), 2.4);
});

test("solid bins stay solid at the top and configured feature meshes keep finite normals", () => {
    const built = createConfiguredBinMeshes(configuredBin({
        width: 1,
        depth: 1,
        height: 3,
        options: {
            solid: true,
            stackingLip: true,
            magnetHoles: true,
            screwHoles: true,
        },
    }), basicMaterials());
    const group = wrap(built.meshes);
    const bounds = new THREE.Box3().setFromObject(group);
    assert.equal(round(bounds.max.z), 25.4);
    const topHit = cast(group, new THREE.Vector3(20, 20, 80), new THREE.Vector3(0, 0, -1));
    assert.equal(round(topHit.point.z), 21);

    group.traverse((object) => {
        const positions = object.geometry?.getAttribute("position");
        if (positions) assert.ok([...positions.array].every(Number.isFinite));
        const normals = object.geometry?.getAttribute("normal");
        if (normals) assert.ok([...normals.array].every(Number.isFinite));
    });
});

test("label ledges and scoops add visible interior surfaces", () => {
    const labelGroup = wrap(createConfiguredBinMeshes(configuredBin({
        width: 2,
        depth: 1,
        options: {
            labelPosition: "full",
            labelDepthMm: 6,
        },
    }), basicMaterials()).meshes);
    const labelHit = cast(labelGroup, new THREE.Vector3(20, 4.5, 80), new THREE.Vector3(0, 0, -1));
    assert.ok(labelHit.point.z > 21 && labelHit.point.z <= 28);

    const scoopGroup = wrap(createConfiguredBinMeshes(configuredBin({
        width: 2,
        depth: 1,
        options: {
            divisionsX: 2,
            scoopRadiusMm: 4,
        },
    }), basicMaterials()).meshes);
    const scoopHit = cast(scoopGroup, new THREE.Vector3(10, 2.2, 80), new THREE.Vector3(0, 0, -1));
    assert.ok(scoopHit.point.z > 5.95 && scoopHit.point.z < 9.95);
});

test("stacking lips accept the standard foot profile at each mating height", () => {
    const group = wrap(createConfiguredBinMeshes(configuredBin({ width: 1, depth: 1, height: 3, options: { stackingLip: true } }), basicMaterials()).meshes);
    for (const [z, wall, footWidth] of [[0.35, 2.25, 36.3], [1.5, 1.9, 37.2], [4.3, 0.1, 40.6]]) {
        const hit = cast(group, new THREE.Vector3(20.75, 20.75, 21 + z), new THREE.Vector3(0, -1, 0));
        assert.ok(hit, `lip at ${z} mm`);
        assert.ok(Math.abs(hit.point.y - wall) < 0.03, `correct lip section at ${z} mm`);
        assert.ok(20.75 - footWidth / 2 > hit.point.y, "the foot fits through the lip");
    }
});

test("deep screw pockets remain open through the foot/body junction", () => {
    const group = wrap(createConfiguredBinMeshes(configuredBin({
        width: 1, depth: 1, options: { floorMm: 2, magnetHoles: true, screwHoles: true, screwDepthMm: 6 },
    }), basicMaterials()).meshes);
    const hit = cast(group, new THREE.Vector3(7.75, 7.75, -1), new THREE.Vector3(0, 0, 1));
    assert.equal(round(hit.point.z), 6);
});

test("oversized labels and incompatible thick stacking walls are rejected, not clamped", () => {
    assert.throws(() => validateBinOptions(configuredBin({ width: 1, depth: 1, options: { labelPosition: "left", labelWidthMm: 40 } })), /Label width/);
    assert.throws(() => validateBinOptions(configuredBin({ options: { stackingLip: true, wallMm: 3 } })), /2.6/);
});

test("outer compartment corners retain the configured wall instead of square cut-throughs", () => {
    const group = wrap(createConfiguredBinMeshes(configuredBin({
        options: { wallMm: 0.8, divisionsX: 2, divisionsY: 2 },
    }), basicMaterials()).meshes);
    const corner = cast(group, new THREE.Vector3(1.3, 1.3, 80), new THREE.Vector3(0, 0, -1));
    assert.equal(round(corner.point.z), 28);
});

test("configured bin SCAD calls do not interpolate user labels", () => {
    const scad = exportScad({
        version: 1,
        designId: "danger",
        name: "Danger",
        revision: 0,
        grid: { columns: 2, rows: 2 },
        bins: [{
            ...configuredBin({
                label: `Bad"]); import("oops"); //`,
                options: {
                    divisionsX: 2,
                    divisionsY: 2,
                    labelPosition: "full",
                    scoopRadiusMm: 4,
                },
            }),
        }],
    }, "bin", "configured");
    assert.match(scad, /configured_bin\(/);
    assert.doesNotMatch(scad, /import\("oops"\)/);
    assert.doesNotMatch(scad, /Bad"\]/);
});
