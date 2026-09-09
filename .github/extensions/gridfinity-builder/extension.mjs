// Gridfinity Builder. Scaffolded with extensions_manage, then split by responsibility.
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { DesignStore } from "./storage.mjs";
import { Workbench, agentState } from "./workbench.mjs";
import { startServer, loadAssets } from "./server.mjs";
import { renderHtml } from "./renderer.mjs";
import { openSchema, editSchema, importSchema, exportSchema, obj } from "./schemas.mjs";

const servers = new Map();
// Rehydration callbacks can arrive while joinSession is still connecting.
const workbench = new Workbench(new DesignStore());
const action = (name, description, inputSchema, handler) => ({
    name, description, inputSchema,
    handler: async ctx => {
        try {
            return agentState(await handler(workbench, ctx));
        } catch (error) {
            throw new CanvasError(error.code || "gridfinity_error", error.message);
        }
    },
});

const session = await joinSession({
    canvases: [createCanvas({
        id: "gridfinity-builder",
        displayName: "Gridfinity Builder",
        description: "Design drawer-fitted Gridfinity grids, bins and photo recesses, inspect them in 3D and export fabrication files through transactional canvas actions.",
        inputSchema: openSchema,
        actions: [
            action("get_state", "Read saved design, revision, bin dimensions and occupied cells. Positions and bin width/depth are cells; height is 7 mm units. Rotation swaps width/depth. Inlay outlines use unrotated outer-bin XY millimeters, with depth and clearance in mm. Photo bytes are omitted; photoReferences lists retained reference images.", obj({}, []),
                (bench, ctx) => bench.state(ctx.instanceId)),
            action("apply_edits", "Atomically edit and save the canvas using expectedRevision from get_state. Invalid fit, overlaps, construction options, inlays or stale revisions reject the batch. update_bin changes.options merges wall/floor, divisions, solid fill, lip, labels, scoops and mounting-hole settings. resize_grid edits cells; fit_drawer calculates cells; set_drawer changes millimeter dimensions, nine-way/custom alignment, offsets and excess margin; set_baseplate selects solid-floor/open-frame construction; clear_drawer removes limits. Bin x/y are zero-based cells. Inlay outline points are unrotated outer-bin millimeters; omitted photos are preserved. Do not remove existing work without a request.", editSchema,
                (bench, ctx) => bench.edit(ctx.instanceId, ctx.input)),
            action("import_layout", "Replace the current design contents with validated version-1 JSON, preserving its design ID. Requires the current expectedRevision. Read state and get user consent before replacing work.", importSchema,
                (bench, ctx) => bench.import(ctx.instanceId, ctx.input)),
            action("export_design", "Export JSON, editable OpenSCAD, or an STL rendered by a local OpenSCAD installation. Parts: baseplate, bins, one binId, or separate edge spacers. JSON/SCAD return source content; STL saves a file and returns its path and size. expectedRevision can guard against exporting a changed layout. STL may take up to two minutes. Inspect files in a slicer and fit-test before printing; no automatic printing.", exportSchema,
                (bench, ctx) => bench.export(ctx.instanceId, ctx.input)),
        ],
        open: async ctx => {
            await workbench.open(ctx.instanceId, ctx.input, ctx.extensionId);
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = loadAssets(renderHtml).then(assets => startServer(ctx.instanceId, workbench, assets));
                servers.set(ctx.instanceId, entry);
            }
            try {
                return { title: "Gridfinity Builder", url: (await entry).url };
            } catch (error) {
                if (servers.get(ctx.instanceId) === entry) servers.delete(ctx.instanceId);
                throw error;
            }
        },
        onClose: async ctx => {
            const entry = servers.get(ctx.instanceId);
            servers.delete(ctx.instanceId);
            workbench.close(ctx.instanceId);
            if (entry) await (await entry).close();
        },
    })],
});
workbench.attachSession(session);
