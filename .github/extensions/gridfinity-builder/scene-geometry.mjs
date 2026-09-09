import * as THREE from "./vendor/three.mjs";
import { expandedOutline } from "./inlay.mjs";
import { GEOMETRY } from "./geometry.mjs";
import { footprint, validateDesign } from "./model.mjs";
import { gridFrame } from "./grid.mjs";
import { binDimensions } from "./bin-options.mjs";
import { createConfiguredBinMeshes } from "./bin-mesh.mjs";

const CURVE_SEGMENTS = 10;
const BODY_RADIUS = 3.75;
const BASEPLATE_RADIUS = 4;

export const BIN_COLORS = Object.freeze({
    blue: "#629bc8",
    teal: "#56a99b",
    amber: "#d5ab55",
    rose: "#cc8192",
    slate: "#8e9ba9",
});

export function createSceneGeometry(design) {
    validateDesign(design);
    const caches = {
        openBins: new Map(),
        inlayBins: new Map(),
        floorCaps: new Map(),
        recessCaps: new Map(),
    };
    const root = new THREE.Group();
    root.name = "gridfinity-root";
    const frame = gridFrame(design.grid);
    const offset = new THREE.Vector3(frame.originX, frame.originY, 0);

    const integrated = frame.marginMode === "integrated";
    const cornerMask = integrated
        ? (frame.gaps.left === 0 && frame.gaps.front === 0 ? 1 : 0) |
          (frame.gaps.right === 0 && frame.gaps.front === 0 ? 2 : 0) |
          (frame.gaps.right === 0 && frame.gaps.back === 0 ? 4 : 0) |
          (frame.gaps.left === 0 && frame.gaps.back === 0 ? 8 : 0)
        : 15;
    const baseplate = createBaseplate(design.grid.columns, design.grid.rows, frame.floorMm, cornerMask);
    baseplate.group.position.add(offset);
    baseplate.bounds.translate(offset);
    root.add(baseplate.group);
    const spacers = new THREE.Group();
    root.add(spacers);
    const drawerOutline = new THREE.Group();
    root.add(drawerOutline);
    const excessOverlay = new THREE.Group();
    root.add(excessOverlay);
    if (design.grid.drawer) {
        const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(frame.widthMm, 0, 0.02),
            new THREE.Vector3(frame.widthMm, frame.depthMm, 0.02), new THREE.Vector3(0, frame.depthMm, 0.02),
        ]), new THREE.LineBasicMaterial({ color: "#d5ab55", transparent: true, opacity: 0.7 }));
        drawerOutline.add(line);
    }
    if (frame.marginMode === "empty") for (const part of frame.excess) {
        const overlay = new THREE.Mesh(new THREE.PlaneGeometry(part.width, part.depth),
            new THREE.MeshBasicMaterial({ color: "#d5ab55", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
        overlay.position.set(part.x + part.width / 2, part.y + part.depth / 2, 0.03);
        excessOverlay.add(overlay);
    }
    for (const part of frame.marginParts) {
        const c = design.grid.drawer?.clearanceMm || 0;
        const mask = (part.x === c && part.y === c ? 1 : 0) |
            (part.x + part.width === frame.widthMm - c && part.y === c ? 2 : 0) |
            (part.x + part.width === frame.widthMm - c && part.y + part.depth === frame.depthMm - c ? 4 : 0) |
            (part.x === c && part.y + part.depth === frame.depthMm - c ? 8 : 0);
        const geometry = integrated ? extrudeShape(cornerRectangle(part.width, part.depth, mask), part.height)
            : new THREE.BoxGeometry(part.width, part.depth, part.height);
        const mesh = new THREE.Mesh(geometry,
            new THREE.MeshStandardMaterial({ color: "#d5ab55", roughness: 0.7 }));
        mesh.name = `spacer:${part.id}`;
        mesh.position.set(part.x + (integrated ? 0 : part.width / 2), part.y + (integrated ? 0 : part.depth / 2), integrated ? 0 : part.height / 2);
        spacers.add(mesh);
    }

    const bins = new Map();
    const selectionTargets = [];
    for (const bin of design.bins) {
        const built = createBinAssembly(bin, caches);
        built.group.position.add(offset);
        built.bounds.translate(offset);
        const seatOffset = new THREE.Vector3(0, 0, frame.floorMm - GEOMETRY.plateFloor);
        built.group.position.add(seatOffset);
        built.bounds.translate(seatOffset);
        bins.set(bin.id, built);
        root.add(built.group);
        selectionTargets.push(...built.selectionTargets);
    }

    root.updateMatrixWorld(true);
    const plateBounds = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(frame.widthMm, frame.depthMm, frame.heightMm));
    const bounds = plateBounds.clone();
    for (const built of bins.values()) bounds.union(built.bounds);

    return {
        root,
        baseplate,
        spacers,
        drawerOutline,
        excessOverlay,
        highlightExcess: true,
        plateBounds,
        seatedZ: frame.floorMm,
        bins,
        bounds,
        selectionTargets,
        dispose() {
            disposeObject3D(root);
        },
    };
}

export function applySceneMode(sceneData, mode, selectedId) {
    sceneData.baseplate.group.visible = mode !== "selected";
    sceneData.spacers.visible = mode !== "selected";
    sceneData.drawerOutline.visible = mode !== "selected";
    sceneData.excessOverlay.visible = mode !== "selected" && sceneData.highlightExcess;
    for (const [binId, bin] of sceneData.bins) {
        bin.group.visible = mode !== "baseplate" && (mode !== "selected" || binId === selectedId);
        bin.group.position.z = mode === "selected" ? 0 : sceneData.seatedZ;
    }
    sceneData.root.updateMatrixWorld(true);
}

export function setSelectedBin(sceneData, selectedId) {
    for (const [binId, bin] of sceneData.bins) {
        const selected = binId === selectedId;
        for (const material of bin.materials) {
            if (material.emissive) {
                material.emissive.set(selected ? "#7cc4ff" : "#000000");
                material.emissiveIntensity = selected ? 0.32 : 0;
            }
        }
        bin.outline.visible = selected;
        for (const target of bin.selectionTargets) target.userData.selected = selected;
    }
}

export function getViewBounds(sceneData, mode, selectedId) {
    if (mode === "baseplate") return sceneData.plateBounds.clone();
    if (mode === "selected" && selectedId && sceneData.bins.has(selectedId)) {
        return sceneData.bins.get(selectedId).bounds.clone().translate(new THREE.Vector3(0, 0, -sceneData.seatedZ));
    }
    return sceneData.bounds.clone();
}

export function getBinPlacement(bin) {
    const outerWidth = bin.width * GEOMETRY.pitch - GEOMETRY.clearance;
    const outerDepth = bin.depth * GEOMETRY.pitch - GEOMETRY.clearance;
    const size = footprint(bin);
    return {
        outerWidth,
        outerDepth,
        worldX: bin.x * GEOMETRY.pitch + GEOMETRY.clearance / 2,
        worldY: bin.y * GEOMETRY.pitch + GEOMETRY.clearance / 2,
        widthMm: size.width * GEOMETRY.pitch - GEOMETRY.clearance,
        depthMm: size.depth * GEOMETRY.pitch - GEOMETRY.clearance,
        heightMm: binDimensions(bin).heightMm,
    };
}

function createBaseplate(columns, rows, floorMm = GEOMETRY.plateFloor, cornerMask = 15) {
    const width = columns * GEOMETRY.pitch;
    const depth = rows * GEOMETRY.pitch;
    const group = new THREE.Group();
    group.name = "baseplate";

    if (floorMm > 0) {
        const floorGeometry = extrudeShape(cornerRectangle(width, depth, cornerMask), floorMm);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: "#7f8c98", roughness: 0.78, metalness: 0.08 });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.receiveShadow = true;
        floor.castShadow = true;
        group.add(floor);
    }

    const socketMaterial = new THREE.MeshStandardMaterial({
        color: "#b9c6d2",
        roughness: 0.42,
        metalness: 0.14,
    });
    const cellsByCorner = new Map();
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
            const mask = ((x === 0 && y === 0 ? 1 : 0) |
                (x === columns - 1 && y === 0 ? 2 : 0) |
                (x === columns - 1 && y === rows - 1 ? 4 : 0) |
                (x === 0 && y === rows - 1 ? 8 : 0)) & cornerMask;
            if (!cellsByCorner.has(mask)) cellsByCorner.set(mask, []);
            cellsByCorner.get(mask).push([x, y]);
        }
    }
    for (const [mask, cells] of cellsByCorner) {
        const sockets = new THREE.InstancedMesh(createSocketShellGeometry(mask), socketMaterial, cells.length);
        const matrix = new THREE.Matrix4();
        cells.forEach(([x, y], index) => {
            matrix.makeTranslation((x + 0.5) * GEOMETRY.pitch, (y + 0.5) * GEOMETRY.pitch, floorMm);
            sockets.setMatrixAt(index, matrix);
        });
        sockets.castShadow = true;
        sockets.receiveShadow = true;
        group.add(sockets);
    }
    group.updateMatrixWorld(true);

    return {
        group,
        bounds: new THREE.Box3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(width, depth, floorMm + 5),
        ),
    };
}

