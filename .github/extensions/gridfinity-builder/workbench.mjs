import { randomUUID } from "node:crypto";
import { applyOperations, importLayout, metrics, object, text, requireThat, validateId, validateDesign } from "./model.mjs";
import { exportScad } from "./geometry.mjs";
import { join } from "node:path";
import { FabricationService } from "./fabrication.mjs";

export function agentState(result) {
    if (Buffer.isBuffer(result?.content)) return {
        filename: result.filename, contentType: result.contentType, path: result.path, bytes: result.content.length,
        ...(result.removedFacets ? { removedFacets: result.removedFacets } : {}),
    };
    if (!result?.design) return result;
    const copy = structuredClone(result);
    copy.photoReferences = [];
    for (const bin of copy.design.bins) {
        if (bin.inlay?.photo) {
            const { width, height, itemWidthMm } = bin.inlay.photo;
            copy.photoReferences.push({ binId: bin.id, width, height, itemWidthMm });
            delete bin.inlay.photo;
        }
    }
    return copy;
}

export class Workbench {
    constructor(store, session, fabrication = new FabricationService({ artifactRoot: join(store.root, "exports") })) {
        this.store = store;
        this.session = session;
        this.panels = new Map();
        this.fabrication = fabrication;
    }

    attachSession(session) {
        this.session = session;
    }

    designId(instanceId) {
        const id = this.panels.get(instanceId);
        requireThat(id, "This panel is not open.", "not_found");
        return id;
    }

    async open(instanceId, input, extensionId) {
        object(input, ["designId", "name"], "Open input");
        validateId(input.designId);
        if (input.name !== undefined) text(input.name, 100, "Design name");
        await this.store.ensure(input.designId, input.name);
        if (extensionId) this.extensionId = extensionId;
        this.panels.set(instanceId, input.designId);
        return this.state(instanceId);
    }

    async state(instanceId) {
        const design = await this.store.read(this.designId(instanceId));
        return { design, metrics: metrics(design) };
    }

    async edit(instanceId, input) {
        object(input, ["expectedRevision", "operations"], "Edit input");
        await this.store.update(this.designId(instanceId), current => applyOperations(current, input.expectedRevision, input.operations));
        return this.state(instanceId);
    }

    async import(instanceId, input) {
        object(input, ["expectedRevision", "layout"], "Import input");
        await this.store.update(this.designId(instanceId), current => importLayout(current, input.expectedRevision, input.layout));
        return this.state(instanceId);
    }

    async switchDesign(instanceId, input, create = false) {
        object(input, create ? ["designId", "name"] : ["designId"], "Design input");
        requireThat(this.session, "Copilot is still connecting. Try again.", "initializing");
        if (create) await this.store.create(input.designId, input.name);
        else await this.store.read(input.designId);
        await this.session.rpc.canvas.open({
            canvasId: "gridfinity-builder",
            ...(this.extensionId ? { extensionId: this.extensionId } : {}),
            instanceId: `gf-${randomUUID()}`,
            input: { designId: input.designId },
        });
        return this.state(instanceId);
    }

    async export(instanceId, input) {
        object(input, ["format", "part", "binId", "expectedRevision"], "Export input");
        requireThat(["json", "scad", "stl"].includes(input.format), "Export format must be json, scad or stl.");
        const { design } = await this.state(instanceId);
        if (input.expectedRevision !== undefined) requireThat(input.expectedRevision === design.revision, "The design changed before export. Read its current state and try again.", "revision_conflict");
        return this.formatExport(design, input);
    }

    async exportDraft(instanceId, input) {
        this.designId(instanceId);
        object(input, ["design", "format", "part", "binId"], "Draft export");
        requireThat(["scad", "stl"].includes(input.format), "Draft export format must be scad or stl.");
        return this.formatExport(validateDesign(structuredClone(input.design)), input);
    }

    async formatExport(design, input) {
        if (input.format === "stl") return this.fabrication.render(design, { part: input.part || "baseplate", binId: input.binId });
        return {
            filename: `${design.designId}${input.format === "scad" ? `-${input.part || "baseplate"}` : ""}.${input.format}`,
            contentType: input.format === "json" ? "application/json" : "text/plain",
            content: input.format === "json" ? JSON.stringify(design, null, 2) + "\n" : exportScad(design, input.part, input.binId),
        };
    }

    async fabricationStatus() {
        return this.fabrication.status();
    }

    async openInBambu(instanceId, input) {
        object(input, ["part", "binId", "expectedRevision"], "Bambu input");
        const { design } = await this.state(instanceId);
        requireThat(input.expectedRevision === design.revision, "The design changed before export. Read its current state and try again.", "revision_conflict");
        return this.fabrication.openInBambu(design, { part: input.part || "baseplate", binId: input.binId });
    }

    close(instanceId) {
        this.panels.delete(instanceId);
    }
}
