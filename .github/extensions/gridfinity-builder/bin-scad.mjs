import { expandedOutline } from "./inlay.mjs";
import { getBinLayout, validateBinOptions } from "./bin-options.mjs";

function formatNumber(value) {
    if (!Number.isFinite(value)) throw new TypeError("SCAD parameters must be finite.");
    return String(Number(value.toFixed(6)));
}

function formatBoolean(value) {
    return value ? "true" : "false";
}

function formatEnum(value, allowed) {
    if (!allowed.includes(value)) throw new TypeError("SCAD enum parameter is invalid.");
    return JSON.stringify(value);
}

function formatPointRing(points) {
    return `[${points.map(([x, y]) => `[${formatNumber(x)}, ${formatNumber(y)}]`).join(", ")}]`;
}

export function binScadModules() {
    return `
function configured_compartment_size(inner_span, divisions, divider_mm) =
    (inner_span - divider_mm * (divisions - 1)) / divisions;

function configured_inner_radius(outer_w, outer_d, wall_mm) =
    max(0, min(3.75 - wall_mm, (outer_w - 2 * wall_mm) / 2, (outer_d - 2 * wall_mm) / 2));

module configured_foot_array(cells_x, cells_y) {
    for (x = [0:cells_x-1]) for (y = [0:cells_y-1])
        translate([(x + 0.5) * pitch, (y + 0.5) * pitch, 0])
            intersection() {
                profile(foot_sections);
                translate([-pitch/2, -pitch/2, -eps]) cube([pitch, pitch, 4.75 + eps / 2]);
            }
}

module configured_lip(outer_w, outer_d, body_h, wall_mm) {
    support = max(0, 2.6-wall_mm);
    bottom = body_h-support-eps;
    sections = [[bottom-eps,wall_mm-eps],[body_h,2.6],[body_h+0.7,1.9],
        [body_h+2.5,1.9],[body_h+4.4+eps,0]];
    difference() {
        translate([clearance/2,clearance/2,bottom])
            linear_extrude(body_h+4.4-bottom) rounded_rect(outer_w,outer_d,3.75);
        for (i=[0:len(sections)-2])
            hull() for (x=[3.75,outer_w-3.75]) for (y=[3.75,outer_d-3.75])
                translate([clearance/2+x,clearance/2+y,sections[i][0]])
                    cylinder(h=sections[i+1][0]-sections[i][0],r1=3.75-sections[i][1],r2=3.75-sections[i+1][1]);
    }
}

module configured_label_shelf(label_position, outer_w, wall_mm, body_h, label_depth_mm, label_width_mm, divisions_x, divider_mm) {
    if (label_position != "none") {
        compartment_w = configured_compartment_size(outer_w - 2 * wall_mm, divisions_x, divider_mm);
        if (label_position == "full")
            for (column = [0:divisions_x-1]) {
                label_x = clearance / 2 + wall_mm + column * (compartment_w + divider_mm);
                configured_label_wedge(label_x,wall_mm,body_h,compartment_w,label_depth_mm);
            }
        else {
            label_w = label_width_mm;
            label_x = label_position == "left"
                ? clearance / 2 + wall_mm
                : label_position == "right"
                    ? clearance / 2 + outer_w - wall_mm - label_w
                    : clearance / 2 + wall_mm + (outer_w - 2 * wall_mm - label_w) / 2;
            configured_label_wedge(label_x,wall_mm,body_h,label_w,label_depth_mm);
        }
    }
}

module configured_label_wedge(x,wall_mm,body_h,width_mm,depth_mm) {
    translate([x-eps,clearance/2+wall_mm,body_h-0.6])
        rotate([90,0,90]) linear_extrude(width_mm+2*eps)
            polygon([[-eps,-depth_mm],[-eps,0],[depth_mm,0]]);
}

module configured_scoops(divisions_x, compartment_w, wall_mm, floor_mm, scoop_radius_mm, divider_mm) {
    if (scoop_radius_mm > 0)
        for (column = [0:divisions_x-1]) {
            compartment_x = clearance / 2 + wall_mm + column * (compartment_w + divider_mm);
            translate([compartment_x-eps,clearance/2+wall_mm,4.75+floor_mm])
                rotate([90,0,90]) linear_extrude(compartment_w+2*eps)
                    polygon(concat([[-eps,-eps],[scoop_radius_mm,-eps]],
                        [for(i=[0:32]) [scoop_radius_mm+scoop_radius_mm*cos(-90-i*90/32),
                            scoop_radius_mm+scoop_radius_mm*sin(-90-i*90/32)]],[[-eps,scoop_radius_mm]]));
        }
}

module configured_hollow_cavities(outer_w, outer_d, body_h, wall_mm, floor_mm, divisions_x, divisions_y, divider_mm) {
    cavity_floor = 4.75 + floor_mm;
    inner_w = outer_w - 2 * wall_mm;
    inner_d = outer_d - 2 * wall_mm;
    compartment_w = configured_compartment_size(inner_w, divisions_x, divider_mm);
    compartment_d = configured_compartment_size(inner_d, divisions_y, divider_mm);
    inner_r = configured_inner_radius(outer_w, outer_d, wall_mm);
    for (row = [0:divisions_y-1]) for (column = [0:divisions_x-1]) {
        compartment_x = clearance / 2 + wall_mm + column * (compartment_w + divider_mm);
        compartment_y = clearance / 2 + wall_mm + row * (compartment_d + divider_mm);
        translate([clearance/2+wall_mm,clearance/2+wall_mm,cavity_floor])
            linear_extrude(body_h-cavity_floor+eps*2)
                intersection() {
                    rounded_rect(inner_w,inner_d,inner_r);
                    translate([column*(compartment_w+divider_mm),row*(compartment_d+divider_mm)])
                        square([compartment_w,compartment_d]);
                }
    }
}

module configured_recess(body_h, recess_depth_mm, recess) {
    translate([clearance / 2, clearance / 2, body_h - recess_depth_mm])
        linear_extrude(recess_depth_mm + eps * 2) polygon(recess);
}

module configured_bottom_holes(cells_x, cells_y, magnet_holes, magnet_d_mm, magnet_depth_mm, screw_holes, screw_d_mm, screw_depth_mm) {
    for (cell_x = [0:cells_x-1]) for (cell_y = [0:cells_y-1])
        for (offset_x = [-13, 13]) for (offset_y = [-13, 13]) {
            hole_x = cell_x * pitch + pitch / 2 + offset_x;
            hole_y = cell_y * pitch + pitch / 2 + offset_y;
            if (magnet_holes)
                translate([hole_x, hole_y, -eps]) cylinder(h = magnet_depth_mm + eps, d = magnet_d_mm);
            if (screw_holes)
                translate([hole_x, hole_y, -eps]) cylinder(h = screw_depth_mm + eps, d = screw_d_mm);
        }
}

module configured_bin(cells_x, cells_y, body_h, wall_mm, floor_mm, divisions_x, divisions_y, divider_mm,
        solid_fill, stacking_lip, label_position, label_depth_mm, label_width_mm, scoop_radius_mm,
        magnet_holes, magnet_d_mm, magnet_depth_mm, screw_holes, screw_d_mm, screw_depth_mm,
        recess = [], recess_depth_mm = 0) {
    outer_w = cells_x * pitch - clearance;
    outer_d = cells_y * pitch - clearance;
    total_h = body_h + (stacking_lip ? 4.4 : 0);
    assert(cells_x >= 1 && cells_y >= 1 && body_h >= unit_h);
    difference() {
        union() {
            difference() {
                union() {
                    configured_foot_array(cells_x, cells_y);
                    translate([clearance/2,clearance/2,4.75-eps])
                        linear_extrude(body_h-4.75+eps) rounded_rect(outer_w,outer_d,3.75);
                }
                if (len(recess)>=3) configured_recess(body_h,recess_depth_mm,recess);
                else if (!solid_fill) {
                    configured_hollow_cavities(outer_w,outer_d,body_h,wall_mm,floor_mm,divisions_x,divisions_y,divider_mm);
                }
            }
            if (stacking_lip) configured_lip(outer_w,outer_d,body_h,wall_mm);
            if (!solid_fill && len(recess)==0) {
                intersection() {
                    union() {
                        configured_label_shelf(label_position, outer_w, wall_mm, body_h, label_depth_mm, label_width_mm, divisions_x, divider_mm);
                        configured_scoops(divisions_x,configured_compartment_size(outer_w-2*wall_mm,divisions_x,divider_mm),wall_mm,floor_mm,scoop_radius_mm,divider_mm);
                    }
                    translate([clearance/2,clearance/2,0]) linear_extrude(body_h)
                        rounded_rect(outer_w,outer_d,3.75);
                }
            }
        }
        configured_bottom_holes(cells_x,cells_y,magnet_holes,magnet_d_mm,magnet_depth_mm,screw_holes,screw_d_mm,screw_depth_mm);
    }
}
`;
}