function cornerRectangle(width, depth, mask) {
    const radius = Math.min(4, width / 2, depth / 2);
    const points = [];
    for (const [x, y, angle, bit, sx, sy] of [
        [width, 0, -Math.PI / 2, 2, -1, 1], [width, depth, 0, 4, -1, -1],
        [0, depth, Math.PI / 2, 8, 1, -1], [0, 0, Math.PI, 1, 1, 1],
    ]) {
        if (!(mask & bit)) { points.push([x, y]); continue; }
        for (let step = 0; step <= CURVE_SEGMENTS * 2; step++) {
            const theta = angle + Math.PI / 2 * step / (CURVE_SEGMENTS * 2);
            points.push([x + sx * radius + Math.cos(theta) * radius, y + sy * radius + Math.sin(theta) * radius]);
        }
    }
    return createOutlineShape(points);
}

function createBinAssembly(bin, caches) {
    const placement = getBinPlacement(bin);
    const group = new THREE.Group();
    group.name = `bin:${bin.id}`;
    group.position.set(placement.worldX, placement.worldY, GEOMETRY.plateFloor);

    const pivot = new THREE.Group();
    group.add(pivot);
    if (bin.rotation === 90) {
        pivot.position.x = placement.outerDepth;
        pivot.rotation.z = Math.PI / 2;
    }

    const color = new THREE.Color(BIN_COLORS[bin.color] || BIN_COLORS.blue);
    const exteriorMaterial = new THREE.MeshStandardMaterial({
        color: color.clone(),
        roughness: 0.54,
        metalness: 0.12,
    });
    const footMaterial = new THREE.MeshStandardMaterial({
        color: color.clone().lerp(new THREE.Color("#1d2730"), 0.18),
        roughness: 0.7,
        metalness: 0.08,
    });
    const interiorMaterial = new THREE.MeshStandardMaterial({
        color: color.clone().lerp(new THREE.Color("#0f1720"), 0.42),
        roughness: 0.82,
        metalness: 0.03,
    });
    const outlineMaterial = new THREE.LineBasicMaterial({
        color: "#7cc4ff",
        transparent: true,
        opacity: 0.95,
    });
    if (bin.options) {
        const built = createConfiguredBinMeshes(bin, { exteriorMaterial, interiorMaterial, footMaterial });
        const targets = [], materials = new Set();
        for (const mesh of built.meshes) {
            pivot.add(mesh);
            mesh.traverse(object => {
                if (!object.isMesh) return;
                object.userData.binId = bin.id;
                object.castShadow = true;
                object.receiveShadow = true;
                targets.push(object);
                for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
            });
        }
        const outline = new THREE.LineSegments(createOuterEdgesGeometry(bin), outlineMaterial);
        outline.visible = false;
        pivot.add(outline);
        group.updateMatrixWorld(true);
        return {
            group, outline, materials: [...materials], selectionTargets: targets,
            bounds: new THREE.Box3(new THREE.Vector3(placement.worldX, placement.worldY, GEOMETRY.plateFloor),
                new THREE.Vector3(placement.worldX + placement.widthMm, placement.worldY + placement.depthMm, GEOMETRY.plateFloor + placement.heightMm)),
        };
    }
    caches.footGeometry ||= createLoftGeometry(GEOMETRY.footSections);
    const feet = new THREE.InstancedMesh(caches.footGeometry, footMaterial, bin.width * bin.depth);
    feet.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    let instance = 0;
    const footMatrix = new THREE.Matrix4();
    for (let y = 0; y < bin.depth; y++) {
        for (let x = 0; x < bin.width; x++) {
            footMatrix.makeTranslation((x + 0.5) * GEOMETRY.pitch - GEOMETRY.clearance / 2, (y + 0.5) * GEOMETRY.pitch - GEOMETRY.clearance / 2, 0);
            feet.setMatrixAt(instance++, footMatrix);
        }
    }
    feet.castShadow = true;
    feet.receiveShadow = true;
    feet.userData.binId = bin.id;
    pivot.add(feet);

    const bodyMeshes = [];
    if (bin.inlay) {
        const built = createInlayBody(bin, caches, exteriorMaterial, interiorMaterial);
        pivot.add(...built.meshes);
        bodyMeshes.push(...built.meshes);
    } else {
        const built = createOpenBody(bin, caches, exteriorMaterial, interiorMaterial);
        pivot.add(...built.meshes);
        bodyMeshes.push(...built.meshes);
    }

    const outline = new THREE.LineSegments(createOuterEdgesGeometry(bin), outlineMaterial);
    outline.visible = false;
    outline.renderOrder = 3;
    pivot.add(outline);

    for (const mesh of bodyMeshes) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.binId = bin.id;
    }
    const materials = [...new Set([footMaterial, ...bodyMeshes.map((mesh) => mesh.material)].flat())];

    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3(
        new THREE.Vector3(placement.worldX, placement.worldY, GEOMETRY.plateFloor),
        new THREE.Vector3(
            placement.worldX + placement.widthMm,
            placement.worldY + placement.depthMm,
            placement.heightMm + GEOMETRY.plateFloor,
        ),
    );
    return {
        group,
        bounds,
        materials,
        outline,
        selectionTargets: bodyMeshes,
    };
}

