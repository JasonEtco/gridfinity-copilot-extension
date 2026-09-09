export const BIN_GEOMETRY = Object.freeze({
    pitch: 42,
    heightUnit: 7,
    clearance: 0.5,
    footHeight: 4.75,
    bodyRadius: 3.75,
    lipHeight: 4.4,
    holeOffsetFromCellCenter: 13,
    minCompartmentMm: 3,
    minCavityMm: 0.5,
    minRoofBelowCavityMm: 0.6,
    lipSupportWallMm: 2.6,
    footSections: Object.freeze([
        Object.freeze([0, 35.6, 0.8]),
        Object.freeze([0.8, 37.2, 1.6]),
        Object.freeze([2.6, 37.2, 1.6]),
        Object.freeze([4.75, 41.5, 3.75]),
    ]),
});

export const BIN_OPTION_DEFAULTS = Object.freeze({
    wallMm: 1.2,
    floorMm: 1.2,
    divisionsX: 1,
    divisionsY: 1,
    dividerMm: 1.2,
    solid: false,
    stackingLip: false,
    labelPosition: "none",
    labelDepthMm: 8,
    labelWidthMm: 20,
    scoopRadiusMm: 0,
    magnetHoles: false,
    magnetDiameterMm: 6.5,
    magnetDepthMm: 2.4,
    screwHoles: false,
    screwDiameterMm: 3,
    screwDepthMm: 4,
});

const OPTION_KEYS = Object.freeze(Object.keys(BIN_OPTION_DEFAULTS));
const LABEL_POSITIONS = Object.freeze(["none", "left", "center", "right", "full"]);

export class BinOptionsError extends Error {
    constructor(message) {
        super(message);
        this.code = "invalid_bin_options";
    }
}

function fail(message) {
    throw new BinOptionsError(message);
}

function expectObject(value, name) {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
    return value;
}

function expectFinite(value, name) {
    if (!Number.isFinite(value)) fail(`${name} must be a finite number.`);
}

function expectNumber(value, minimum, maximum, name) {
    expectFinite(value, name);
    if (value < minimum || value > maximum) fail(`${name} must be from ${minimum} to ${maximum}.`);
}

function expectInteger(value, minimum, maximum, name) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(`${name} must be an integer from ${minimum} to ${maximum}.`);
    }
}

function expectBoolean(value, name) {
    if (typeof value !== "boolean") fail(`${name} must be true or false.`);
}

function expectEnum(value, values, name) {
    if (!values.includes(value)) fail(`${name} must be ${values.join(", ")}.`);
}

function roundedRectRadius(widthMm, depthMm, wallMm) {
    return Math.max(0, Math.min(BIN_GEOMETRY.bodyRadius - wallMm, widthMm / 2, depthMm / 2));
}

export function getBinOptions(bin) {
    const source = expectObject(bin?.options, "Bin options");
    const unknown = Object.keys(source).filter(key => !OPTION_KEYS.includes(key));
    if (unknown.length) fail(`Bin options contain an unknown field: ${unknown[0]}.`);
    return { ...BIN_OPTION_DEFAULTS, ...source };
}

export function binDimensions(bin) {
    const widthCells = bin?.width;
    const depthCells = bin?.depth;
    const heightUnits = bin?.height;
    expectInteger(widthCells, 1, 32, "Bin width");
    expectInteger(depthCells, 1, 32, "Bin depth");
    expectInteger(heightUnits, 1, 20, "Bin height");

    const options = getBinOptions(bin);
    const widthMm = widthCells * BIN_GEOMETRY.pitch - BIN_GEOMETRY.clearance;
    const depthMm = depthCells * BIN_GEOMETRY.pitch - BIN_GEOMETRY.clearance;
    const bodyHeightMm = heightUnits * BIN_GEOMETRY.heightUnit;
    const lipHeightMm = options.stackingLip ? BIN_GEOMETRY.lipHeight : 0;
    const heightMm = bodyHeightMm + lipHeightMm;
    const cavityFloorMm = BIN_GEOMETRY.footHeight + options.floorMm;
    const innerWidthMm = widthMm - options.wallMm * 2;
    const innerDepthMm = depthMm - options.wallMm * 2;
    const usableHeightMm = bodyHeightMm - cavityFloorMm;
    const compartmentWidthMm = (innerWidthMm - options.dividerMm * (options.divisionsX - 1)) / options.divisionsX;
    const compartmentDepthMm = (innerDepthMm - options.dividerMm * (options.divisionsY - 1)) / options.divisionsY;
    return {
        widthMm,
        depthMm,
        heightMm,
        bodyHeightMm,
        lipHeightMm,
        cavityFloorMm,
        innerWidthMm,
        innerDepthMm,
        usableHeightMm,
        compartmentWidthMm,
        compartmentDepthMm,
        cornerRadiusMm: roundedRectRadius(innerWidthMm, innerDepthMm, options.wallMm),
    };
}

