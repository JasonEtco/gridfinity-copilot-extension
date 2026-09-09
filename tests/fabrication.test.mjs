import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { FabricationService, isValidStl, normalizeBinaryStl } from "../.github/extensions/gridfinity-builder/fabrication.mjs";
import { applyOperations, newDesign } from "../.github/extensions/gridfinity-builder/model.mjs";

async function scratch(t, name = "case") {
    const root = await mkdtemp(join(tmpdir(), `gridfinity-${name}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

async function executableFile(path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await chmod(path, 0o700);
    return path;
}

async function bambuBundle(root) {
    const bundle = join(root, "BambuStudio.app");
    const executable = join(bundle, "Contents", "MacOS", "BambuStudio");
    await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true, mode: 0o700 });
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await chmod(executable, 0o700);
    return bundle;
}

function sampleDesign() {
    return applyOperations(newDesign("fixture"), 0, [
        { type: "resize_grid", columns: 2, rows: 2 },
        { type: "add_bin", bin: { id: "bin-a", label: "A", x: 0, y: 0, width: 1, depth: 1, height: 3, rotation: 0, color: "blue" } },
    ]);
}

function binaryStl() {
    const buffer = Buffer.alloc(84 + 50);
    buffer.write("Binary STL", 0, "ascii");
    buffer.writeUInt32LE(1, 80);
    buffer.writeFloatLE(0, 84);
    buffer.writeFloatLE(0, 88);
    buffer.writeFloatLE(1, 92);
    const vertices = [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 1],
    ];
    let offset = 96;
    for (const vertex of vertices) {
        buffer.writeFloatLE(vertex[0], offset);
        buffer.writeFloatLE(vertex[1], offset + 4);
        buffer.writeFloatLE(vertex[2], offset + 8);
        offset += 12;
    }
    return buffer;
}

test("status reports missing OpenSCAD and missing Bambu distinctly", async t => {
    const root = await scratch(t, "status-missing");
    const service = new FabricationService({ artifactRoot: root, platform: "linux", env: { PATH: "" } });
    const status = await service.status();
    assert.equal(status.stl, false);
    assert.equal(status.bambu, false);
    assert.equal(status.missingOpenSCAD, true);
    assert.equal(status.missingBambu, true);
    assert.match(status.message, /OpenSCAD/);
    assert.match(status.message, /Bambu Studio/);
    await assert.rejects(() => service.render(sampleDesign(), { part: "baseplate" }), error => {
        assert.equal(error.code, "missing_dependency");
        assert.match(error.message, /OpenSCAD/);
        return true;
    });
});

test("status allows STL export without Bambu when only OpenSCAD is configured", async t => {
    const root = await scratch(t, "status-openscad-only");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    const service = new FabricationService({
        artifactRoot: root,
        platform: "linux",
        env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad },
    });
    const status = await service.status();
    assert.equal(status.stl, true);
    assert.equal(status.bambu, false);
    assert.equal(status.openscad, openscad);
    assert.equal(status.missingOpenSCAD, false);
    assert.equal(status.missingBambu, true);
    assert.match(status.message, /OpenSCAD STL export is ready/);
    assert.match(status.message, /Bambu Studio/);
});

test("render uses constant OpenSCAD CLI args and preserves validated STL output", async t => {
    const root = await scratch(t, "render-success");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    const calls = [];
    const bytes = binaryStl();
    const service = new FabricationService({
        artifactRoot: root,
        platform: "linux",
        env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad },
        runner: {
            async run(command, args) {
                calls.push({ command, args });
                assert.equal(command, openscad);
                assert.deepEqual(args.slice(0, 4), ["--quiet", "--export-format", "binstl", "-o"]);
                assert.match(args[4], /\.stl$/);
                assert.match(args[5], /\.scad$/);
                const source = await readFile(args[5], "utf8");
                assert.match(source, /baseplate\(columns, rows\);/);
                await writeFile(args[4], bytes, { mode: 0o600 });
                return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
            },
            async launch() {
                throw new Error("not used");
            },
        },
    });
    const result = await service.render(sampleDesign(), { part: "baseplate" });
    assert.equal(result.contentType, "model/stl");
    assert.deepEqual(result.content, bytes);
    assert.equal(isValidStl(result.content), true);
    assert.equal(result.path.startsWith(root), true);
    assert.equal(calls.length, 1);
    const files = await readdir(root);
    assert.equal(files.filter(file => file.startsWith(".")).length, 0);
    assert.ok(files.includes(result.filename));
    assert.deepEqual(await readFile(result.path), bytes);
    if (process.platform !== "win32") assert.equal((await stat(result.path)).mode & 0o777, 0o600);
});

test("invalid rendered STL is rejected and cleaned up", async t => {
    const root = await scratch(t, "render-invalid");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    const service = new FabricationService({
        artifactRoot: root,
        platform: "linux",
        env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad },
        runner: {
            async run(_command, args) {
                await writeFile(args[4], Buffer.from("not an stl"), { mode: 0o600 });
                return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
            },
            async launch() {
                throw new Error("not used");
            },
        },
    });
    await assert.rejects(() => service.render(sampleDesign(), { part: "baseplate" }), error => {
        assert.equal(error.code, "render_failed");
        assert.match(error.message, /invalid STL/i);
        return true;
    });
    assert.deepEqual(await readdir(root), ["bin"]);
});

test("render failure cleans temporary files", async t => {
    const root = await scratch(t, "render-failure");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    const service = new FabricationService({
        artifactRoot: root,
        platform: "linux",
        env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad },
        runner: {
            async run(_command, args) {
                await writeFile(args[4], binaryStl(), { mode: 0o600 });
                const error = new Error("boom");
                error.stderr = Buffer.from("render failed");
                throw error;
            },
            async launch() {
                throw new Error("not used");
            },
        },
    });
    await assert.rejects(() => service.render(sampleDesign(), { part: "baseplate" }), error => {
        assert.equal(error.code, "render_failed");
        assert.match(error.message, /render failed/);
        return true;
    });
    assert.deepEqual(await readdir(root), ["bin"]);
});

test("concurrent fabrication requests reject with fabrication_busy", async t => {
    const root = await scratch(t, "busy");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const service = new FabricationService({
        artifactRoot: root,
        platform: "linux",
        env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad },
        runner: {
            async run(_command, args) {
                await gate;
                await writeFile(args[4], binaryStl(), { mode: 0o600 });
                return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
            },
            async launch() {
                throw new Error("not used");
            },
        },
    });
    const first = service.render(sampleDesign(), { part: "baseplate" });
    await Promise.resolve();
    await assert.rejects(() => service.render(sampleDesign(), { part: "baseplate" }), error => {
        assert.equal(error.code, "fabrication_busy");
        return true;
    });
    release();
    await first;
});

test("openInBambu renders once and hands the STL to the macOS open command", async t => {
    const root = await scratch(t, "bambu-open");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    const bundle = await bambuBundle(root);
    const calls = [];
    const service = new FabricationService({
        artifactRoot: root,
        platform: "darwin",
        env: {
            PATH: "",
            GRIDFINITY_OPENSCAD_PATH: openscad,
            GRIDFINITY_BAMBU_PATH: bundle,
        },
        runner: {
            async run(_command, args) {
                await writeFile(args[4], binaryStl(), { mode: 0o600 });
                return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
            },
            async launch(command, args) {
                calls.push({ command, args });
                return { pid: 1234 };
            },
        },
    });
    const result = await service.openInBambu(sampleDesign(), { part: "bin", binId: "bin-a" });
    assert.match(result.message, /Sent .* to Bambu Studio/);
    assert.equal(result.path.startsWith(root), true);
    assert.ok(result.filename.endsWith(".stl"));
    assert.deepEqual(calls, [{ command: "/usr/bin/open", args: ["-a", bundle, result.path] }]);
    assert.equal(isValidStl(await readFile(result.path)), true);
});

test("fabrication validates part names and IDs before constructing file paths", async t => {
    const root = await scratch(t, "paths");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    let calls = 0;
    const service = new FabricationService({
        artifactRoot: root, platform: "linux", env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad },
        runner: { run: async () => { calls++; }, launch: async () => { calls++; } },
    });
    for (const input of [
        { part: "../../outside" }, { part: "baseplate", binId: "../../outside" }, { part: "baseplate", path: "/elsewhere" },
    ]) await assert.rejects(service.render(sampleDesign(), input));
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(root), ["bin"]);
});

test("STL sanity checks reject degenerate and nonfinite triangles", () => {
    const degenerate = binaryStl();
    degenerate.copy(degenerate, 120, 108, 120);
    assert.equal(isValidStl(degenerate), false);
    const nonfinite = binaryStl();
    nonfinite.writeFloatLE(NaN, 96);
    assert.equal(isValidStl(nonfinite), false);
    assert.equal(isValidStl(Buffer.from("solid empty\nendsolid empty")), false);
});

test("renderer timeout releases the job and removes partial files", async t => {
    const root = await scratch(t, "timeout");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    const service = new FabricationService({
        artifactRoot: root, platform: "linux", env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad },
        runner: {
            run: async () => { throw Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" }); },
            launch: async () => {},
        },
    });
    await assert.rejects(service.render(sampleDesign()), /timed out/);
    assert.equal(service.activeJob, null);
    assert.deepEqual(await readdir(root), ["bin"]);
});

test("failed Bambu handoff reports failure and keeps the rendered file", async t => {
    const root = await scratch(t, "launch-failure");
    const openscad = await executableFile(join(root, "bin", "openscad"));
    const bundle = await bambuBundle(root);
    const service = new FabricationService({
        artifactRoot: root, platform: "darwin",
        env: { PATH: "", GRIDFINITY_OPENSCAD_PATH: openscad, GRIDFINITY_BAMBU_PATH: bundle },
        runner: {
            run: async (_command, args) => { await writeFile(args[4], binaryStl()); },
            launch: async () => { throw new Error("Launch denied"); },
        },
    });

    await assert.rejects(service.openInBambu(sampleDesign()), /Launch denied/);
    assert.equal((await readdir(root)).filter(file => file.endsWith(".stl")).length, 1);
});

test("binary normalization removes only exact zero-area facets without changing real triangles", () => {
    const original = binaryStl();
    const input = Buffer.concat([original, Buffer.alloc(50)]);
    input.writeUInt32LE(2, 80);
    const cleaned = normalizeBinaryStl(input);
    assert.equal(cleaned.removedFacets, 1);
    assert.equal(cleaned.content.readUInt32LE(80), 1);
    assert.deepEqual(cleaned.content.subarray(84), original.subarray(84));
    assert.equal(input.readUInt32LE(80), 2);
    assert.equal(isValidStl(cleaned.content), true);
    assert.equal(normalizeBinaryStl(original).content, original);
    const tiny = binaryStl();
    for (let offset = 96; offset < 132; offset += 4) tiny.writeFloatLE(tiny.readFloatLE(offset) * 1e-7, offset);
    assert.equal(normalizeBinaryStl(tiny).removedFacets, 0);
});