function createOpenBody(bin, caches, exteriorMaterial, interiorMaterial) {
    const placement = getBinPlacement(bin);
    const shellKey = `open:${placement.outerWidth}:${placement.outerDepth}:${placement.heightMm}`;
    const floorKey = `floor:${placement.outerWidth}:${placement.outerDepth}`;
    const shellGeometry = getOrCreate(caches.openBins, shellKey, () => {
        const outer = createRoundedRectShape(placement.outerWidth, placement.outerDepth, BODY_RADIUS);
        const inner = createRoundedRectPath(
            GEOMETRY.wall,
            GEOMETRY.wall,
            placement.outerWidth - GEOMETRY.wall * 2,
            placement.outerDepth - GEOMETRY.wall * 2,
            BODY_RADIUS - GEOMETRY.wall,
        );
        outer.holes.push(inner);
        const geometry = extrudeShape(outer, placement.heightMm - GEOMETRY.footHeight);
        geometry.translate(0, 0, GEOMETRY.footHeight);
        return geometry;
    });
    const floorGeometry = getOrCreate(caches.floorCaps, floorKey, () => {
        const shape = createRoundedRectShape(
            placement.outerWidth - GEOMETRY.wall * 2,
            placement.outerDepth - GEOMETRY.wall * 2,
            BODY_RADIUS - GEOMETRY.wall,
            GEOMETRY.wall,
            GEOMETRY.wall,
        );
        const geometry = extrudeShape(shape, GEOMETRY.floor);
        geometry.translate(0, 0, GEOMETRY.footHeight);
        return geometry;
    });
    return {
        meshes: [
            new THREE.Mesh(shellGeometry, exteriorMaterial),
            new THREE.Mesh(floorGeometry, interiorMaterial),
        ],
    };
}

