import { bounds, outlineFromPhoto, validateInlay, MAX_PHOTO_LENGTH } from "./inlay.mjs";
import { getBinOptions } from "./bin-options.mjs";

const SVG = "http://www.w3.org/2000/svg";

async function loadPhoto(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        throw new Error("Choose a JPEG, PNG or WebP photo under 10 MiB.");
    }
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width > 12000 || bitmap.height > 12000) throw new Error("Use a photo no larger than 12000 pixels per side.");
        const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser cannot prepare the photo.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        // Re-encoding removes source metadata and limits portable design size.
        let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        if (dataUrl.length > MAX_PHOTO_LENGTH) dataUrl = canvas.toDataURL("image/jpeg", 0.55);
        if (dataUrl.length > MAX_PHOTO_LENGTH) throw new Error("This photo is still too large. Crop it around the item and upload again.");
        return { dataUrl, width: canvas.width, height: canvas.height };
    } finally {
        bitmap.close();
    }
}

export function openPhotoEditor({ bin, onSave }) {
    const options = getBinOptions(bin);
    const maxDepth = bin.height * 7 - 4.75 - options.floorMm;
    const dialog = document.createElement("dialog");
    dialog.className = "photo-dialog";
    dialog.setAttribute("aria-label", `Item recess for ${bin.label}`);
    dialog.innerHTML = `
      <div class="dialog-heading"><div><p class="eyebrow">Photo to recess</p><h2>Fit an item into this bin</h2></div><button data-close aria-label="Close photo editor">Close</button></div>
      <p class="field-help">Use a top-down photo. Click around the item, then enter its measured width and recess depth. This makes a constant-depth recess, not a 3D scan.</p>
      <div class="photo-editor-grid">
        <section class="photo-tracing">
          <label>Item photo <input data-file type="file" accept="image/jpeg,image/png,image/webp"></label>
          <p class="field-help">JPEG, PNG or WebP, up to 10 MiB. A replacement photo resets the outline. Images stay in your saved design, not this repository.</p>
          <div class="photo-stage"><svg data-stage role="group" aria-label="Item photo and editable outline points. Click to add a point." viewBox="0 0 800 500"></svg><p data-empty>Upload a photo to trace the item.</p></div>
          <div class="form-actions"><button data-undo type="button">Undo last point</button><button data-clear type="button">Clear outline</button></div>
          <p data-summary class="field-help" role="status">Add at least 3 points. Use up to 128 points.</p>
        </section>
        <form data-form>
          <label>Measured item width (mm)<input data-width type="number" min="0.01" max="1343.5" step="any" required></label>
          <p class="field-help">The full left-to-right width of the traced item, measured in the photo's orientation. Photo perspective can change the fit.</p>
          <div class="field-pair"><label>Recess depth (mm)<input data-depth type="number" min="0.1" step="any" required></label><label>Clearance per side (mm)<input data-clearance type="number" min="0" max="3" step="any" required></label></div>
          <div class="field-pair"><label>Center X (mm)<input data-center-x type="number" step="any" required></label><label>Center Y (mm)<input data-center-y type="number" step="any" required></label></div>
          <p class="field-help">Coordinates use the unrotated bin. The recess must keep the configured walls, floor, and any stacking lip intact.</p>
          <fieldset><legend>Edit an outline point</legend><label>Point<select data-point></select></label><div class="field-pair"><label>Photo X (px)<input data-point-x type="number" min="0" step="any"></label><label>Photo Y (px)<input data-point-y type="number" min="0" step="any"></label></div><button data-remove-point type="button">Remove point</button></fieldset>
          <p data-error class="dialog-error" role="alert"></p>
          <div class="form-actions"><button data-save class="primary" type="submit">Apply item recess</button></div>
        </form>
      </div>`;
    const $ = selector => dialog.querySelector(selector);
    let photo = bin.inlay?.photo ? structuredClone(bin.inlay.photo) : null;
    let points = photo?.points?.map(point => [...point]) || [];
    let selected = points.length - 1;
    let saving = false;
    let loading = false;
    let generation = 0;
    const existingBounds = bin.inlay ? bounds(bin.inlay.outline) : null;
    $("[data-width]").value = photo?.itemWidthMm || (existingBounds ? existingBounds.maxX - existingBounds.minX : Math.min(25, bin.width * 42 - 8));
    $("[data-depth]").value = bin.inlay?.depth || Math.min(10, maxDepth);
    $("[data-depth]").max = maxDepth;
    $("[data-clearance]").value = bin.inlay?.clearance ?? 0.5;
    $("[data-center-x]").value = existingBounds ? (existingBounds.minX + existingBounds.maxX) / 2 : (bin.width * 42 - 0.5) / 2;
    $("[data-center-y]").value = existingBounds ? (existingBounds.minY + existingBounds.maxY) / 2 : (bin.depth * 42 - 0.5) / 2;
    const stage = $("[data-stage]");
    const number = selector => Number($(selector).value);
    const error = message => { $("[data-error]").textContent = message; };

    function currentInlay() {
        if (!photo) throw new Error("Upload a photo first.");
        const itemWidthMm = number("[data-width]");
        const inlay = {
            outline: outlineFromPhoto(points, itemWidthMm, bin, number("[data-center-x]"), number("[data-center-y]")),
            depth: number("[data-depth]"), clearance: number("[data-clearance]"),
            photo: { ...photo, points: points.map(point => [...point]), itemWidthMm },
        };
        validateInlay(inlay, bin);
        return inlay;
    }

    function draw() {
        stage.replaceChildren();
        $("[data-empty]").hidden = !!photo;
        stage.setAttribute("viewBox", `0 0 ${photo?.width || 800} ${photo?.height || 500}`);
        if (photo) {
            const image = document.createElementNS(SVG, "image");
            image.setAttribute("href", photo.dataUrl);
            image.setAttribute("width", photo.width);
            image.setAttribute("height", photo.height);
            stage.append(image);
        }
        if (points.length) {
            const outline = document.createElementNS(SVG, "polyline");
            outline.setAttribute("points", (points.length >= 3 ? [...points, points[0]] : points).map(point => point.join(",")).join(" "));
            outline.setAttribute("class", "photo-outline");
            outline.setAttribute("vector-effect", "non-scaling-stroke");
            stage.append(outline);
            points.forEach((point, index) => {
                const node = document.createElementNS(SVG, "circle");
                node.setAttribute("cx", point[0]);
                node.setAttribute("cy", point[1]);
                node.setAttribute("r", Math.max(photo.width, photo.height) / 90);
                node.setAttribute("class", `photo-point${index === selected ? " selected" : ""}`);
                node.setAttribute("role", "button");
                node.setAttribute("tabindex", "0");
                node.setAttribute("aria-label", `Outline point ${index + 1}`);
                node.addEventListener("click", event => { event.stopPropagation(); selected = index; draw(); });
                node.addEventListener("keydown", event => {
                    if (saving || loading) return;
                    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                    if (offsets[event.key]) {
                        event.preventDefault();
                        selected = index;
                        const amount = event.shiftKey ? 10 : 1;
                        points[index] = offsets[event.key].map((offset, axis) => Math.max(0, Math.min(axis ? photo.height : photo.width, point[axis] + offset * amount)));
                        draw();
                        stage.querySelectorAll("circle")[index]?.focus();
                    } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selected = index;
                        draw();
                        stage.querySelectorAll("circle")[index]?.focus();
                    } else if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        points.splice(index, 1);
                        selected = Math.min(index, points.length - 1);
                        draw();
                        stage.querySelectorAll("circle")[selected]?.focus();
                    }
                });
                stage.append(node);
            });
        }
        $("[data-point]").replaceChildren(...points.map((point, index) => {
            const option = document.createElement("option");
            option.value = index;
            option.textContent = `Point ${index + 1}`;
            option.selected = index === selected;
            return option;
        }));
        $("[data-point-x]").value = points[selected]?.[0] ?? "";
        $("[data-point-y]").value = points[selected]?.[1] ?? "";
        $("[data-point-x]").max = photo?.width || 0;
        $("[data-point-y]").max = photo?.height || 0;
        $("[data-save]").disabled = saving || loading || points.length < 3;
        $("[data-summary]").textContent = `${points.length} / 128 points. Click a point or use the point fields to edit it.`;
        error("");
        if (points.length >= 3) {
            try {
                const inlay = currentInlay();
                const box = bounds(inlay.outline);
                $("[data-summary]").textContent += ` Item: ${(box.maxX - box.minX).toFixed(1)} by ${(box.maxY - box.minY).toFixed(1)} mm.`;
            } catch (failure) {
                error(failure.message);
            }
        }
    }

    stage.addEventListener("click", event => {
        if (!photo || saving || loading) return;
        if (points.length >= 128) return error("Use at most 128 points. Remove a point before adding another.");
        const point = stage.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const matrix = stage.getScreenCTM();
        if (!matrix) return error("The photo is not visible. Resize the panel and try again.");
        const local = point.matrixTransform(matrix.inverse());
        if (local.x < 0 || local.y < 0 || local.x > photo.width || local.y > photo.height) return;
        points.push([Math.round(local.x * 100) / 100, Math.round(local.y * 100) / 100]);
        selected = points.length - 1;
        draw();
    });
    $("[data-file]").addEventListener("change", async event => {
        const file = event.target.files[0];
        if (!file || saving) return;
        const currentGeneration = ++generation;
        loading = true;
        $("[data-save]").disabled = true;
        error("");
        try {
            const loaded = await loadPhoto(file);
            if (currentGeneration !== generation || !dialog.open) return;
            photo = loaded;
            points = [];
            selected = -1;
            draw();
        } catch (failure) {
            error(`Could not load this photo: ${failure.message}`);
        } finally {
            if (currentGeneration === generation) {
                loading = false;
                $("[data-save]").disabled = saving || points.length < 3;
            }
        }
    });
    $("[data-undo]").addEventListener("click", () => { points.pop(); selected = points.length - 1; draw(); });
    $("[data-clear]").addEventListener("click", () => { points = []; selected = -1; draw(); });
    $("[data-point]").addEventListener("change", () => { selected = number("[data-point]"); draw(); });
    $("[data-remove-point]").addEventListener("click", () => {
        if (selected < 0) return;
        points.splice(selected, 1);
        selected = Math.min(selected, points.length - 1);
        draw();
    });
    for (const [selector, axis] of [["[data-point-x]", 0], ["[data-point-y]", 1]]) {
        $(selector).addEventListener("change", () => {
            if (!points[selected]) return;
            const value = number(selector);
            if (!Number.isFinite(value) || value < 0 || value > (axis ? photo.height : photo.width)) return error("Point coordinates must stay inside the photo.");
            points[selected][axis] = value;
            draw();
        });
    }
    for (const selector of ["[data-width]", "[data-depth]", "[data-clearance]", "[data-center-x]", "[data-center-y]"]) {
        $(selector).addEventListener("change", draw);
    }
    $("[data-form]").addEventListener("submit", async event => {
        event.preventDefault();
        if (saving || loading) return;
        try {
            const inlay = currentInlay();
            saving = true;
            dialog.querySelectorAll("button,input,select").forEach(node => { node.disabled = true; });
            await onSave(inlay);
            dialog.close();
        } catch (failure) {
            error(`Recess not saved: ${failure.message}`);
        } finally {
            saving = false;
            dialog.querySelectorAll("button,input,select").forEach(node => { node.disabled = false; });
            $("[data-save]").disabled = points.length < 3;
        }
    });
    $("[data-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
    dialog.addEventListener("close", () => { generation++; dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
    draw();
}
