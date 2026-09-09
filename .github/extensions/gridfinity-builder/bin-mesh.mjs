import * as THREE from "./vendor/three.mjs";
import { expandedOutline } from "./inlay.mjs";
import { BIN_GEOMETRY, getBinLayout, holeSegments, validateBinOptions } from "./bin-options.mjs";

const CURVE_SEGMENTS = 16;

function extrudeShape(shape, depth) {
    return new THREE.ExtrudeGeometry(shape, {
        depth,
        steps: 1,
        bevelEnabled: false,
        curveSegments: CURVE_SEGMENTS,
    });
}

function normalizePointRing(points, clockwise = false) {
    const ring = [];
    for (const point of points) {
        const next = Array.isArray(point) ? new THREE.Vector2(point[0], point[1]) : new THREE.Vector2(point.x, point.y);
        if (!ring.length || ring.at(-1).distanceToSquared(next) > 1e-12) ring.push(next);
    }
    if (ring.length > 1 && ring[0].distanceToSquared(ring.at(-1)) < 1e-12) ring.pop();
    const isClockwise = THREE.ShapeUtils.isClockWise(ring);
    if (clockwise ? !isClockwise : isClockwise) ring.reverse();
    return ring;
}

function createOutlineShape(points) {
    const ring = normalizePointRing(points);
    const shape = new THREE.Shape();
    shape.moveTo(ring[0].x, ring[0].y);
    for (let index = 1; index < ring.length; index++) shape.lineTo(ring[index].x, ring[index].y);
    shape.closePath();
    return shape;
}

function createOutlinePath(points) {
    const ring = normalizePointRing(points, true);
    const path = new THREE.Path();
    path.moveTo(ring[0].x, ring[0].y);
    for (let index = 1; index < ring.length; index++) path.lineTo(ring[index].x, ring[index].y);
    path.closePath();
    return path;
}

function createRoundedRectShape(width, depth, radius, x = 0, y = 0) {
    const r = Math.max(0, Math.min(radius, width / 2, depth / 2));
    const shape = new THREE.Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + width - r, y);
    shape.absarc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(x + width, y + depth - r);
    shape.absarc(x + width - r, y + depth - r, r, 0, Math.PI / 2, false);
    shape.lineTo(x + r, y + depth);
    shape.absarc(x + r, y + depth - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(x, y + r);
    shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    shape.closePath();
    return shape;
}

function createCircleShape(radius, holeRadius = 0) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    if (holeRadius > 0) {
        const hole = new THREE.Path();
        hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
        shape.holes.push(hole);
    }
    return shape;
}

function createCirclePathAt(x, y, radius, clockwise = true) {
    const path = new THREE.Path();
    path.absarc(x, y, radius, 0, Math.PI * 2, clockwise);
    path.closePath();
    return path;
}

function extractShapePoints(shape) {
    return shape.extractPoints(CURVE_SEGMENTS).shape;
}

function triangulateRing(ring) {
    return THREE.ShapeUtils.triangulateShape(ring, []);
}