function createInlayBody(bin, caches, exteriorMaterial, interiorMaterial) {
    const placement = getBinPlacement(bin);
    const outlinePoints = expandedOutline(bin.inlay);
    const outlineKey = outlinePoints.map(([x, y]) => `${x},${y}`).join(";");
    const baseKey = `inlay:base:${placement.outerWidth}:${placement.outerDepth}:${placement.heightMm}:${bin.inlay.depth}`;
    const ringKey = `inlay:ring:${placement.outerWidth}:${placement.outerDepth}:${placement.heightMm}:${outlineKey}:${bin.inlay.depth}`;
    const floorKey = `inlay:cap:${outlineKey}:${placement.heightMm - bin.inlay.depth}`;
    const baseGeometry = getOrCreate(caches.inlayBins, baseKey, () => {
        const geometry = extrudeShape(
            createRoundedRectShape(placement.outerWidth, placement.outerDepth, BODY_RADIUS),
            placement.heightMm - GEOMETRY.footHeight - bin.inlay.depth,
        );
        geometry.translate(0, 0, GEOMETRY.footHeight);
        return geometry;
    });
    const ringGeometry = getOrCreate(caches.inlayBins, ringKey, () => {
        const outer = createRoundedRectShape(placement.outerWidth, placement.outerDepth, BODY_RADIUS);
        outer.holes.push(createOutlinePath(outlinePoints));
        const geometry = extrudeShape(outer, bin.inlay.depth);
        geometry.translate(0, 0, placement.heightMm - bin.inlay.depth);
        return geometry;
    });
    const recessGeometry = getOrCreate(caches.recessCaps, floorKey, () => {
        const geometry = new THREE.ShapeGeometry(createOutlineShape(outlinePoints), CURVE_SEGMENTS);
        geometry.translate(0, 0, placement.heightMm - bin.inlay.depth);
        return geometry;
    });
    const recessMaterialAdjusted = interiorMaterial.clone();
    recessMaterialAdjusted.polygonOffset = true;
    recessMaterialAdjusted.polygonOffsetFactor = -1;
    recessMaterialAdjusted.polygonOffsetUnits = -1;
    return {
        meshes: [
            new THREE.Mesh(baseGeometry, exteriorMaterial),
            new THREE.Mesh(ringGeometry, exteriorMaterial),
            new THREE.Mesh(recessGeometry, recessMaterialAdjusted),
        ],
    };
}

