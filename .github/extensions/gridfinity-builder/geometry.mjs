import { validateDesign, footprint, requireThat } from "./model.mjs";
import { expandedOutline } from "./inlay.mjs";
import { gridFrame } from "./grid.mjs";
import { binScadCall, binScadModules } from "./bin-scad.mjs";

export const GEOMETRY = Object.freeze({
    pitch: 42, heightUnit: 7, clearance: 0.5, footHeight: 4.75,
    footSections: [[0, 35.6, 0.8], [0.8, 37.2, 1.6], [2.6, 37.2, 1.6], [4.75, 41.5, 3.75]],
    socketSections: [[0, 36.3, 1.15], [0.7, 37.7, 1.85], [2.5, 37.7, 1.85], [4.65, 42, 4]],
    wall: 1.2, floor: 1.2, plateFloor: 2, socketRelief: 0.35,
});

export function exportScad(design, part = "baseplate", binId) {
    validateDesign(design);
    requireThat(["baseplate", "bins", "bin", "spacers"].includes(part), "SCAD part must be baseplate, bins, bin or spacers.");
    const bins = part === "bin" ? design.bins.filter(bin => bin.id === binId) : design.bins;
    if (part === "bin") requireThat(bins.length === 1, "Select an existing bin.", "not_found");
    if (part === "bins" || part === "bin") requireThat(bins.length > 0, "Add a bin before exporting bins.");
    let calls = part === "baseplate"
        ? "baseplate(columns, rows);"
        : bins.map(bin => {
            if (bin.options) {
                const rotation = bin.rotation === 90 ? `translate([${bin.depth * 42}, 0, 0]) rotate([0,0,90]) ` : "";
                return `// Bin ${bin.id}\ntranslate([${part === "bin" ? 0 : bin.x}*pitch, ${part === "bin" ? 0 : bin.y}*pitch, 0]) ${rotation}${binScadCall(bin)}`;
            }
            const size = footprint(bin);
            let recess = "";
            if (bin.inlay) {
                const outline = expandedOutline(bin.inlay).map(([x, y]) => bin.rotation === 90 ? [bin.depth * 42 - 0.5 - y, x] : [x, y]);
                recess = `, ${JSON.stringify(outline)}, ${bin.inlay.depth}`;
            }
            return `// Bin ${bin.id}\ntranslate([${part === "bin" ? 0 : bin.x}*pitch, ${part === "bin" ? 0 : bin.y}*pitch, 0]) bin(${size.width}, ${size.depth}, ${bin.height}${recess});`;
        }).join("\n");
    if (part === "baseplate" && (design.grid.baseplate || gridFrame(design.grid).marginMode === "integrated")) {
        const frame = gridFrame(design.grid);
        const integrated = frame.marginMode === "integrated";
        const c = design.grid.drawer?.clearanceMm || 0;
        calls = `baseplate(columns, rows, ${frame.floorMm}, ${integrated ? frame.widthMm - 2 * c : frame.gridWidthMm}, ${integrated ? frame.depthMm - 2 * c : frame.gridDepthMm}, ${integrated ? frame.originX - c : 0}, ${integrated ? frame.originY - c : 0});`;
    }
    if (part === "spacers") {
        const spacers = gridFrame(design.grid).spacers;
        requireThat(spacers.length > 0, "This grid has no edge spacers. Fit a drawer and enable spacers first.");
        let x = 0;
        calls = spacers.map(spacer => {
            const line = `// ${spacer.id} edge spacer\ntranslate([${x}, 0, 0]) cube([${spacer.width}, ${spacer.depth}, ${spacer.height}]);`;
            x += spacer.width + 5;
            return line;
        }).join("\n");
    }
    return `// Gridfinity Builder - editable experimental geometry (MIT).
// Units: mm. Fit-test one cell before fabrication. Not certified print-ready.
// Optional bin construction features are defined by each bin's settings.
// Nominal bin height includes feet. Preview meshes are not certified fabrication output.
// Photo inlays are measured 2D outlines with a constant recess depth, not 3D scans.
// Dimensions: gridfinity.xyz/specification and Stu142/Gridfinity-Documentation.
pitch = ${GEOMETRY.pitch};
unit_h = ${GEOMETRY.heightUnit};
clearance = ${GEOMETRY.clearance}; // total XY gap per bin, not per cell
wall = ${GEOMETRY.wall};
floor_thickness = ${GEOMETRY.floor};
plate_floor = ${GEOMETRY.plateFloor};
socket_relief = ${GEOMETRY.socketRelief};
columns = ${design.grid.columns};
rows = ${design.grid.rows};
$fn = 48;
eps = 0.01; // Boolean overlap, not a printer tolerance
foot_sections = ${JSON.stringify(GEOMETRY.footSections)};
socket_sections = ${JSON.stringify(GEOMETRY.socketSections)};

module rounded_rect(w, d, r) {
    hull() for (x = [r, w-r]) for (y = [r, d-r])
        translate([x,y]) circle(r=r);
}

// Exact-height rounded-square sections. The standard profiles share corner centers.
module profile(sections) {
    for (i = [0:len(sections)-2]) {
        a = sections[i];
        b = sections[i+1];
        corner = a[1]/2-a[2];
        assert(abs(corner-(b[1]/2-b[2]))<0.000001);
        hull() for (x=[-corner,corner]) for (y=[-corner,corner])
            translate([x,y,a[0]]) cylinder(h=b[0]-a[0],r1=a[2],r2=b[2]);
    }
}

module bin(w, d, u, recess=[], recess_depth=0) {
    outer_w = w*pitch-clearance;
    outer_d = d*pitch-clearance;
    h = u*unit_h;
    assert(w>=1 && d>=1 && u>=1 && wall>0 && wall<3.75);
    assert(floor_thickness>0 && 4.75+floor_thickness<h);
    assert(len(recess)==0 || (recess_depth>0 && recess_depth<=h-4.75-floor_thickness));
    difference() {
        union() {
            for (x=[0:w-1]) for (y=[0:d-1])
                translate([(x+0.5)*pitch,(y+0.5)*pitch,0])
                    // Trim tips buried inside the body to avoid coincident STL seam facets.
                    intersection() {
                        profile(foot_sections);
                        translate([-pitch/2,-pitch/2,-eps]) cube([pitch,pitch,4.75+eps/2]);
                    }
            translate([clearance/2,clearance/2,4.75-eps])
                linear_extrude(h-4.75+eps) rounded_rect(outer_w,outer_d,3.75);
        }
        if (len(recess)>=3)
            translate([clearance/2,clearance/2,h-recess_depth])
                linear_extrude(recess_depth+eps) polygon(recess);
        else
            translate([clearance/2+wall,clearance/2+wall,4.75+floor_thickness])
                linear_extrude(h) rounded_rect(outer_w-2*wall,outer_d-2*wall,3.75-wall);
    }
}

module baseplate(w, d, floor_h=plate_floor, outer_w=0, outer_d=0, grid_x=0, grid_y=0) {
    h = floor_h+socket_relief+4.65;
    // Extend the cutter tip above the plate, leaving a tiny finite rim instead of coincident knife edges.
    cutter_sections = concat([[floor_h==0 ? -eps : 0,socket_sections[0][1],socket_sections[0][2]]],
        [for (i=[0:len(socket_sections)-1])
            [socket_relief+socket_sections[i][0]+(i==len(socket_sections)-1 ? eps : 0),socket_sections[i][1],socket_sections[i][2]]]);
    assert(w>=1 && d>=1 && floor_h>=0 && socket_relief>=0.35);
    difference() {
        linear_extrude(h) rounded_rect(outer_w>0 ? outer_w : w*pitch,outer_d>0 ? outer_d : d*pitch,4);
        for (x=[0:w-1]) for (y=[0:d-1])
            translate([grid_x+(x+0.5)*pitch,grid_y+(y+0.5)*pitch,floor_h]) profile(cutter_sections);
    }
}

${binScadModules()}

${calls}
`;
}
