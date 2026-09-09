import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesignStore, MAX_BYTES } from "../.github/extensions/gridfinity-builder/storage.mjs";
import { Workbench, agentState } from "../.github/extensions/gridfinity-builder/workbench.mjs";
import { startServer } from "../.github/extensions/gridfinity-builder/server.mjs";

async function setup(t) {
    const root = await mkdtemp(join(tmpdir(), "gridfinity-http-"));
    const session = {};
    const bench = new Workbench(new DesignStore(root), session);
    session.rpc = { canvas: { open: async ({ instanceId, input }) => bench.open(instanceId, input) } };
    await bench.open("first-panel", { designId: "test-design" });
    t.after(() => rm(root, { recursive: true, force: true }));
    return { bench };
}

test("two panels share persisted design identity, not instance identity", async t => {
    const { bench } = await setup(t);
    await bench.open("second-panel", { designId: "test-design" });
    await bench.edit("first-panel", { expectedRevision: 0, operations: [{ type: "rename", name: "Shared" }] });
    assert.equal((await bench.state("second-panel")).design.name, "Shared");
    bench.close("first-panel");
    await bench.open("fresh-panel", { designId: "test-design" });
    assert.equal((await bench.state("fresh-panel")).design.revision, 1);
});

test("opening another design uses a fresh panel with replayable document input", async t => {
    const { bench } = await setup(t);
    const result = await bench.switchDesign("first-panel", { designId: "new-design", name: "New design" }, true);
    assert.equal(result.design.designId, "test-design");
    const panelId = [...bench.panels.keys()].find(id => id !== "first-panel");
    assert.equal((await bench.state(panelId)).design.designId, "new-design");
    await bench.open(panelId, { designId: "new-design" });
    assert.equal((await bench.state(panelId)).design.name, "New design");
});

test("canvas operations steer the saved design without a chat composer", async t => {
    const { bench } = await setup(t);
    await bench.edit("first-panel", {
        expectedRevision: 0,
        operations: [{ type: "resize_grid", columns: 4, rows: 3 }],
    });
    const updated = await bench.state("first-panel");
    assert.equal(updated.design.grid.columns, 4);
    assert.equal(updated.design.grid.rows, 3);
    assert.equal(updated.design.grid.drawer.widthMm, 292);
    assert.equal((await bench.store.read("test-design")).revision, 1);
    assert.equal(bench.ask, undefined);
    assert.equal(updated.request, undefined);
});