function createOuterEdgesGeometry(bin) {
    const placement = getBinPlacement(bin);
    const shape = createRoundedRectShape(placement.outerWidth, placement.outerDepth, BODY_RADIUS);
    const geometry = extrudeShape(shape, placement.heightMm - GEOMETRY.footHeight);
    geometry.translate(0, 0, GEOMETRY.footHeight);
    const edges = new THREE.EdgesGeometry(geometry, 28);
    geometry.dispose();
    return edges;
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

function createRoundedRectPath(x, y, width, depth, radius) {
    return createOutlinePath(extractShapePoints(createRoundedRectShape(width, depth, radius, x, y)));
}

function createOutlineShape(points) {
    const shape = new THREE.Shape();
    const ring = normalizePointRing(points);
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

function createLoftGeometry(sections) {
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
    const bottomFaces = triangulateRing(layers[0].ring);
    for (const [a, b, c] of bottomFaces) indices.push(c, b, a);
    const topOffset = (layers.length - 1) * ringSize;
    const topFaces = triangulateRing(layers.at(-1).ring);
    for (const [a, b, c] of topFaces) indices.push(topOffset + a, topOffset + b, topOffset + c);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function createCellOutline(mask) {
    const half = GEOMETRY.pitch / 2;
    const corners = [[half, -half, -Math.PI / 2, 2], [half, half, 0, 4], [-half, half, Math.PI / 2, 8], [-half, -half, Math.PI, 1]];
    const points = [];
    for (const [x, y, angle, bit] of corners) {
        if (!(mask & bit)) {
            points.push([x, y]);
            continue;
        }
        const cx = x - Math.sign(x) * BASEPLATE_RADIUS;
        const cy = y - Math.sign(y) * BASEPLATE_RADIUS;
        for (let step = 0; step <= CURVE_SEGMENTS * 2; step++) {
            const theta = angle + Math.PI / 2 * step / (CURVE_SEGMENTS * 2);
            points.push([cx + BASEPLATE_RADIUS * Math.cos(theta), cy + BASEPLATE_RADIUS * Math.sin(theta)]);
        }
    }
    return normalizePointRing(points);
}

function createSocketShellGeometry(cornerMask) {
    const outerRing = createCellOutline(cornerMask);
    const innerSections = [
        [0, GEOMETRY.socketSections[0][1], GEOMETRY.socketSections[0][2]],
        [GEOMETRY.socketRelief, GEOMETRY.socketSections[0][1], GEOMETRY.socketSections[0][2]],
        ...GEOMETRY.socketSections.slice(1).map(([z, size, radius]) => [GEOMETRY.socketRelief + z, size, radius]),
    ];
    return createRingLoftGeometry(
        innerSections.map(([z, size, radius]) => ({
            z,
            innerRing: normalizePointRing(extractShapePoints(createRoundedRectShape(size, size, radius, -size / 2, -size / 2)), true),
        })),
        outerRing,
        { cellCornerMask: cornerMask },
    );
}

function createRingLoftGeometry(layers, outerRing, { capBottom = true, capTop = false, cellCornerMask = null } = {}) {
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
    if (capBottom) {
        const faces = THREE.ShapeUtils.triangulateShape(outerRing, [layers[0].innerRing]);
        for (const [a, b, c] of faces) indices.push(c, b, a);
    }
    if (capTop) {
        const faces = THREE.ShapeUtils.triangulateShape(outerRing, [layers.at(-1).innerRing]);
        const offset = (layers.length - 1) * stride;
        for (const [a, b, c] of faces) indices.push(offset + a, offset + b, offset + c);
    }
    // Adjacent socket openings touch at the rim; build their solid corner patches separately.
    if (cellCornerMask !== null) {
        const half = GEOMETRY.pitch / 2;
        for (const [x, y, angle, bit] of [[-half, -half, Math.PI, 1], [half, -half, -Math.PI / 2, 2], [half, half, 0, 4], [-half, half, Math.PI / 2, 8]]) {
            if (cellCornerMask & bit) continue;
            const base = positions.length / 3;
            const z = layers.at(-1).z;
            positions.push(x, y, z);
            const cx = x - Math.sign(x) * BASEPLATE_RADIUS;
            const cy = y - Math.sign(y) * BASEPLATE_RADIUS;
            for (let step = 0; step <= CURVE_SEGMENTS * 2; step++) {
                const theta = angle + Math.PI / 2 * step / (CURVE_SEGMENTS * 2);
                positions.push(cx + BASEPLATE_RADIUS * Math.cos(theta), cy + BASEPLATE_RADIUS * Math.sin(theta), z);
                if (step) indices.push(base, base + step + 1, base + step);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function extractShapePoints(shape) {
    return shape.extractPoints(CURVE_SEGMENTS).shape;
}

function triangulateRing(ring) {
    return THREE.ShapeUtils.triangulateShape(ring, []);
}

function extrudeShape(shape, depth) {
    return new THREE.ExtrudeGeometry(shape, {
        depth,
        steps: 1,
        bevelEnabled: false,
        curveSegments: CURVE_SEGMENTS,
    });
}

function getOrCreate(cache, key, create) {
    if (!cache.has(key)) cache.set(key, create());
    return cache.get(key);
}

function disposeObject3D(root) {
    const geometries = new Set();
    const materials = new Set();
    root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of objectMaterials) materials.add(material);
    });
    for (const material of materials) {
        for (const value of Object.values(material)) {
            if (value && value.isTexture) value.dispose();
        }
        material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
}