export function getBinLayout(bin) {
    const options = getBinOptions(bin);
    const dimensions = binDimensions({ ...bin, options });
    const compartments = [];
    for (let row = 0; row < options.divisionsY; row++) {
        for (let column = 0; column < options.divisionsX; column++) {
            compartments.push({
                column,
                row,
                xMm: options.wallMm + column * (dimensions.compartmentWidthMm + options.dividerMm),
                yMm: options.wallMm + row * (dimensions.compartmentDepthMm + options.dividerMm),
                widthMm: dimensions.compartmentWidthMm,
                depthMm: dimensions.compartmentDepthMm,
            });
        }
    }

    const holeCenters = [];
    const half = BIN_GEOMETRY.pitch / 2 - BIN_GEOMETRY.clearance / 2;
    for (let row = 0; row < bin.depth; row++) {
        for (let column = 0; column < bin.width; column++) {
            const centerX = column * BIN_GEOMETRY.pitch + half;
            const centerY = row * BIN_GEOMETRY.pitch + half;
            for (const offsetX of [-BIN_GEOMETRY.holeOffsetFromCellCenter, BIN_GEOMETRY.holeOffsetFromCellCenter]) {
                for (const offsetY of [-BIN_GEOMETRY.holeOffsetFromCellCenter, BIN_GEOMETRY.holeOffsetFromCellCenter]) {
                    holeCenters.push({
                        xMm: centerX + offsetX,
                        yMm: centerY + offsetY,
                    });
                }
            }
        }
    }

    const frontRow = compartments.filter(compartment => compartment.row === 0);
    const labelPosition = options.labelPosition;
    const labels = [];
    if (labelPosition === "full") {
        for (const compartment of frontRow) labels.push({
            xMm: compartment.xMm,
            yMm: options.wallMm,
            widthMm: compartment.widthMm,
            depthMm: options.labelDepthMm,
        });
    } else if (labelPosition !== "none") {
        const widthMm = options.labelWidthMm;
        const xMm = labelPosition === "left"
            ? frontRow[0].xMm
            : labelPosition === "right"
                ? frontRow.at(-1).xMm + frontRow.at(-1).widthMm - widthMm
                : options.wallMm + (dimensions.innerWidthMm - widthMm) / 2;
        labels.push({
            xMm,
            yMm: options.wallMm,
            widthMm,
            depthMm: options.labelDepthMm,
        });
    }
    const label = labels[0] || null;

    const scoops = options.scoopRadiusMm > 0
        ? frontRow.map(compartment => ({
            xMm: compartment.xMm,
            widthMm: compartment.widthMm,
            radiusMm: options.scoopRadiusMm,
            centerYmm: options.wallMm + options.scoopRadiusMm,
            centerZmm: dimensions.cavityFloorMm + options.scoopRadiusMm,
        }))
        : [];

    const lip = options.stackingLip ? {
        supportWallMm: 2.6,
        supportRiseMm: Math.max(0, 2.6 - options.wallMm),
        midWallMm: 1.9,
        topWallMm: 0.01,
    } : null;

    return { options, dimensions, compartments, holeCenters, label, labels, scoops, lip };
}

