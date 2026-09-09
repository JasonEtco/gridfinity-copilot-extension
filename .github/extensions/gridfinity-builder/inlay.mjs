import { getBinOptions } from "./bin-options.mjs";

const EPS = 1e-7;
export const MAX_PHOTO_LENGTH = 512 * 1024;

export class InlayError extends Error {
    constructor(message) {
        super(message);
        this.code = "invalid_inlay";
    }
}

function check(condition, message) {
    if (!condition) throw new InlayError(message);
}

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = points => points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) < EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;

function intersects(a, b, c, d) {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    return ((abC > EPS && abD < -EPS || abC < -EPS && abD > EPS) &&
        (cdA > EPS && cdB < -EPS || cdA < -EPS && cdB > EPS)) ||
        onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function validateOutline(points, maxPoints = 128) {
    check(Array.isArray(points) && points.length >= 3 && points.length <= maxPoints, `Use 3 to ${maxPoints} outline points.`);
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        check(Array.isArray(a) && a.length === 2 && a.every(Number.isFinite), "Outline points must be finite XY pairs.");
        check(Array.isArray(b) && b.length === 2 && b.every(Number.isFinite), "Outline points must be finite XY pairs.");
        check(Math.hypot(a[0] - b[0], a[1] - b[1]) > EPS, "Remove repeated outline points.");
    }
    check(Math.abs(area(points)) >= 0.01, "The outline must enclose an area.");
    for (let i = 0; i < points.length; i++) {
        const prev = points[(i + points.length - 1) % points.length], p = points[i], next = points[(i + 1) % points.length];
        check(!(Math.abs(cross(prev, p, next)) < EPS && (p[0] - prev[0]) * (next[0] - p[0]) + (p[1] - prev[1]) * (next[1] - p[1]) < 0), "The outline doubles back on itself.");
        for (let j = i + 1; j < points.length; j++) {
            if (j === i + 1 || i === 0 && j === points.length - 1) continue;
            check(!intersects(p, next, points[j], points[(j + 1) % points.length]), "The outline crosses or touches itself. Move or remove a point.");
        }
    }
    return points;
}

export function bounds(points) {
    return {
        minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
        minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])),
    };
}

// Rounded outward offset. Reject collapsed narrow notches rather than guessing a new topology.
export function expandedOutline(inlay) {
    validateOutline(inlay.outline);
    const radius = inlay.clearance;
    check(Number.isFinite(radius) && radius >= 0 && radius <= 3, "Clearance must be from 0 to 3 mm.");
    const points = area(inlay.outline) > 0 ? inlay.outline : [...inlay.outline].reverse();
    if (radius === 0) return points.map(p => [...p]);
    const expanded = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[(i + points.length - 1) % points.length], p = points[i], b = points[(i + 1) % points.length];
        const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
        const lu = Math.hypot(...u), lv = Math.hypot(...v);
        const n1 = [u[1] / lu, -u[0] / lu], n2 = [v[1] / lv, -v[0] / lv];
        const turn = cross(a, p, b);
        if (turn > EPS) {
            const start = Math.atan2(n1[1], n1[0]);
            const sweep = (Math.atan2(n2[1], n2[0]) - start + 2 * Math.PI) % (2 * Math.PI);
            const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 16)));
            for (let step = 0; step <= steps; step++) {
                const angle = start + sweep * step / steps;
                expanded.push([p[0] + Math.cos(angle) * radius, p[1] + Math.sin(angle) * radius]);
            }
        } else if (turn < -EPS) {
            const q = [p[0] + n1[0] * radius, p[1] + n1[1] * radius];
            const r = [p[0] + n2[0] * radius, p[1] + n2[1] * radius];
            const t = ((r[0] - q[0]) * v[1] - (r[1] - q[1]) * v[0]) / turn;
            expanded.push([q[0] + t * u[0], q[1] + t * u[1]]);
        } else {
            expanded.push([p[0] + n1[0] * radius, p[1] + n1[1] * radius]);
        }
    }
    validateOutline(expanded, 2304);
    return expanded.map(p => p.map(value => Math.round(value * 1e6) / 1e6));
}

