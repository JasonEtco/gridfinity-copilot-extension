import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { exportScad } from "./geometry.mjs";
import { DesignError, object, requireThat, validateDesign, validateId } from "./model.mjs";
import { defaultStorageRoot } from "./storage.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 512 * 1024;
const MAX_STL_BYTES = 64 * 1024 * 1024;
const OPENSCAD_ENV = "GRIDFINITY_OPENSCAD_PATH";
const BAMBU_ENV = "GRIDFINITY_BAMBU_PATH";

const OPENSCAD_MESSAGES = {
    missing: `OpenSCAD is not available. Install OpenSCAD or set ${OPENSCAD_ENV} to an absolute executable path to enable STL export.`,
    invalidEnv: `OpenSCAD is not available. ${OPENSCAD_ENV} must be an absolute executable path.`,
};

const BAMBU_MESSAGES = {
    missing: `Bambu Studio is not available. Install Bambu Studio or set ${BAMBU_ENV} to an absolute local application path to enable Open in Bambu.`,
    invalidEnv: `Bambu Studio is not available. ${BAMBU_ENV} must be an absolute local application path.`,
};

function defaultRunner() {
    return {
        run(command, args, options = {}) {
            return new Promise((resolve, reject) => {
                execFile(command, args, {
                    cwd: options.cwd,
                    env: options.env,
                    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
                    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
                    windowsHide: true,
                    encoding: "buffer",
                }, (error, stdout, stderr) => {
                    if (error) {
                        error.stdout = stdout;
                        error.stderr = stderr;
                        reject(error);
                        return;
                    }
                    resolve({ code: 0, stdout, stderr });
                });
            });
        },
        launch(command, args, options = {}) {
            if (command === "/usr/bin/open") {
                return this.run(command, args, { ...options, timeout: 10000 });
            }
            return new Promise((resolve, reject) => {
                const child = spawn(command, args, {
                    cwd: options.cwd,
                    env: options.env,
                    detached: true,
                    stdio: "ignore",
                    windowsHide: true,
                });
                child.once("error", reject);
                child.once("spawn", () => {
                    child.unref();
                    resolve({ pid: child.pid });
                });
            });
        },
    };
}

async function executable(path) {
    try {
        await access(path, constants.X_OK);
        return (await stat(path)).isFile();
    } catch (error) {
        if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) return false;
        throw error;
    }
}

function unique(items) {
    return [...new Set(items.filter(Boolean))];
}

function summarizeOutput(error) {
    const stdout = Buffer.isBuffer(error?.stdout) ? error.stdout.toString("utf8") : "";
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") : typeof error?.stderr === "string" ? error.stderr : "";
    const text = `${stderr}\n${stdout}`.replace(/\s+/g, " ").trim();
    return (text || error?.message || "").slice(0, 400);
}

async function writePrivateFile(path, content) {
    const handle = await open(path, "wx", 0o600);
    try {
        await handle.writeFile(content);
        await handle.sync();
    } finally {
        await handle.close();
    }
}

function stlSanity(vertices) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let count = 0;
    let triangle = [];
    for (const point of vertices) {
        if (!point.every(Number.isFinite)) return false;
        for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
        }
        count++;
        triangle.push(point);
        if (triangle.length === 3) {
            const [a, b, c] = triangle;
            const u = b.map((value, i) => value - a[i]), v = c.map((value, i) => value - a[i]);
            if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) <= 1e-12) return false;
            triangle = [];
        }
    }
    return count >= 3 && count % 3 === 0 && max.every((value, axis) => value > min[axis]);
}