test("HTTP routes protect reads and writes, preserve rejected state and export downloads", async t => {
    const { bench } = await setup(t);
    const entry = await startServer("first-panel", bench, { html: "<!doctype html>", script: "/* app */", css: "body{}" });
    t.after(() => entry.close());
    const url = new URL(entry.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    const headers = { "X-Gridfinity-Token": token, "Content-Type": "application/json", Origin: url.origin };
    const call = (path, options) => fetch(`${url.origin}${path}`, options);
    assert.equal((await call("/")).status, 200);
    assert.equal((await call("/api/state")).status, 403);
    assert.equal((await call("/api/state", { headers })).status, 200);
    assert.equal((await call("/api/state", { headers: { ...headers, Origin: "https://evil.example" } })).status, 403);
    const edit = { expectedRevision: 0, operations: [{ type: "resize_grid", columns: 5, rows: 2 }] };
    assert.equal((await call("/api/edit", { method: "POST", headers, body: JSON.stringify(edit) })).status, 200);
    assert.equal((await call("/api/edit", { method: "POST", headers, body: JSON.stringify(edit) })).status, 409);
    assert.equal((await call("/api/edit", { method: "POST", headers, body: "{" })).status, 400);
    assert.equal((await call("/api/edit", { method: "POST", headers, body: " ".repeat(MAX_BYTES + 1) })).status, 413);
    assert.equal((await call("/api/edit", { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "{}" })).status, 400);
    const exported = await call("/api/export?format=json", { headers });
    assert.match(exported.headers.get("content-disposition"), /test-design.json/);
    assert.equal((await exported.json()).revision, 1);
    const scad = await call("/api/export?format=scad&part=baseplate", { headers });
    assert.match(await scad.text(), /columns = 5;/);
    assert.equal((await call("/api/new", { method: "POST", headers, body: JSON.stringify({ designId: "../bad", name: "No" }) })).status, 400);
    const ask = await call("/api/ask", { method: "POST", headers, body: JSON.stringify({ prompt: "Make a bin" }) });
    assert.equal(ask.status, 404);
    assert.equal((await bench.state("first-panel")).design.revision, 1);
});

test("STL transport and explicit Bambu handoff preserve revision and access checks", async t => {
    const { bench } = await setup(t);
    const calls = [];
    const bytes = Buffer.from([0, 1, 2, 255]);
    bench.fabrication = {
        status: async () => ({ stl: true, bambu: true, message: "Ready" }),
        render: async (design, input) => {
            calls.push(["render", design.revision, input.part]);
            return { filename: "generated.stl", path: "/test/generated.stl", contentType: "model/stl", content: bytes };
        },
        openInBambu: async (design, input) => {
            calls.push(["bambu", design.revision, input.part]);
            return { message: "Sent local file to Bambu Studio." };
        },
    };
    const entry = await startServer("first-panel", bench, { html: "", script: "", css: "" });
    t.after(() => entry.close());
    const url = new URL(entry.url);
    const headers = { "X-Gridfinity-Token": new URLSearchParams(url.hash.slice(1)).get("token"), "Content-Type": "application/json", Origin: url.origin };
    const call = (path, options = {}) => fetch(url.origin + path, { headers, ...options });
    assert.equal((await (await call("/api/fabrication/status")).json()).stl, true);
    const response = await call("/api/export?format=stl&part=baseplate&expectedRevision=0");
    assert.equal(response.headers.get("content-type"), "model/stl");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal((await call("/api/export?format=stl&expectedRevision=1")).status, 409);
    assert.equal((await call("/api/export?format=stl&expectedRevision=0evil")).status, 400);
    const body = JSON.stringify({ part: "baseplate", expectedRevision: 0 });
    assert.equal((await call("/api/open-bambu", { method: "POST", body })).status, 200);
    assert.equal((await call("/api/open-bambu", { method: "POST", body, headers: { ...headers, Origin: "https://foreign.example" } })).status, 403);
    assert.equal((await call("/api/open-bambu", { method: "POST", body: JSON.stringify({ part: "baseplate", expectedRevision: 0, app: "untrusted" }) })).status, 400);
    assert.deepEqual(calls, [["render", 0, "baseplate"], ["bambu", 0, "baseplate"]]);
    const artifact = agentState(await bench.export("first-panel", { format: "stl", expectedRevision: 0 }));
    assert.deepEqual(artifact, { filename: "generated.stl", path: "/test/generated.stl", contentType: "model/stl", bytes: 4 });
});

test("generator draft exports validate input without changing the saved layout", async t => {
    const { bench } = await setup(t);
    const before = await bench.state("first-panel");
    const draft = { version: 1, designId: "grid-draft", name: "Draft", revision: 0, grid: { columns: 2, rows: 3 }, bins: [] };
    const exported = await bench.exportDraft("first-panel", { design: draft, format: "scad", part: "baseplate" });
    assert.match(exported.content, /columns = 2;/);
    assert.deepEqual(await bench.state("first-panel"), before);
    await assert.rejects(bench.exportDraft("first-panel", { design: { ...draft, grid: { columns: 0, rows: 3 } }, format: "scad" }));
    const entry = await startServer("first-panel", bench, { html: "", script: "", css: "" });
    t.after(() => entry.close());
    const url = new URL(entry.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    const body = JSON.stringify({ design: draft, format: "scad", part: "baseplate" });
    const denied = await fetch(url.origin + "/api/export-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(denied.status, 403);
    const accepted = await fetch(url.origin + "/api/export-draft", { method: "POST", headers: { "Content-Type": "application/json", "X-Gridfinity-Token": token, Origin: url.origin }, body });
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get("content-disposition"), /grid-draft-baseplate.scad/);
    assert.deepEqual(await bench.state("first-panel"), before);
});
