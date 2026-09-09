import test from "node:test";
import assert from "node:assert/strict";
import { renderHtml } from "../.github/extensions/gridfinity-builder/renderer.mjs";

test("one header contains task tabs and collapsed file/export controls", () => {
    const html = renderHtml();
    const header = html.match(/<header class="app-header">([\s\S]*?)<\/header>/)?.[1];
    assert.ok(header);
    for (const id of ["tab-layout", "tab-bin", "tab-grid", "file-menu", "export-panel"]) {
        assert.ok(header.includes(`id="${id}"`));
    }
    assert.doesNotMatch(html, /class="(?:toolbar|fabrication-bar)"/);
    assert.doesNotMatch(html, /Every tool in its place/);
    assert.doesNotMatch(header, /<details[^>]*\sopen(?:\s|>)/);
});

test("reorganized header preserves each action and status element exactly once", () => {
    const ids = [...renderHtml().matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of [
        "new-design", "open-design", "save-design", "import-json", "export-json",
        "fabrication-part", "export-stl", "open-bambu", "refresh-fabrication",
        "save-status", "connection-status", "connection-dot", "fabrication-status", "export-context", "export-active-scad",
    ]) assert.equal(ids.filter(value => value === id).length, 1);
});

test("drawer measurements and fit-error recovery are available directly in Layout", () => {
    const html = renderHtml();
    const designForm = html.match(/<form id="design-form">([\s\S]*?)<\/form>/)?.[1];
    assert.ok(designForm);
    for (const id of ["grid-columns", "grid-rows", "layout-drawer-enabled", "layout-drawer-width", "layout-drawer-depth", "layout-drawer-clearance"]) {
        assert.ok(designForm.includes(`id="${id}"`));
    }
    assert.match(html, /id="edit-drawer-error"/);
});