export function isValidStl(content) {
    if (!Buffer.isBuffer(content) || content.length === 0 || content.length > MAX_STL_BYTES) return false;
    if (content.length >= 84) {
        const triangles = content.readUInt32LE(80);
        if (triangles > 0 && content.length === 84 + triangles * 50) {
            function* vertices() {
                for (let offset = 84; offset < content.length; offset += 50) {
                    for (let corner = 0; corner < 3; corner++) {
                        const base = offset + 12 + corner * 12;
                        yield [content.readFloatLE(base), content.readFloatLE(base + 4), content.readFloatLE(base + 8)];
                    }
                }
            }
            return stlSanity(vertices());
        }
    }
    const text = content.toString("utf8").trim();
    if (!/^solid\b/i.test(text) || !/endsolid\b/i.test(text)) return false;
    function* vertices() {
        for (const match of text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)) yield match.slice(1).map(Number);
    }
    return stlSanity(vertices());
}

export function normalizeBinaryStl(content) {
    if (!Buffer.isBuffer(content) || content.length < 84 || content.length > MAX_STL_BYTES ||
        content.length !== 84 + content.readUInt32LE(80) * 50) return { content, removedFacets: 0 };
    const degenerate = offset => {
        const ax = content.readFloatLE(offset + 12), ay = content.readFloatLE(offset + 16), az = content.readFloatLE(offset + 20);
        const ux = content.readFloatLE(offset + 24) - ax, uy = content.readFloatLE(offset + 28) - ay, uz = content.readFloatLE(offset + 32) - az;
        const vx = content.readFloatLE(offset + 36) - ax, vy = content.readFloatLE(offset + 40) - ay, vz = content.readFloatLE(offset + 44) - az;
        return uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0;
    };
    let removedFacets = 0;
    for (let offset = 84; offset < content.length; offset += 50) if (degenerate(offset)) removedFacets++;
    if (!removedFacets) return { content, removedFacets: 0 };
    const result = Buffer.alloc(content.length - removedFacets * 50);
    result.write(`Gridfinity: removed ${removedFacets} zero-area Float32 facets`, 0, 80, "ascii");
    result.writeUInt32LE(content.readUInt32LE(80) - removedFacets, 80);
    let target = 84;
    for (let offset = 84; offset < content.length; offset += 50) {
        if (degenerate(offset)) continue;
        content.copy(result, target, offset, offset + 50);
        target += 50;
    }
    return { content: result, removedFacets };
}

async function validateConfiguredExecutable(value) {
    if (!value || !isAbsolute(value)) return null;
    return await executable(value) ? value : null;
}

function envPathEntries(env) {
    return String(env.PATH || "").split(delimiter).filter(Boolean);
}

async function findOnPath(names, env) {
    for (const dir of envPathEntries(env)) {
        for (const name of names) {
            const candidate = resolve(dir, name);
            if (await executable(candidate)) return candidate;
        }
    }
    return null;
}

async function resolveOpenScad(platform, env) {
    const configured = env[OPENSCAD_ENV];
    if (configured !== undefined) {
        const path = await validateConfiguredExecutable(configured);
        return path ? { ok: true, path } : { ok: false, reason: "invalid_env", message: OPENSCAD_MESSAGES.invalidEnv };
    }
    const windowsRoots = unique([env.ProgramFiles, env["ProgramFiles(x86)"]]);
    const candidates = platform === "darwin"
        ? ["/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"]
        : platform === "win32"
            ? windowsRoots.map(root => join(root, "OpenSCAD", "openscad.exe"))
            : [];
    for (const candidate of candidates) {
        if (await executable(candidate)) return { ok: true, path: candidate };
    }
    const path = await findOnPath(platform === "win32" ? ["openscad.exe", "openscad"] : ["openscad"], env);
    return path ? { ok: true, path } : { ok: false, reason: "missing", message: OPENSCAD_MESSAGES.missing };
}

async function macBundleCandidate(path) {
    if (!isAbsolute(path)) return null;
    if (path.endsWith(".app")) {
        return await executable(join(path, "Contents", "MacOS", "BambuStudio")) ? path : null;
    }
    if (!(await executable(path))) return null;
    const bundle = dirname(dirname(dirname(path)));
    return bundle.endsWith(".app") ? bundle : null;
}