export function outlineFromPhoto(points, itemWidthMm, bin, centerX, centerY) {
    validateOutline(points);
    check(Number.isFinite(itemWidthMm) && itemWidthMm > 0 && itemWidthMm <= 1343.5, "Enter the measured item width in mm.");
    const box = bounds(points);
    check(box.maxX > box.minX, "The outline needs a measurable width.");
    const scale = itemWidthMm / (box.maxX - box.minX);
    const x = centerX ?? (bin.width * 42 - 0.5) / 2;
    const y = centerY ?? (bin.depth * 42 - 0.5) / 2;
    check(Number.isFinite(x) && Number.isFinite(y), "Enter finite recess center coordinates.");
    return points.map(p => [
        (p[0] - (box.minX + box.maxX) / 2) * scale + x,
        (p[1] - (box.minY + box.maxY) / 2) * scale + y,
    ]);
}

function validatePhoto(photo) {
    check(photo && typeof photo === "object" && !Array.isArray(photo), "Photo must be an object.");
    check(Object.keys(photo).every(key => ["dataUrl", "width", "height", "points", "itemWidthMm"].includes(key)), "Photo contains an unknown field.");
    check(typeof photo.dataUrl === "string" && photo.dataUrl.length <= MAX_PHOTO_LENGTH &&
        /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo.dataUrl), "Use a JPEG photo under 512 KiB after encoding.");
    const encoded = photo.dataUrl.slice(23);
    check(encoded.length % 4 === 0, "Photo base64 is invalid.");
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    check(bytes.at(-2) === 255 && bytes.at(-1) === 217, "Photo JPEG is incomplete.");
    let dimensions;
    for (let i = 2; i + 8 < bytes.length;) {
        check(bytes[i] === 255, "Photo JPEG headers are invalid.");
        const marker = bytes[i + 1];
        if (marker === 218 || marker === 217) break;
        const length = bytes[i + 2] * 256 + bytes[i + 3];
        check(length >= 2 && i + length + 2 <= bytes.length, "Photo JPEG segment is invalid.");
        if ([192, 193, 194].includes(marker)) {
            dimensions = { height: bytes[i + 5] * 256 + bytes[i + 6], width: bytes[i + 7] * 256 + bytes[i + 8] };
            break;
        }
        i += length + 2;
    }
    check(dimensions && ["width", "height"].every(key => Number.isInteger(photo[key]) && photo[key] >= 1 && photo[key] <= 1200 && photo[key] === dimensions[key]), "Photo dimensions must match its JPEG and be at most 1200 pixels.");
    validateOutline(photo.points);
    check(photo.points.every(p => p[0] >= 0 && p[0] <= photo.width && p[1] >= 0 && p[1] <= photo.height), "Photo outline points must stay inside the photo.");
    check(Number.isFinite(photo.itemWidthMm) && photo.itemWidthMm > 0 && photo.itemWidthMm <= 1343.5, "Photo scale must have a measured width.");
}

export function validateInlay(inlay, bin) {
    if (inlay === null || inlay === undefined) return;
    check(typeof inlay === "object" && !Array.isArray(inlay), "Inlay must be an object or null.");
    check(Object.keys(inlay).every(key => ["outline", "depth", "clearance", "photo"].includes(key)), "Inlay contains an unknown field.");
    const options = getBinOptions(bin);
    check(Number.isFinite(inlay.depth) && inlay.depth >= 0.1 && inlay.depth <= bin.height * 7 - 4.75 - options.floorMm, `Recess depth must leave the 4.75 mm feet and a ${options.floorMm} mm floor intact.`);
    const width = bin.width * 42 - 0.5, depth = bin.depth * 42 - 0.5;
    const wall = Math.max(options.wallMm, options.stackingLip ? 2.6 : 0), radius = 3.75 - wall;
    for (const [x, y] of expandedOutline(inlay)) {
        check(x >= wall && x <= width - wall && y >= wall && y <= depth - wall, "The recess and clearance must fit inside the bin walls. Reduce the item width or use a larger bin.");
        const cx = Math.max(wall + radius, Math.min(width - wall - radius, x));
        const cy = Math.max(wall + radius, Math.min(depth - wall - radius, y));
        check(Math.hypot(x - cx, y - cy) <= radius + EPS, "The recess must stay inside the rounded bin corners.");
    }
    if (inlay.photo !== undefined) validatePhoto(inlay.photo);
}