function createLoftGeometry(sections, { capBottom = true, capTop = true } = {}) {
    const layers = sections.map(([z, size, radius]) => ({
        z,
        ring: normalizePointRing(extractShapePoints(createRoundedRectShape(size, size, radius, -size / 2, -size / 2))),
    }));
    const ringSize = layers[0].ring.length;
    const positions = [];
    const indices = [];
    for (const layer of layers) {
        for (const point of layer.ring) positions.push(point.x, point.y, layer.z);
    }
    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
        const lower = layerIndex * ringSize;
        const upper = (layerIndex + 1) * ringSize;
        for (let pointIndex = 0; pointIndex < ringSize; pointIndex++) {
            const next = (pointIndex + 1) % ringSize;
            const a = lower + pointIndex;
            const b = upper + pointIndex;
            const c = upper + next;
            const d = lower + next;
            indices.push(a, c, b, a, d, c);
        }
    }
    if (capBottom) {
        for (const [a, b, c] of triangulateRing(layers[0].ring)) indices.push(c, b, a);
    }
    if (capTop) {
        const topOffset = (layers.length - 1) * ringSize;
        for (const [a, b, c] of triangulateRing(layers.at(-1).ring)) indices.push(topOffset + a, topOffset + b, topOffset + c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function createRingLoftGeometry(layers, outerRing, { capTop = false } = {}) {
    const outerCount = outerRing.length;
    const innerCount = layers[0].innerRing.length;
    const positions = [];
    const indices = [];
    for (const layer of layers) {
        for (const point of outerRing) positions.push(point.x, point.y, layer.z);
        for (const point of layer.innerRing) positions.push(point.x, point.y, layer.z);
    }
    const stride = outerCount + innerCount;
    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
        const lower = layerIndex * stride;
        const upper = (layerIndex + 1) * stride;
        for (let pointIndex = 0; pointIndex < outerCount; pointIndex++) {
            const next = (pointIndex + 1) % outerCount;
            const a = lower + pointIndex;
            const b = upper + pointIndex;
            const c = upper + next;
            const d = lower + next;
            indices.push(a, c, b, a, d, c);
        }
        const innerOffset = outerCount;
        for (let pointIndex = 0; pointIndex < innerCount; pointIndex++) {
            const next = (pointIndex + 1) % innerCount;
            const a = lower + innerOffset + pointIndex;
            const b = upper + innerOffset + pointIndex;
            const c = upper + innerOffset + next;
            const d = lower + innerOffset + next;
            indices.push(a, c, b, a, d, c);
        }
    }
    const bottomFaces = THREE.ShapeUtils.triangulateShape(outerRing, [layers[0].innerRing]);
    for (const [a, b, c] of bottomFaces) indices.push(c, b, a);
    if (capTop) {
        const topFaces = THREE.ShapeUtils.triangulateShape(outerRing, [layers.at(-1).innerRing]);
        const offset = (layers.length - 1) * stride;
        for (const [a, b, c] of topFaces) indices.push(offset + a, offset + b, offset + c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function createFootMeshes(bin, layout, footMaterial) {
    const openBottom = layout.options.magnetHoles || layout.options.screwHoles;
    const throughTop = radiusAt(layout, BIN_GEOMETRY.footHeight) > 0;
    const footGeometry = createLoftGeometry(BIN_GEOMETRY.footSections, { capBottom: !openBottom, capTop: !throughTop });
    const feet = new THREE.InstancedMesh(footGeometry, footMaterial, bin.width * bin.depth);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let row = 0; row < bin.depth; row++) {
        for (let column = 0; column < bin.width; column++) {
            matrix.makeTranslation(
                (column + 0.5) * BIN_GEOMETRY.pitch - BIN_GEOMETRY.clearance / 2,
                (row + 0.5) * BIN_GEOMETRY.pitch - BIN_GEOMETRY.clearance / 2,
                0,
            );
            feet.setMatrixAt(index++, matrix);
        }
    }
    feet.instanceMatrix.needsUpdate = true;
    const meshes = [feet];

    for (const [enabled, size, radius, z] of [
        [openBottom, 35.6, 0.8, 0], [throughTop, 41.5, 3.75, BIN_GEOMETRY.footHeight],
    ]) if (enabled) {
        const shape = createRoundedRectShape(size, size, radius, -size / 2, -size / 2);
        for (const x of [-13, 13]) for (const y of [-13, 13]) shape.holes.push(createCirclePathAt(x, y, radiusAt(layout, z)));
        const geometry = new THREE.ShapeGeometry(shape, CURVE_SEGMENTS);
        geometry.translate(0, 0, z);
        const material = footMaterial.clone();
        material.side = THREE.DoubleSide;
        const caps = new THREE.InstancedMesh(geometry, material, bin.width * bin.depth);
        let index = 0;
        for (let row = 0; row < bin.depth; row++) {
            for (let column = 0; column < bin.width; column++) {
                matrix.makeTranslation((column + 0.5) * 42 - 0.25, (row + 0.5) * 42 - 0.25, 0);
                caps.setMatrixAt(index++, matrix);
            }
        }
        meshes.push(caps);
    }
    return meshes;
}

function radiusAt(layout, z) {
    return holeSegments(layout.options).find(segment => z >= segment.startMm && z < segment.endMm)?.radiusMm || 0;
}

function createBodyBase(layout, top, material) {
    const boundaries = [...new Set([BIN_GEOMETRY.footHeight,
        ...holeSegments(layout.options).map(segment => segment.endMm).filter(z => z > BIN_GEOMETRY.footHeight && z < top), top])].sort((a, b) => a - b);
    const meshes = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        const low = boundaries[i], high = boundaries[i + 1];
        const shape = createRoundedRectShape(layout.dimensions.widthMm, layout.dimensions.depthMm, BIN_GEOMETRY.bodyRadius);
        const radius = radiusAt(layout, low);
        if (radius > 0) for (const center of layout.holeCenters) shape.holes.push(createCirclePathAt(center.xMm, center.yMm, radius));
        const geometry = extrudeShape(shape, high - low);
        geometry.translate(0, 0, low);
        meshes.push(new THREE.Mesh(geometry, material));
    }
    return meshes;
}

function createCompartmentHolePath(layout, compartment) {
    const { xMm: x, yMm: y, widthMm: w, depthMm: d, column, row } = compartment;
    const r = layout.dimensions.cornerRadiusMm;
    const points = [];
    for (const [cx, cy, angle, rounded, sx, sy] of [
        [x + w, y, -Math.PI / 2, row === 0 && column === layout.options.divisionsX - 1, -1, 1],
        [x + w, y + d, 0, row === layout.options.divisionsY - 1 && column === layout.options.divisionsX - 1, -1, -1],
        [x, y + d, Math.PI / 2, row === layout.options.divisionsY - 1 && column === 0, 1, -1],
        [x, y, Math.PI, row === 0 && column === 0, 1, 1],
    ]) {
        if (!rounded) { points.push([cx, cy]); continue; }
        for (let step = 0; step <= CURVE_SEGMENTS * 2; step++) {
            const theta = angle + Math.PI / 2 * step / (CURVE_SEGMENTS * 2);
            points.push([cx + sx * r + Math.cos(theta) * r, cy + sy * r + Math.sin(theta) * r]);
        }
    }
    return createOutlinePath(points);
}

function clipToBody(geometry, layout) {
    const ring = normalizePointRing(extractShapePoints(createRoundedRectShape(layout.dimensions.widthMm, layout.dimensions.depthMm, 3.75)));
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.getAttribute("position"), output = [];
    for (let i = 0; i < position.count; i += 3) {
        let polygon = [0, 1, 2].map(j => [position.getX(i + j), position.getY(i + j), position.getZ(i + j)]);
        for (let edge = 0; edge < ring.length && polygon.length; edge++) {
            const a = ring[edge], b = ring[(edge + 1) % ring.length];
            const distance = p => (b.x - a.x) * (p[1] - a.y) - (b.y - a.y) * (p[0] - a.x);
            const clipped = [];
            for (let j = 0; j < polygon.length; j++) {
                const p = polygon[j], q = polygon[(j + 1) % polygon.length];
                const dp = distance(p), dq = distance(q), insideP = dp >= -1e-7, insideQ = dq >= -1e-7;
                if (insideP) clipped.push(p);
                if (insideP !== insideQ) {
                    const t = dp / (dp - dq);
                    clipped.push(p.map((value, axis) => value + (q[axis] - value) * t));
                }
            }
            polygon = clipped;
        }
        for (let j = 1; j + 1 < polygon.length; j++) output.push(...polygon[0], ...polygon[j], ...polygon[j + 1]);
    }
    if (source !== geometry) source.dispose();
    geometry.dispose();
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(output, 3));
    result.computeVertexNormals();
    return result;
}

function createHollowShellMesh(layout, exteriorMaterial) {
    const shape = createRoundedRectShape(
        layout.dimensions.widthMm,
        layout.dimensions.depthMm,
        BIN_GEOMETRY.bodyRadius,
    );
    for (const compartment of layout.compartments) shape.holes.push(createCompartmentHolePath(layout, compartment));
    const geometry = extrudeShape(shape, layout.dimensions.bodyHeightMm - layout.dimensions.cavityFloorMm);
    geometry.translate(0, 0, layout.dimensions.cavityFloorMm);
    return new THREE.Mesh(geometry, exteriorMaterial);
}

function createLipMesh(layout, exteriorMaterial) {
    if (!layout.options.stackingLip) return null;
    const outerRing = normalizePointRing(extractShapePoints(createRoundedRectShape(
        layout.dimensions.widthMm,
        layout.dimensions.depthMm,
        BIN_GEOMETRY.bodyRadius,
    )));
    const innerShape = (wall) => normalizePointRing(extractShapePoints(createRoundedRectShape(
        layout.dimensions.widthMm - wall * 2,
        layout.dimensions.depthMm - wall * 2,
        Math.max(0, Math.min(BIN_GEOMETRY.bodyRadius - wall, (layout.dimensions.widthMm - wall * 2) / 2, (layout.dimensions.depthMm - wall * 2) / 2)),
        wall,
        wall,
    )), true);
    const layers = [
        ...(layout.lip.supportRiseMm > 0 ? [{ z: layout.dimensions.bodyHeightMm - layout.lip.supportRiseMm, innerRing: innerShape(layout.options.wallMm) }] : []),
        { z: layout.dimensions.bodyHeightMm, innerRing: innerShape(layout.lip.supportWallMm) },
        { z: layout.dimensions.bodyHeightMm + 0.7, innerRing: innerShape(layout.lip.midWallMm) },
        { z: layout.dimensions.bodyHeightMm + 2.5, innerRing: innerShape(layout.lip.midWallMm) },
        { z: layout.dimensions.bodyHeightMm + BIN_GEOMETRY.lipHeight, innerRing: innerShape(layout.lip.topWallMm) },
    ];
    return new THREE.Mesh(createRingLoftGeometry(layers, outerRing, { capTop: true }), exteriorMaterial);
}

function createLabelMeshes(layout, interiorMaterial) {
    return layout.labels.map((label) => {
        const profile = createOutlineShape([[0, -label.depthMm], [label.depthMm, 0], [0, 0]]);
        const geometry = extrudeShape(profile, label.widthMm);
        geometry.applyMatrix4(new THREE.Matrix4().set(
            0, 0, 1, label.xMm, 1, 0, 0, label.yMm, 0, 1, 0, layout.dimensions.bodyHeightMm - 0.6, 0, 0, 0, 1,
        ));
        return new THREE.Mesh(clipToBody(geometry, layout), interiorMaterial);
    });
}

function createScoopMeshes(layout, interiorMaterial) {
    return layout.scoops.map((scoop) => {
        const r = scoop.radiusMm;
        const profile = new THREE.Shape();
        profile.moveTo(0, 0);
        profile.lineTo(r, 0);
        profile.absarc(r, r, r, -Math.PI / 2, -Math.PI, true);
        profile.closePath();
        const geometry = extrudeShape(profile, scoop.widthMm);
        geometry.applyMatrix4(new THREE.Matrix4().set(
            0, 0, 1, scoop.xMm, 1, 0, 0, layout.options.wallMm, 0, 1, 0, layout.dimensions.cavityFloorMm, 0, 0, 0, 1,
        ));
        return new THREE.Mesh(clipToBody(geometry, layout), interiorMaterial);
    });
}

function createInlayMeshes(bin, layout, exteriorMaterial, interiorMaterial) {
    const outlinePoints = expandedOutline(bin.inlay);
    const meshes = [];
    meshes.push(...createBodyBase(layout, layout.dimensions.bodyHeightMm - bin.inlay.depth, exteriorMaterial));

    const ringShape = createRoundedRectShape(layout.dimensions.widthMm, layout.dimensions.depthMm, BIN_GEOMETRY.bodyRadius);
    ringShape.holes.push(createOutlinePath(outlinePoints));
    const ring = extrudeShape(ringShape, bin.inlay.depth);
    ring.translate(0, 0, layout.dimensions.bodyHeightMm - bin.inlay.depth);
    meshes.push(new THREE.Mesh(ring, exteriorMaterial));

    const recessGeometry = new THREE.ShapeGeometry(createOutlineShape(outlinePoints), CURVE_SEGMENTS);
    recessGeometry.translate(0, 0, layout.dimensions.bodyHeightMm - bin.inlay.depth);
    const recessMaterial = interiorMaterial.clone();
    recessMaterial.side = THREE.DoubleSide;
    meshes.push(new THREE.Mesh(recessGeometry, recessMaterial));
    return meshes;
}

function createTopCapGeometry(radius, holeRadius = 0) {
    return new THREE.ShapeGeometry(createCircleShape(radius, holeRadius), CURVE_SEGMENTS);
}

function createPocketMeshes(layout, interiorMaterial) {
    const meshes = [];
    const segments = holeSegments(layout.options);
    for (const center of layout.holeCenters) {
        for (const segment of segments) {
            const side = new THREE.CylinderGeometry(segment.radiusMm, segment.radiusMm, segment.endMm - segment.startMm, 32, 1, true);
            side.rotateX(Math.PI / 2);
            side.translate(center.xMm, center.yMm, (segment.startMm + segment.endMm) / 2);
            const sideMaterial = interiorMaterial.clone();
            sideMaterial.side = THREE.BackSide;
            meshes.push(new THREE.Mesh(side, sideMaterial));
            const top = createTopCapGeometry(segment.radiusMm, segment.nextRadiusMm);
            top.translate(center.xMm, center.yMm, segment.endMm);
            const topMaterial = interiorMaterial.clone();
            topMaterial.side = THREE.DoubleSide;
            topMaterial.polygonOffset = true;
            topMaterial.polygonOffsetFactor = -1;
            topMaterial.polygonOffsetUnits = -1;
            meshes.push(new THREE.Mesh(top, topMaterial));
        }
    }
    return meshes;
}

export function createConfiguredBinMeshes(bin, { exteriorMaterial, interiorMaterial, footMaterial }) {
    validateBinOptions(bin);
    const layout = getBinLayout(bin);
    const meshes = [...createFootMeshes(bin, layout, footMaterial)];

    if (bin.inlay) meshes.push(...createInlayMeshes(bin, layout, exteriorMaterial, interiorMaterial));
    else if (layout.options.solid) meshes.push(...createBodyBase(layout, layout.dimensions.bodyHeightMm, exteriorMaterial));
    else {
        meshes.push(createHollowShellMesh(layout, exteriorMaterial));
        meshes.push(...createBodyBase(layout, layout.dimensions.cavityFloorMm, interiorMaterial));
        meshes.push(...createLabelMeshes(layout, interiorMaterial));
        meshes.push(...createScoopMeshes(layout, interiorMaterial));
    }

    const lip = createLipMesh(layout, exteriorMaterial);
    if (lip) meshes.push(lip);
    meshes.push(...createPocketMeshes(layout, interiorMaterial));
    return { meshes, heightMm: layout.dimensions.heightMm };
}