async function resolveBambu(platform, env) {
    const configured = env[BAMBU_ENV];
    if (configured !== undefined) {
        if (!isAbsolute(configured)) return { ok: false, reason: "invalid_env", message: BAMBU_MESSAGES.invalidEnv };
        if (platform === "darwin") {
            const bundle = await macBundleCandidate(configured);
            return bundle ? { ok: true, displayPath: bundle, command: "/usr/bin/open", argsFor: file => ["-a", bundle, file] }
                : { ok: false, reason: "invalid_env", message: BAMBU_MESSAGES.invalidEnv };
        }
        const path = await validateConfiguredExecutable(configured);
        return path ? { ok: true, displayPath: path, command: path, argsFor: file => [file] }
            : { ok: false, reason: "invalid_env", message: BAMBU_MESSAGES.invalidEnv };
    }

    if (platform === "darwin") {
        for (const bundle of ["/Applications/BambuStudio.app", "/Applications/Bambu Studio.app"]) {
            if (await macBundleCandidate(bundle)) {
                return { ok: true, displayPath: bundle, command: "/usr/bin/open", argsFor: file => ["-a", bundle, file] };
            }
        }
        return { ok: false, reason: "missing", message: BAMBU_MESSAGES.missing };
    }

    if (platform === "win32") {
        const roots = unique([env.ProgramFiles, env["ProgramFiles(x86)"]]);
        for (const candidate of roots.flatMap(root => [
            join(root, "Bambu Studio", "BambuStudio.exe"),
            join(root, "BambuStudio", "BambuStudio.exe"),
        ])) {
            if (await executable(candidate)) return { ok: true, displayPath: candidate, command: candidate, argsFor: file => [file] };
        }
        const path = await findOnPath(["BambuStudio.exe", "bambu-studio.exe"], env);
        return path ? { ok: true, displayPath: path, command: path, argsFor: file => [file] }
            : { ok: false, reason: "missing", message: BAMBU_MESSAGES.missing };
    }

    const path = await findOnPath(["bambu-studio", "BambuStudio"], env);
    return path ? { ok: true, displayPath: path, command: path, argsFor: file => [file] }
        : { ok: false, reason: "missing", message: BAMBU_MESSAGES.missing };
}

function statusMessage(openscad, bambu) {
    if (openscad.ok && bambu.ok) return "OpenSCAD STL export and Bambu Studio handoff are ready.";
    if (!openscad.ok && !bambu.ok) return `${openscad.message} ${bambu.message}`;
    if (!openscad.ok) return openscad.message;
    return `OpenSCAD STL export is ready. ${bambu.message}`;
}

export class FabricationService {
    constructor({ artifactRoot = join(defaultStorageRoot(), "exports"), platform = process.platform, env = process.env, runner = defaultRunner() } = {}) {
        this.artifactRoot = resolve(artifactRoot);
        this.platform = platform;
        this.env = { ...env };
        this.runner = runner;
        this.activeJob = null;
    }

    async status() {
        const [openscad, bambu] = await Promise.all([
            resolveOpenScad(this.platform, this.env),
            resolveBambu(this.platform, this.env),
        ]);
        return {
            stl: openscad.ok,
            bambu: openscad.ok && bambu.ok,
            ...(openscad.ok ? { openscad: openscad.path } : {}),
            ...(bambu.ok ? { bambuApp: bambu.displayPath } : {}),
            missingOpenSCAD: !openscad.ok,
            missingBambu: !bambu.ok,
            message: statusMessage(openscad, bambu),
        };
    }

