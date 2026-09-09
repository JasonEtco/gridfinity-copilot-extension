export function gridPreviewSize({ columns, rows, availableWidth, viewportHeight, zoom = 1 }) {
    if (![columns, rows].every(value => Number.isInteger(value) && value > 0) ||
        ![availableWidth, viewportHeight, zoom].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error("Grid preview dimensions must be positive.");
    }
    const maxHeight = Math.max(160, Math.min(360, viewportHeight * 0.45 - 14));
    const cell = Math.min(52, Math.max(1, availableWidth - 35) / columns, (maxHeight - 25) / rows);
    return { width: 28 + columns * cell * zoom, height: 25 + rows * cell * zoom, cell: cell * zoom };
}
