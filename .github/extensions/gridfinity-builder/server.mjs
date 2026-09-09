import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DesignError, requireThat, object } from "./model.mjs";
import { MAX_BYTES } from "./storage.mjs";

async function readBody(req) {
    requireThat(req.headers["content-type"]?.split(";")[0].trim() === "application/json", "Use application/json.");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        requireThat(size <= MAX_BYTES, "Request exceeds 4 MiB.", "too_large");
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
        if (error instanceof SyntaxError) throw new DesignError("invalid_json", "Request body is not valid JSON.");
        throw error;
    }
}

export async function startServer(instanceId, workbench, { html, script, css, modules = {} }) {
    const token = randomBytes(32).toString("hex");
    let origin;
    const json = (res, status, value) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(value));
    };
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; form-action 'none'");
        try {
            requireThat(req.headers.host === new URL(origin).host, "Host is not allowed.", "forbidden");
            const url = new URL(req.url, origin);
            requireThat(url.origin === origin, "URL origin is not allowed.", "forbidden");
            if (url.pathname.startsWith("/api/")) {
                const supplied = req.headers["x-gridfinity-token"];
                requireThat(typeof supplied === "string" && /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)), "Missing or invalid access token.", "forbidden");
                requireThat(!req.headers.origin || req.headers.origin === origin, "Origin is not allowed.", "forbidden");
                if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, await workbench.state(instanceId));
                if (req.method === "GET" && url.pathname === "/api/designs") return json(res, 200, { designs: await workbench.store.list() });
                if (req.method === "GET" && url.pathname === "/api/fabrication/status") return json(res, 200, await workbench.fabricationStatus());
                if (req.method === "GET" && url.pathname === "/api/export") {
                    const input = Object.fromEntries(url.searchParams);
                    if (input.expectedRevision !== undefined) {
                        requireThat(/^\d+$/.test(input.expectedRevision) && Number.isSafeInteger(Number(input.expectedRevision)), "Expected revision must be an integer.");
                        input.expectedRevision = Number(input.expectedRevision);
                    }
                    const data = await workbench.export(instanceId, input);
                    res.writeHead(200, { "Content-Type": `${data.contentType}${typeof data.content === "string" ? "; charset=utf-8" : ""}`, "Content-Disposition": `attachment; filename="${data.filename}"` });
                    return res.end(data.content);
                }
                if (req.method === "POST") {
                    const body = await readBody(req);
                    if (url.pathname === "/api/export-draft") {
                        const data = await workbench.exportDraft(instanceId, body);
                        res.writeHead(200, { "Content-Type": data.contentType, "Content-Disposition": `attachment; filename="${data.filename}"` });
                        return res.end(data.content);
                    }
                    let result;
                    switch (url.pathname) {
                        case "/api/edit": result = await workbench.edit(instanceId, body); break;
                        case "/api/import": result = await workbench.import(instanceId, body); break;
                        case "/api/open": result = await workbench.switchDesign(instanceId, body); break;
                        case "/api/new": result = await workbench.switchDesign(instanceId, body, true); break;
                        case "/api/open-bambu": result = await workbench.openInBambu(instanceId, body); break;
                        case "/api/save":
                            object(body, [], "Save input");
                            // Every accepted mutation is already saved atomically.
                            result = await workbench.state(instanceId);
                            break;
                        default: throw new DesignError("not_found", "Route not found.");
                    }
                    return json(res, 200, result);
                }
                throw new DesignError("not_found", "Route or method not found.");
            }
            requireThat(req.method === "GET", "Method not allowed.", "not_found");
            const assets = {
                "/": ["text/html", html],
                "/app.js": ["text/javascript", script],
                "/styles.css": ["text/css", css],
                ...modules,
            };
            const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : undefined;
            requireThat(asset, "Route not found.", "not_found");
            res.writeHead(200, { "Content-Type": `${asset[0]}; charset=utf-8` });
            res.end(asset[1]);
        } catch (error) {
            const status = error.code === "forbidden" ? 403 : error.code === "not_found" || error.code === "ENOENT" ? 404
                : ["revision_conflict", "design_busy", "fabrication_busy", "already_exists"].includes(error.code) ? 409
                    : error.code === "missing_dependency" ? 503
                    : error.code === "too_large" ? 413 : error instanceof DesignError ? 400 : 500;
            if (!res.headersSent && !res.destroyed) json(res, status, { error: error.message, code: error.code || "internal_error" });
            else res.destroy();
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    return {
        server, url: `${origin}/#token=${token}`,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
}

export async function loadAssets(renderHtml) {
    const modules = {};
    for (const file of ["bin-options.mjs", "bin-controls.mjs", "bin-scad.mjs", "bin-mesh.mjs", "preview.mjs", "grid.mjs", "workflows.mjs", "inlay.mjs", "model.mjs", "geometry.mjs", "photo-editor.mjs", "viewer.mjs", "scene-geometry.mjs", "vendor/three.mjs", "viewer.css"]) {
        modules[`/${file}`] = [file.endsWith(".css") ? "text/css" : "text/javascript", await readFile(new URL(file, import.meta.url), "utf8")];
    }
    return {
        html: renderHtml(),
        script: await readFile(new URL("./app.js", import.meta.url), "utf8"),
        css: await readFile(new URL("./styles.css", import.meta.url), "utf8"),
        modules,
    };
}
