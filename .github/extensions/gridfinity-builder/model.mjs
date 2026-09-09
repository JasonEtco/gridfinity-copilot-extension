import { validateInlay, InlayError } from "./inlay.mjs";
import { ALEX_DRAWER, fitDrawer, gridFrame } from "./grid.mjs";
import { BIN_OPTION_DEFAULTS, binDimensions, validateBinOptions } from "./bin-options.mjs";

export const PITCH = 42;
export const HEIGHT_UNIT = 7;
export const COLORS = ["blue", "teal", "amber", "rose", "slate"];
export const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$";

export class DesignError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export function requireThat(condition, message, code = "invalid_input") {
    if (!condition) throw new DesignError(code, message);
}

export function object(value, allowed, name) {
    requireThat(value !== null && typeof value === "object" && !Array.isArray(value), `${name} must be an object.`);
    requireThat(Object.keys(value).every(key => allowed.includes(key)), `${name} contains an unknown field.`);
}

export function integer(value, min, max, name) {
    requireThat(Number.isSafeInteger(value) && value >= min && value <= max, `${name} must be an integer from ${min} to ${max}.`);
}

export function text(value, max, name) {
    requireThat(typeof value === "string" && value.trim().length > 0 && value.length <= max, `${name} must contain 1 to ${max} characters.`);
}

export function validateId(value) {
    requireThat(typeof value === "string" && new RegExp(ID_PATTERN).test(value), "IDs must use 1 to 64 letters, numbers, underscores or hyphens, starting with a letter or number.");
    return value;
}

export function footprint(bin) {
    return bin.rotation === 90 ? { width: bin.depth, depth: bin.width } : { width: bin.width, depth: bin.depth };
}

export function validateDesign(design) {
    object(design, ["version", "designId", "name", "revision", "grid", "bins"], "Design");
    requireThat(design.version === 1, "Only layout version 1 is supported.");
    validateId(design.designId);
    text(design.name, 100, "Design name");
    integer(design.revision, 0, Number.MAX_SAFE_INTEGER - 1, "Revision");
    object(design.grid, ["columns", "rows", "drawer", "baseplate"], "Grid");
    integer(design.grid.columns, 1, 32, "Grid columns");
    integer(design.grid.rows, 1, 32, "Grid rows");
    try {
        gridFrame(design.grid);
    } catch (error) {
        throw new DesignError("invalid_drawer", error.message);
    }
    requireThat(Array.isArray(design.bins) && design.bins.length <= 1024, "Bins must be an array of at most 1024 items.");
    const ids = new Set();
    const cells = new Set();
    for (const bin of design.bins) {
        object(bin, ["id", "label", "x", "y", "width", "depth", "height", "rotation", "color", "inlay", "options"], "Bin");
        validateId(bin.id);
        requireThat(!ids.has(bin.id), `Duplicate bin ID: ${bin.id}.`);
        ids.add(bin.id);
        text(bin.label, 80, "Bin label");
        integer(bin.x, 0, 31, "Bin x");
        integer(bin.y, 0, 31, "Bin y");
        integer(bin.width, 1, 32, "Bin width");
        integer(bin.depth, 1, 32, "Bin depth");
        integer(bin.height, 1, 20, "Bin height");
        requireThat([0, 90].includes(bin.rotation), "Rotation must be 0 or 90 degrees.");
        requireThat(COLORS.includes(bin.color), "Unknown bin color.");
        try {
            validateBinOptions(bin);
            validateInlay(bin.inlay, bin);
        } catch (error) {
            if (error instanceof InlayError) throw new DesignError(error.code, error.message);
            if (error.code === "invalid_bin_options") throw new DesignError(error.code, error.message);
            throw error;
        }
        const size = footprint(bin);
        requireThat(bin.x + size.width <= design.grid.columns && bin.y + size.depth <= design.grid.rows, `Bin "${bin.label}" is outside the grid.`, "out_of_bounds");
        for (let x = bin.x; x < bin.x + size.width; x++) {
            for (let y = bin.y; y < bin.y + size.depth; y++) {
                const cell = `${x},${y}`;
                requireThat(!cells.has(cell), `Bin "${bin.label}" overlaps another bin at (${x}, ${y}).`, "overlap");
                cells.add(cell);
            }
        }
    }
    return design;
}

export function newDesign(designId, name = "Workbench", grid = fitDrawer(ALEX_DRAWER)) {
    return validateDesign({ version: 1, designId, name, revision: 0, grid: structuredClone(grid), bins: [] });
}

