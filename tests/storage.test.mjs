import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignStore, MAX_BYTES } from "../.github/extensions/gridfinity-builder/storage.mjs";
import { applyOperations } from "../.github/extensions/gridfinity-builder/model.mjs";
import { photo } from "./photo-fixture.mjs";

async function storeFor(t) {
    const root = await mkdtemp(join(tmpdir(), "gridfinity-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    return new DesignStore(root);
}

test("saved designs survive a fresh store, with private files", async t => {
    const store = await storeFor(t);
    const original = await store.ensure("tools", "Tool drawer");
    await store.update("tools", current => applyOperations(current, 0, [{ type: "rename", name: "Workshop" }]));
    const fresh = new DesignStore(store.root);
    assert.equal((await fresh.read("tools")).name, "Workshop");
    assert.equal((await fresh.ensure("tools", "Do not replace")).revision, 1);
    assert.equal(original.name, "Tool drawer");
    assert.deepEqual(await fresh.list(), [{ designId: "tools", name: "Workshop", revision: 1 }]);
    if (process.platform !== "win32") assert.equal((await stat(store.path("tools"))).mode & 0o777, 0o600);
});

test("conflicts and failed transforms preserve disk; cross-process locks reject writes", async t => {
    const store = await storeFor(t);
    await store.ensure("atomic");
    await assert.rejects(store.update("atomic", current => applyOperations(current, 99, [{ type: "rename", name: "Wrong" }])), /changed/);
    await assert.rejects(store.update("atomic", () => { throw new Error("Failed transform"); }), /Failed transform/);
    assert.equal((await store.read("atomic")).revision, 0);
    await mkdir(join(store.root, "atomic.lock"));
    await assert.rejects(new DesignStore(store.root).update("atomic", current => current), /locked/);
    assert.equal((await store.read("atomic")).revision, 0);
});

test("creation and corrupt files fail safely instead of resetting work", async t => {
    const store = await storeFor(t);
    await store.create("one", "One");
    await assert.rejects(store.create("one", "Overwrite"), /already exists/);
    await writeFile(join(store.root, "broken.json"), "{");
    await assert.rejects(store.ensure("broken"), /invalid JSON/);
    await assert.rejects(store.read("../escape"), /IDs must/);
    await assert.rejects(store.ensure("bad/name"), /IDs must/);
    await writeFile(join(store.root, "large.json"), " ".repeat(MAX_BYTES + 1));
    await assert.rejects(store.read("large"), /exceeds/);
    await writeFile(join(store.root, "wrong.json"), JSON.stringify(await store.read("one")));
    await assert.rejects(store.read("wrong"), /does not match/);
    if (process.platform !== "win32") {
        await symlink(store.path("one"), store.path("link"));
        await assert.rejects(store.read("link"), { code: "ELOOP" });
    }
});

test("saved reference photos round trip across store instances", async t => {
    const store = await storeFor(t);
    await store.ensure("photo");
    await store.update("photo", current => applyOperations(current, 0, [{
        type: "add_bin",
        bin: { id: "photo-bin", label: "Item", x: 0, y: 0, width: 1, depth: 1, height: 3, rotation: 0, color: "teal",
            inlay: { outline: [[8, 8], [30, 8], [30, 30], [8, 30]], depth: 10, clearance: 0.5, photo } },
    }]));
    const reopened = await new DesignStore(store.root).read("photo");
    assert.deepEqual(reopened.bins[0].inlay.photo, photo);
    assert.equal(reopened.revision, 1);
});

test("concurrent panel opens share one design and do not compete for read locks", async t => {
    const store = await storeFor(t);
    const second = new DesignStore(store.root);
    const [firstOpen, secondOpen] = await Promise.all([store.ensure("shared", "Original"), second.ensure("shared", "Other title")]);
    assert.deepEqual(firstOpen, secondOpen);
    await mkdir(join(store.root, "shared.lock"));
    assert.deepEqual(await second.ensure("shared"), firstOpen);
});