export function binScadCall(bin) {
    validateBinOptions(bin);
    const { options } = getBinLayout(bin);
    const recess = bin.inlay ? formatPointRing(expandedOutline(bin.inlay)) : "[]";
    const recessDepthMm = bin.inlay ? formatNumber(bin.inlay.depth) : "0";
    return `configured_bin(${[
        formatNumber(bin.width),
        formatNumber(bin.depth),
        formatNumber(bin.height * 7),
        formatNumber(options.wallMm),
        formatNumber(options.floorMm),
        formatNumber(options.divisionsX),
        formatNumber(options.divisionsY),
        formatNumber(options.dividerMm),
        formatBoolean(options.solid),
        formatBoolean(options.stackingLip),
        formatEnum(options.labelPosition, ["none", "left", "center", "right", "full"]),
        formatNumber(options.labelDepthMm),
        formatNumber(options.labelWidthMm),
        formatNumber(options.scoopRadiusMm),
        formatBoolean(options.magnetHoles),
        formatNumber(options.magnetDiameterMm),
        formatNumber(options.magnetDepthMm),
        formatBoolean(options.screwHoles),
        formatNumber(options.screwDiameterMm),
        formatNumber(options.screwDepthMm),
        recess,
        recessDepthMm,
    ].join(", ")});`;
}
