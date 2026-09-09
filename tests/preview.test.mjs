import test from "node:test";
import assert from "node:assert/strict";
import { gridPreviewSize } from "../.github/extensions/gridfinity-builder/preview.mjs";

test("a tall ALEX layout fits the compact preview without huge cells", () => {
    const size = gridPreviewSize({ columns: 6, rows: 12, availableWidth: 700, viewportHeight: 950 });
    assert.ok(size.height <= 360);
    assert.ok(size.width <= 700);
    assert.ok(size.cell < 30);
});

test("wide, narrow and maximum grids fit both available axes", () => {
    for (const [columns, rows] of [[1, 1], [12, 6], [6, 12], [32, 32]]) {
        for (const availableWidth of [280, 650, 1000]) {
            const size = gridPreviewSize({ columns, rows, availableWidth, viewportHeight: 800 });
            assert.ok(size.width <= availableWidth);
            assert.ok(size.height <= 346);
            assert.ok(size.cell <= 52);
        }
    }
});

test("short panels still fit within their minimum preview area", () => {
    for (const viewportHeight of [200, 300, 400, 600]) {
        const size = gridPreviewSize({ columns: 6, rows: 12, availableWidth: 400, viewportHeight });
        const areaHeight = Math.max(174, Math.min(380, viewportHeight * 0.45));
        assert.ok(size.height + 14 <= areaHeight);
    }
});

test("zoom increases the preview, not the physical design", () => {
    const options = { columns: 6, rows: 12, availableWidth: 700, viewportHeight: 950 };
    const normal = gridPreviewSize(options), zoomed = gridPreviewSize({ ...options, zoom: 2 });
    assert.equal(zoomed.cell, normal.cell * 2);
    assert.equal(zoomed.width - 28, (normal.width - 28) * 2);
    assert.throws(() => gridPreviewSize({ ...options, columns: 0 }), /positive/);
});
