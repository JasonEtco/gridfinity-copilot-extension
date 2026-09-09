import { COLORS, ID_PATTERN } from "./model.mjs";
import { GRID_ALIGNMENTS } from "./grid.mjs";

const int = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const str = maxLength => ({ type: "string", minLength: 1, maxLength });
const number = (minimum, maximum) => ({ type: "number", minimum, maximum });
export const idSchema = { type: "string", pattern: ID_PATTERN };
export const obj = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const point = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };
const outline = { type: "array", items: point, minItems: 3, maxItems: 128 };
export const drawerSchema = obj({
    widthMm: number(42, 2000), depthMm: number(42, 2000), clearanceMm: number(0, 5),
    alignment: { enum: [...Object.keys(GRID_ALIGNMENTS), "custom"] }, spacers: { type: "boolean" },
    offsetXmm: number(0, 2000), offsetYmm: number(0, 2000), margin: { enum: ["separate", "integrated"] },
}, ["widthMm", "depthMm", "clearanceMm", "alignment", "spacers"]);
export const baseplateSchema = obj({ type: { enum: ["solid", "frame"] }, floorMm: number(0.8, 5) });
export const inlaySchema = {
    anyOf: [{ type: "null" }, obj({
        outline, depth: number(0.1, 134.05), clearance: number(0, 3),
        photo: obj({
            dataUrl: { type: "string", maxLength: 524288, pattern: "^data:image/jpeg;base64," },
            width: int(1, 1200), height: int(1, 1200), points: outline, itemWidthMm: number(0.01, 1343.5),
        }),
    }, ["outline", "depth", "clearance"])],
};
const binFields = {
    label: str(80), x: int(0, 31), y: int(0, 31), width: int(1, 32), depth: int(1, 32),
    height: int(1, 20), rotation: { enum: [0, 90] }, color: { enum: COLORS },
};
export const binOptionsSchema = obj({
    wallMm: number(0.8, 3), floorMm: number(0.8, 5), divisionsX: int(1, 12), divisionsY: int(1, 12),
    dividerMm: number(0.8, 3), solid: { type: "boolean" }, stackingLip: { type: "boolean" },
    labelPosition: { enum: ["none", "left", "center", "right", "full"] }, labelDepthMm: number(1, 12),
    labelWidthMm: number(5, 100), scoopRadiusMm: number(0, 15),
    magnetHoles: { type: "boolean" }, magnetDiameterMm: number(3, 8), magnetDepthMm: number(0.5, 3),
    screwHoles: { type: "boolean" }, screwDiameterMm: number(1.5, 4), screwDepthMm: number(1, 6),
}, []);
export const binSchema = obj({ id: idSchema, ...binFields, inlay: inlaySchema, options: binOptionsSchema }, ["id", ...Object.keys(binFields)]);
const op = (type, fields = {}) => obj({ type: { const: type }, ...fields });
export const operationSchema = { oneOf: [
    op("resize_grid", { columns: int(1, 32), rows: int(1, 32) }),
    op("fit_drawer", { drawer: drawerSchema }),
    op("set_drawer", { drawer: drawerSchema }),
    op("set_baseplate", { baseplate: baseplateSchema }),
    op("clear_drawer"),
    op("rename", { name: str(100) }),
    op("add_bin", { bin: binSchema }),
    op("update_bin", { id: idSchema, changes: obj({ ...binFields, inlay: inlaySchema, options: binOptionsSchema }, []) }),
    op("remove_bin", { id: idSchema }),
    op("duplicate_bin", { id: idSchema, newId: idSchema, x: int(0, 31), y: int(0, 31) }),
    op("clear_bins"),
] };
export const layoutSchema = obj({
    version: { const: 1 }, designId: idSchema, name: str(100), revision: int(0, Number.MAX_SAFE_INTEGER - 1),
    grid: obj({ columns: int(1, 32), rows: int(1, 32), drawer: { anyOf: [drawerSchema, { type: "null" }] }, baseplate: baseplateSchema }, ["columns", "rows"]),
    bins: { type: "array", items: binSchema, maxItems: 1024 },
});
export const openSchema = obj({ designId: idSchema, name: str(100) }, ["designId"]);
export const editSchema = obj({
    expectedRevision: int(0, Number.MAX_SAFE_INTEGER - 1),
    operations: { type: "array", minItems: 1, maxItems: 1026, items: operationSchema },
});
export const importSchema = obj({ expectedRevision: int(0, Number.MAX_SAFE_INTEGER - 1), layout: layoutSchema });
export const exportSchema = obj({
    format: { enum: ["json", "scad", "stl"] }, part: { enum: ["baseplate", "bins", "bin", "spacers"] },
    binId: idSchema, expectedRevision: int(0, Number.MAX_SAFE_INTEGER - 1),
}, ["format"]);
