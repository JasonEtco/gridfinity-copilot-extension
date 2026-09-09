import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { DesignError, newDesign, validateDesign, validateId, requireThat } from "./model.mjs";

export const MAX_BYTES = 4 * 1024 * 1024;
export const defaultStorageRoot = () => join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "extensions", "gridfinity-builder", "artifacts");

export class DesignStore {
    constructor(root = defaultStorageRoot()) {
        this.root = root;
    }

    path(id) {
        return join(this.root, `${validateId(id)}.json`);
    }

    async read(id) {
        const handle = await open(this.path(id), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
            requireThat((await handle.stat()).size <= MAX_BYTES, "Saved design exceeds 4 MiB.");
            let value;
            try {
                value = JSON.parse(await handle.readFile("utf8"));
            } catch (error) {
                if (error instanceof SyntaxError) throw new DesignError("invalid_json", `Saved design "${id}" has invalid JSON.`);
                throw error;
            }
            validateDesign(value);
            requireThat(value.designId === id, "Saved design ID does not match its file.");
            return value;
        } finally {
            await handle.close();
        }
    }

    async locked(id, work, wait = false) {
        validateId(id);
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const lock = join(this.root, `${id}.lock`);
        for (let attempt = 0; ; attempt++) {
            try {
                await mkdir(lock, { mode: 0o700 });
                break;
            } catch (error) {
                if (error.code !== "EEXIST") throw error;
                if (!wait || attempt >= 40) throw new DesignError("design_busy", `Design "${id}" is locked by another writer. Retry. If the writer stopped, remove its .lock directory.`);
                await delay(25);
            }
        }
        try {
            return await work();
        } finally {
            await rm(lock, { recursive: true });
        }
    }

    async write(design) {
        validateDesign(design);
        const data = JSON.stringify(design, null, 2) + "\n";
        requireThat(Buffer.byteLength(data) <= MAX_BYTES, "Design exceeds 4 MiB.");
        const temporary = join(this.root, `.${design.designId}-${randomUUID()}.tmp`);
        try {
            const handle = await open(temporary, "wx", 0o600);
            try {
                await handle.writeFile(data);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await rename(temporary, this.path(design.designId));
        } finally {
            await rm(temporary, { force: true });
        }
        return design;
    }

    async ensure(id, name) {
        try {
            return await this.read(id);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        return this.locked(id, async () => {
            try {
                return await this.read(id);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
                return this.write(newDesign(id, name));
            }
        }, true);
    }

    async create(id, name) {
        return this.locked(id, async () => {
            try {
                await this.read(id);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
                return this.write(newDesign(id, name));
            }
            throw new DesignError("already_exists", "That design ID already exists. Open it or choose a new ID.");
        });
    }

    async update(id, transform) {
        return this.locked(id, async () => this.write(await transform(await this.read(id))));
    }

    async list() {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const result = [];
        for (const file of await readdir(this.root)) {
            if (!file.endsWith(".json")) continue;
            const design = await this.read(file.slice(0, -5));
            result.push({ designId: design.designId, name: design.name, revision: design.revision });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }
}