    async render(design, input = {}) {
        object(input, ["part", "binId"], "Fabrication input");
        const { part = "baseplate", binId } = input;
        requireThat(["baseplate", "bins", "bin", "spacers"].includes(part), "Choose a supported fabrication part.");
        if (binId !== undefined) validateId(binId);
        return this.#withExclusiveJob(async () => {
            validateDesign(design);
            const openscad = await resolveOpenScad(this.platform, this.env);
            if (!openscad.ok) throw new DesignError("missing_dependency", openscad.message);
            await mkdir(this.artifactRoot, { recursive: true, mode: 0o700 });
            const token = `${design.designId}-${part}${binId ? `-${binId}` : ""}-rev${design.revision}-${randomUUID()}`;
            const scadPath = join(this.artifactRoot, `.${token}.scad`);
            const pendingStlPath = join(this.artifactRoot, `.${token}.stl`);
            const finalPath = join(this.artifactRoot, `${token}.stl`);
            try {
                await writePrivateFile(scadPath, exportScad(design, part, binId));
                await writePrivateFile(pendingStlPath, Buffer.alloc(0));
                try {
                    await this.runner.run(openscad.path, ["--quiet", "--export-format", "binstl", "-o", pendingStlPath, scadPath], {
                        cwd: this.artifactRoot,
                        env: this.env,
                        timeout: DEFAULT_TIMEOUT_MS,
                        maxBuffer: DEFAULT_MAX_BUFFER,
                    });
                } catch (error) {
                    const detail = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "OpenSCAD output exceeded its size limit." :
                        error?.code === "ETIMEDOUT" || error?.killed ? `OpenSCAD timed out after ${Math.floor(DEFAULT_TIMEOUT_MS / 1000)} seconds.`
                        : summarizeOutput(error);
                    throw new DesignError("render_failed", detail ? `OpenSCAD failed to render STL. ${detail}` : "OpenSCAD failed to render STL.");
                }
                const file = await stat(pendingStlPath).catch(error => {
                    if (error.code === "ENOENT") return null;
                    throw error;
                });
                if (!file?.isFile()) throw new DesignError("render_failed", "OpenSCAD did not produce an STL file.");
                if (file.size <= 0 || file.size > MAX_STL_BYTES) throw new DesignError("render_failed", `Rendered STL must be 1 byte to ${MAX_STL_BYTES} bytes.`);
                await chmod(pendingStlPath, 0o600);
                // Float32 STL output can collapse coincident CSG vertices into zero-area facets.
                const { content, removedFacets } = normalizeBinaryStl(await readFile(pendingStlPath));
                if (!isValidStl(content)) throw new DesignError("render_failed", "OpenSCAD produced an invalid STL file.");
                if (removedFacets) {
                    const handle = await open(pendingStlPath, "r+");
                    try {
                        await handle.truncate(0);
                        await handle.writeFile(content);
                        await handle.sync();
                    } finally { await handle.close(); }
                }
                await rename(pendingStlPath, finalPath);
                return { filename: basename(finalPath), contentType: "model/stl", content, path: finalPath, ...(removedFacets ? { removedFacets } : {}) };
            } finally {
                await rm(scadPath, { force: true });
                await rm(pendingStlPath, { force: true });
            }
        });
    }

    async openInBambu(design, input = {}) {
        const bambu = await resolveBambu(this.platform, this.env);
        if (!bambu.ok) throw new DesignError("missing_dependency", bambu.message);
        const rendered = await this.render(design, input);
        try {
            await this.runner.launch(bambu.command, bambu.argsFor(rendered.path), { cwd: this.artifactRoot, env: this.env });
        } catch (error) {
            const detail = summarizeOutput(error);
            throw new DesignError("render_failed", detail ? `Bambu Studio could not be opened. ${detail}` : "Bambu Studio could not be opened.");
        }
        return {
            message: `Sent ${rendered.filename} to Bambu Studio. Review it before printing.`,
            path: rendered.path,
            filename: rendered.filename,
        };
    }

    async #withExclusiveJob(work) {
        if (this.activeJob) throw new DesignError("fabrication_busy", "Another fabrication job is already running. Wait for it to finish.");
        const job = (async () => work())();
        this.activeJob = job;
        try {
            return await job;
        } finally {
            if (this.activeJob === job) this.activeJob = null;
        }
    }
}