export function metrics(design) {
    validateDesign(design);
    const totalCells = design.grid.columns * design.grid.rows;
    const occupiedCells = design.bins.reduce((sum, bin) => sum + bin.width * bin.depth, 0);
    const result = {
        widthMm: design.grid.columns * PITCH,
        depthMm: design.grid.rows * PITCH,
        totalCells, occupiedCells, freeCells: totalCells - occupiedCells,
        occupancyPercent: Math.round(occupiedCells / totalCells * 100),
        bins: design.bins.map(bin => {
            const size = footprint(bin);
            return { id: bin.id, widthMm: size.width * PITCH - 0.5, depthMm: size.depth * PITCH - 0.5, heightMm: binDimensions(bin).heightMm };
        }),
    };
    if (design.grid.drawer) result.drawer = gridFrame(design.grid);
    return result;
}

export function applyOperations(design, expectedRevision, operations) {
    validateDesign(design);
    requireThat(expectedRevision === design.revision, "The design changed. Read the current state and try again.", "revision_conflict");
    requireThat(Array.isArray(operations) && operations.length > 0 && operations.length <= 1026, "Provide 1 to 1026 operations.");
    const next = structuredClone(design);
    const find = id => {
        const bin = next.bins.find(item => item.id === id);
        requireThat(bin, `Bin not found: ${id}.`, "not_found");
        return bin;
    };
    for (const op of operations) {
        requireThat(op !== null && typeof op === "object", "Each operation must be an object.");
        switch (op.type) {
            case "resize_grid":
                object(op, ["type", "columns", "rows"], "Resize operation");
                next.grid = { ...next.grid, columns: op.columns, rows: op.rows };
                break;
            case "fit_drawer":
                object(op, ["type", "drawer"], "Drawer fit operation");
                try {
                    next.grid = { ...next.grid, ...fitDrawer(op.drawer) };
                } catch (error) {
                    throw new DesignError("invalid_drawer", error.message);
                }
                break;
            case "set_drawer":
                object(op, ["type", "drawer"], "Drawer settings operation");
                object(op.drawer, ["widthMm", "depthMm", "clearanceMm", "alignment", "spacers", "offsetXmm", "offsetYmm", "margin"], "Drawer");
                next.grid.drawer = structuredClone(op.drawer);
                break;
            case "set_baseplate":
                object(op, ["type", "baseplate"], "Baseplate settings operation");
                object(op.baseplate, ["type", "floorMm"], "Baseplate settings");
                next.grid.baseplate = structuredClone(op.baseplate);
                break;
            case "clear_drawer":
                object(op, ["type"], "Clear drawer operation");
                delete next.grid.drawer;
                break;
            case "rename":
                object(op, ["type", "name"], "Rename operation");
                next.name = op.name;
                break;
            case "add_bin":
                object(op, ["type", "bin"], "Add operation");
                next.bins.push(structuredClone(op.bin));
                break;
            case "update_bin":
                object(op, ["type", "id", "changes"], "Update operation");
                object(op.changes, ["label", "x", "y", "width", "depth", "height", "rotation", "color", "inlay", "options"], "Bin changes");
                {
                    const bin = find(op.id);
                    const changes = structuredClone(op.changes);
                    if (changes.options !== undefined) {
                        object(changes.options, Object.keys(BIN_OPTION_DEFAULTS), "Bin options");
                        changes.options = { ...bin.options, ...changes.options };
                    }
                    if (changes.inlay && !Object.hasOwn(changes.inlay, "photo") && bin.inlay?.photo) {
                        changes.inlay.photo = bin.inlay.photo;
                    }
                    Object.assign(bin, changes);
                }
                break;
            case "remove_bin":
                object(op, ["type", "id"], "Remove operation");
                find(op.id);
                next.bins = next.bins.filter(bin => bin.id !== op.id);
                break;
            case "duplicate_bin":
                object(op, ["type", "id", "newId", "x", "y"], "Duplicate operation");
                next.bins.push({ ...find(op.id), id: op.newId, x: op.x, y: op.y });
                break;
            case "clear_bins":
                object(op, ["type"], "Clear operation");
                next.bins = [];
                break;
            default:
                throw new DesignError("invalid_input", `Unknown operation: ${op.type}.`);
        }
    }
    next.revision++;
    return validateDesign(next);
}

export function importLayout(current, expectedRevision, layout) {
    validateDesign(layout);
    requireThat(current.revision === expectedRevision, "The design changed. Read the current state before importing.", "revision_conflict");
    return validateDesign({ ...structuredClone(layout), designId: current.designId, revision: current.revision + 1 });
}
