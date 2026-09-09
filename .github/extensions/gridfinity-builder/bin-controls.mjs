import { BIN_OPTION_DEFAULTS, getBinOptions } from "./bin-options.mjs";

const GROUPS = [
    ["Compartments and walls", [
        ["wallMm", "Wall thickness (mm)", 0.8, 3, 0.1],
        ["floorMm", "Floor thickness (mm)", 0.8, 5, 0.1],
        ["divisionsX", "Compartment columns", 1, 12, 1],
        ["divisionsY", "Compartment rows", 1, 12, 1],
        ["dividerMm", "Divider thickness (mm)", 0.8, 3, 0.1],
        ["solid", "Solid fill"],
    ]],
    ["Lip, labels and access", [
        ["stackingLip", "Stacking lip (+4.4 mm)"],
        ["labelPosition", "Label ledge", ["none", "left", "center", "right", "full"]],
        ["labelDepthMm", "Label depth (mm)", 1, 12, 0.5],
        ["labelWidthMm", "Label width (mm)", 5, 100, 1],
        ["scoopRadiusMm", "Finger scoop radius (mm; 0 = off)", 0, 15, 0.5],
    ]],
    ["Magnets and screws", [
        ["magnetHoles", "Magnet pockets"],
        ["magnetDiameterMm", "Magnet pocket diameter (mm)", 3, 8, 0.1],
        ["magnetDepthMm", "Magnet pocket depth (mm)", 0.5, 3, 0.1],
        ["screwHoles", "Blind screw holes"],
        ["screwDiameterMm", "Screw hole diameter (mm)", 1.5, 4, 0.1],
        ["screwDepthMm", "Screw hole depth (mm)", 1, 6, 0.1],
    ]],
];

export function renderBinControls(prefix) {
    return `<div class="bin-construction">${GROUPS.map(([title, fields]) => `
      <details class="construction-group"><summary>${title}</summary><div class="construction-fields">
      ${fields.map(([key, label, min, max, step]) => {
        const id = `${prefix}-option-${key}`;
        const value = BIN_OPTION_DEFAULTS[key];
        if (typeof value === "boolean") return `<label class="checkbox-label"><input id="${id}" type="checkbox"${value ? " checked" : ""}>${label}</label>`;
        if (Array.isArray(min)) return `<label for="${id}">${label}</label><select id="${id}">${min.map(choice => `<option value="${choice}"${choice === value ? " selected" : ""}>${choice[0].toUpperCase() + choice.slice(1)}</option>`).join("")}</select>`;
        return `<label for="${id}">${label}</label><input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required>`;
      }).join("")}
      </div></details>`).join("")}</div>`;
}

export function syncBinControls(prefix, hasRecess = false) {
    const input = key => document.getElementById(`${prefix}-option-${key}`);
    const disable = (key, inactive) => { input(key).disabled = inactive && input(key).checkValidity(); };
    const solid = input("solid").checked || hasRecess;
    const label = input("labelPosition").value;
    const single = Number(input("divisionsX").value) === 1 && Number(input("divisionsY").value) === 1;
    disable("divisionsX", solid && single);
    disable("divisionsY", solid && single);
    disable("dividerMm", solid || single);
    disable("labelPosition", solid && label === "none");
    disable("labelDepthMm", label === "none");
    disable("labelWidthMm", label === "none" || label === "full");
    disable("scoopRadiusMm", solid && Number(input("scoopRadiusMm").value) === 0);
    for (const key of ["magnetDiameterMm", "magnetDepthMm"]) disable(key, !input("magnetHoles").checked);
    for (const key of ["screwDiameterMm", "screwDepthMm"]) disable(key, !input("screwHoles").checked);
}

export function readBinControls(prefix, hasRecess = false) {
    syncBinControls(prefix, hasRecess);
    const options = {};
    for (const [, fields] of GROUPS) for (const [key] of fields) {
        const input = document.getElementById(`${prefix}-option-${key}`);
        options[key] = input.type === "checkbox" ? input.checked : input.tagName === "SELECT" ? input.value : Number(input.value);
    }
    return options;
}

export function fillBinControls(prefix, bin) {
    const options = getBinOptions(bin);
    for (const [, fields] of GROUPS) for (const [key] of fields) {
        const input = document.getElementById(`${prefix}-option-${key}`);
        if (input.type === "checkbox") input.checked = options[key];
        else input.value = options[key];
    }
    syncBinControls(prefix, !!bin.inlay);
}