export function validateBinOptions(bin) {
    expectInteger(bin?.width, 1, 32, "Bin width");
    expectInteger(bin?.depth, 1, 32, "Bin depth");
    expectInteger(bin?.height, 1, 20, "Bin height");

    const options = getBinOptions(bin);
    expectNumber(options.wallMm, 0.8, 3, "Wall thickness");
    expectNumber(options.floorMm, 0.8, 5, "Floor thickness");
    expectInteger(options.divisionsX, 1, 12, "Compartment columns");
    expectInteger(options.divisionsY, 1, 12, "Compartment rows");
    expectNumber(options.dividerMm, 0.8, 3, "Divider thickness");
    expectBoolean(options.solid, "Solid fill");
    expectBoolean(options.stackingLip, "Stacking lip");
    expectEnum(options.labelPosition, LABEL_POSITIONS, "Label position");
    expectNumber(options.labelDepthMm, 1, 12, "Label depth");
    expectNumber(options.labelWidthMm, 5, 100, "Label width");
    expectNumber(options.scoopRadiusMm, 0, 15, "Finger scoop radius");
    expectBoolean(options.magnetHoles, "Magnet pockets");
    expectNumber(options.magnetDiameterMm, 3, 8, "Magnet pocket diameter");
    expectNumber(options.magnetDepthMm, 0.5, 3, "Magnet pocket depth");
    expectBoolean(options.screwHoles, "Blind screw holes");
    expectNumber(options.screwDiameterMm, 1.5, 4, "Blind screw hole diameter");
    expectNumber(options.screwDepthMm, 1, 6, "Blind screw hole depth");

    const { dimensions, compartments, label, lip } = getBinLayout(bin);
    if (dimensions.innerWidthMm <= 0 || dimensions.innerDepthMm <= 0) {
        fail("Wall thickness leaves no bin interior. Use thinner walls or a larger bin.");
    }
    if (roundedRectRadius(dimensions.innerWidthMm, dimensions.innerDepthMm, options.wallMm) < 0) {
        fail("Wall thickness is too large for the rounded bin corners.");
    }

    const hasRecess = !!bin?.inlay;
    if (options.solid && (options.divisionsX > 1 || options.divisionsY > 1)) {
        fail("Solid bins cannot also use multiple compartments.");
    }
    if (hasRecess && (options.divisionsX > 1 || options.divisionsY > 1)) {
        fail("Recess bins support one compartment only.");
    }
    if ((hasRecess || options.solid) && options.labelPosition !== "none") {
        fail("Label ledges need a hollow compartment.");
    }
    if ((hasRecess || options.solid) && options.scoopRadiusMm > 0) {
        fail("Finger scoops need a hollow compartment.");
    }

    if (!options.solid && !hasRecess) {
        if (dimensions.usableHeightMm < BIN_GEOMETRY.minCavityMm) {
            fail("Floor thickness leaves less than 0.5 mm of cavity height.");
        }
        if (dimensions.compartmentWidthMm < BIN_GEOMETRY.minCompartmentMm || dimensions.compartmentDepthMm < BIN_GEOMETRY.minCompartmentMm) {
            fail("Compartment walls leave less than 3 mm of usable width or depth.");
        }
    }

    if (label) {
        if (options.labelPosition !== "full" && label.widthMm > dimensions.compartmentWidthMm) {
            fail("Label width does not fit in the selected compartment area.");
        }
        if (label.depthMm > dimensions.compartmentDepthMm - BIN_GEOMETRY.minCavityMm ||
            label.depthMm > dimensions.usableHeightMm - BIN_GEOMETRY.minCavityMm) {
            fail("Label ledge depth must fit inside the compartment and stay above the floor.");
        }
    }

    if (options.scoopRadiusMm > 0) {
        if (options.scoopRadiusMm > dimensions.compartmentDepthMm - BIN_GEOMETRY.minCavityMm ||
            options.scoopRadiusMm > dimensions.usableHeightMm - BIN_GEOMETRY.minCavityMm) {
            fail("Finger scoop radius must fit inside the front compartment depth and cavity height.");
        }
    }

    if (options.stackingLip && options.wallMm > 2.6) fail("A stacking lip requires walls no thicker than 2.6 mm.");

    const cavityRoofLimitMm = dimensions.cavityFloorMm - BIN_GEOMETRY.minRoofBelowCavityMm;
    if (options.magnetHoles && options.magnetDepthMm > cavityRoofLimitMm) {
        fail("Magnet pocket depth must leave at least 0.6 mm below the cavity floor.");
    }
    if (options.screwHoles && options.screwDepthMm > cavityRoofLimitMm) {
        fail("Blind screw hole depth must leave at least 0.6 mm below the cavity floor.");
    }

    const minEdgeClearanceMm = BIN_GEOMETRY.pitch / 2 - BIN_GEOMETRY.clearance / 2 - BIN_GEOMETRY.holeOffsetFromCellCenter;
    if (options.magnetHoles && options.magnetDiameterMm / 2 > minEdgeClearanceMm) {
        fail("Magnet pocket diameter does not fit around the standard hole centers.");
    }
    if (options.screwHoles && options.screwDiameterMm / 2 > minEdgeClearanceMm) {
        fail("Blind screw hole diameter does not fit around the standard hole centers.");
    }

    if (lip && (dimensions.innerWidthMm - lip.midWallMm * 2 <= 0 || dimensions.innerDepthMm - lip.midWallMm * 2 <= 0)) {
        fail("Stacking lip support leaves no opening at the top of the bin.");
    }

    for (const compartment of compartments) {
        if (![compartment.xMm, compartment.yMm, compartment.widthMm, compartment.depthMm].every(Number.isFinite)) {
            fail("Bin dimensions produced an invalid compartment layout.");
        }
    }

    return options;
}

export function holeSegments(options) {
    const holes = [
        ...(options.magnetHoles ? [{ depth: options.magnetDepthMm, radius: options.magnetDiameterMm / 2 }] : []),
        ...(options.screwHoles ? [{ depth: options.screwDepthMm, radius: options.screwDiameterMm / 2 }] : []),
    ];
    const ends = [...new Set(holes.map(hole => hole.depth))].sort((a, b) => a - b);
    const segments = [];
    let start = 0;
    for (const end of ends) {
        const radius = Math.max(...holes.filter(hole => hole.depth > start).map(hole => hole.radius));
        if (segments.at(-1)?.radiusMm === radius) segments.at(-1).endMm = end;
        else segments.push({ startMm: start, endMm: end, radiusMm: radius });
        start = end;
    }
    return segments.map((segment, index) => ({ ...segment, nextRadiusMm: segments[index + 1]?.radiusMm || 0 }));
}
