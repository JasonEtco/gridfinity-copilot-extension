import * as THREE from "./vendor/three.mjs";
import { OrbitControls } from "./vendor/three.mjs";
import { applySceneMode, createSceneGeometry, getViewBounds, setSelectedBin } from "./scene-geometry.mjs";
import { gridFrame } from "./grid.mjs";

const ORBIT_STEP = Math.PI / 12;
const ZOOM_FACTOR = 1.18;
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(1.18, -1.34, 1.06).normalize();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export function createViewer(container, { onError = () => {}, onSelect = () => {}, initialMode = "layout", lockMode = false, highlightExcess = true } = {}) {
    if (!["layout", "selected", "baseplate"].includes(initialMode)) throw new Error("Unknown 3D preview mode.");
    container.classList.add("model-viewer");
    let disposed = false;
    let sceneData = null;
    let design = null;
    let selectedId = null;
    let mode = initialMode;
    let designKey = null;
    let designId = null;
    let renderQueued = false;
    let pointerDown = null;

    const root = document.createElement("section");
    root.className = "gfv-viewer";
    root.innerHTML = `
        <div class="gfv-viewer__chrome">
          <div>
            <p class="gf-v-label">3D preview · experimental geometry</p>
            <p class="gfv-viewer__help">Drag to orbit, shift-drag to pan, wheel to zoom. Use this preview to inspect recesses and socket relief before export.</p>
          </div>
          <div class="gfv-viewer__selection" role="status" aria-live="polite">No bin selected</div>
        </div>
        <div class="gfv-viewer__toolbar">
          <div class="gfv-viewer__group" role="group" aria-label="3D subject">
            <button type="button" data-mode="layout" aria-pressed="true">Layout</button>
            <button type="button" data-mode="selected" aria-pressed="false">Selected bin</button>
            <button type="button" data-mode="baseplate" aria-pressed="false">Baseplate</button>
          </div>
          <div class="gfv-viewer__group" role="group" aria-label="Camera controls">
            <button type="button" data-camera="left" aria-label="Orbit left">↺</button>
            <button type="button" data-camera="right" aria-label="Orbit right">↻</button>
            <button type="button" data-camera="up" aria-label="Tilt up">↑</button>
            <button type="button" data-camera="down" aria-label="Tilt down">↓</button>
            <button type="button" data-camera="in" aria-label="Zoom in">＋</button>
            <button type="button" data-camera="out" aria-label="Zoom out">－</button>
            <button type="button" data-camera="reset" class="gfv-viewer__reset">Reset view</button>
          </div>
        </div>
        <div class="gfv-viewer__stage">
          <div class="gfv-viewer__canvas-shell">
            <div class="gfv-viewer__overlay" hidden></div>
          </div>
        </div>
    `;
    container.replaceChildren(root);
    root.classList.toggle("gfv-viewer--generator", lockMode);
    root.querySelector(".gfv-viewer__chrome").hidden = lockMode;

    const stage = root.querySelector(".gfv-viewer__canvas-shell");
    const overlay = root.querySelector(".gfv-viewer__overlay");
    const selection = root.querySelector(".gfv-viewer__selection");
    const modeButtons = [...root.querySelectorAll("[data-mode]")];
    const selectedButton = root.querySelector('[data-mode="selected"]');
    root.querySelector('[aria-label="3D subject"]').hidden = lockMode;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
        });
    } catch (error) {
        showOverlay("This browser could not start the WebGL preview.");
        throw error;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "gfv-viewer__canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D Gridfinity preview");
    stage.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    scene.add(camera);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.target.set(0, 0, 0);
    controls.addEventListener("change", requestRender);
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI - 0.08;

    scene.add(new THREE.HemisphereLight("#f2f7ff", "#607080", 1.45));
    const keyLight = new THREE.DirectionalLight("#ffffff", 1.2);
    keyLight.position.set(180, -220, 280);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight("#93c9ff", 0.45);
    rimLight.position.set(-140, 200, 180);
    scene.add(rimLight);

    const resizeObserver = new ResizeObserver(() => {
        if (!isRenderable()) return;
        resizeRenderer();
        frameScene(false);
        requestRender();
    });
    resizeObserver.observe(stage);

    const visibilityHandler = () => {
        if (document.visibilityState === "visible") {
            resizeRenderer();
            requestRender();
        }
    };
    document.addEventListener("visibilitychange", visibilityHandler);

    renderer.domElement.addEventListener("webglcontextlost", (event) => {
        if (disposed) return;
        event.preventDefault();
        showOverlay("The 3D preview lost its graphics context. Reload the panel to rebuild it.");
        onError(new Error("The 3D preview lost its graphics context."));
    });
    renderer.domElement.addEventListener("pointerdown", (event) => {
        pointerDown = { x: event.clientX, y: event.clientY };
    });
    renderer.domElement.addEventListener("pointerup", (event) => {
        if (!pointerDown) return;
        const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
        pointerDown = null;
        if (moved <= 4) pickBin(event);
    });
    renderer.domElement.addEventListener("keydown", (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const action = {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowUp: "up",
            ArrowDown: "down",
            "+": "in",
            "=": "in",
            "-": "out",
            "_": "out",
            "0": "reset",
        }[event.key];
        if (!action) return;
        event.preventDefault();
        moveCamera(action);
    });

    root.querySelectorAll("[data-camera]").forEach((button) => {
        button.addEventListener("click", () => moveCamera(button.dataset.camera));
    });
    modeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            if (button.dataset.mode === "selected" && !selectedId) return;
            setMode(button.dataset.mode);
        });
    });

    resizeRenderer();
    frameScene(true);

    return {
        update(nextDesign, nextSelectedId) {
            if (disposed || !nextDesign) return;
            design = nextDesign;
            const nextKey = `${nextDesign.designId}:${nextDesign.revision}`;
            const nextId = nextDesign.designId;
            const documentChanged = designId !== nextId;
            const revisionChanged = designKey !== nextKey;
            const selectionChanged = selectedId !== nextSelectedId;
            designKey = nextKey;
            designId = nextId;
            selectedId = nextSelectedId ?? null;
            if (!selectedId && mode === "selected") mode = "layout";

            if (revisionChanged || !sceneData) {
                rebuildScene();
                frameScene(documentChanged);
            } else {
                setSelectedBin(sceneData, lockMode ? null : selectedId);
                applySceneMode(sceneData, mode, selectedId);
                if (selectionChanged && mode === "selected") frameScene(true);
            }
            updateUi();
            requestRender();
        },
        reset() {
            frameScene(true);
        },
        setExcessHighlight(value) {
            highlightExcess = !!value;
            paintExcess();
            requestRender();
        },
        dispose() {
            disposed = true;
            resizeObserver.disconnect();
            document.removeEventListener("visibilitychange", visibilityHandler);
            controls.dispose();
            sceneData?.dispose();
            sceneData = null;
            renderer.dispose();
            if (typeof renderer.forceContextLoss === "function") renderer.forceContextLoss();
            container.replaceChildren();
        },
    };

    function rebuildScene() {
        try {
            const previous = sceneData;
            if (previous?.root && scene.children.includes(previous.root)) scene.remove(previous.root);
            previous?.dispose();
            sceneData = null;
            sceneData = createSceneGeometry(design);
            scene.add(sceneData.root);
            paintExcess();
            setSelectedBin(sceneData, lockMode ? null : selectedId);
            applySceneMode(sceneData, mode, selectedId);
            clearOverlay();
        } catch (error) {
            showOverlay("The preview could not build this model. Check the selected design values.");
            onError(error);
        }
    }

    function paintExcess() {
        if (sceneData) {
            sceneData.highlightExcess = highlightExcess;
            sceneData.excessOverlay.visible = highlightExcess && mode !== "selected";
        }
        sceneData?.spacers.traverse(object => {
            if (object.isMesh) object.material.color.set(highlightExcess ? "#d5ab55" : "#7f8c98");
        });
    }

    function setMode(nextMode) {
        if (mode === nextMode) return;
        mode = nextMode;
        if (sceneData) {
            applySceneMode(sceneData, mode, selectedId);
            frameScene(true);
            updateUi();
            requestRender();
        }
    }

    function updateUi() {
        modeButtons.forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
        });
        selectedButton.disabled = !selectedId;
        const selectedBin = design?.bins.find((bin) => bin.id === selectedId);
        selection.textContent = mode === "baseplate" && design
            ? `${design.grid.columns}×${design.grid.rows} cells · ${gridFrame(design.grid).heightMm} mm baseplate`
            : selectedBin
            ? `${selectedBin.label || "Bin"} · ${selectedBin.width}×${selectedBin.depth} cells · ${selectedBin.height}U${selectedBin.inlay ? " · recess" : ""}`
            : "No bin selected";
    }

    function frameScene(resetCamera) {
        if (!sceneData) return;
        const box = getViewBounds(sceneData, mode, selectedId);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length(), 28) * 0.5;
        const width = Math.max(1, stage.clientWidth);
        const height = Math.max(1, stage.clientHeight);
        camera.aspect = width / height;
        const fitHeight = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const fitWidth = fitHeight / camera.aspect;
        const distance = Math.max(fitHeight, fitWidth, radius * 1.8) * 1.22;
        const direction = resetCamera || camera.position.distanceToSquared(controls.target) < 1
            ? DEFAULT_VIEW_DIRECTION
            : camera.position.clone().sub(controls.target).normalize();
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(direction, distance);
        camera.near = Math.max(0.1, distance / 120);
        camera.far = Math.max(400, distance * 24);
        controls.minDistance = Math.max(18, distance * 0.18);
        controls.maxDistance = Math.max(240, distance * 8);
        camera.updateProjectionMatrix();
        camera.lookAt(center);
        controls.update();
    }

    function resizeRenderer() {
        const width = Math.max(1, Math.round(stage.clientWidth || 1));
        const height = Math.max(240, Math.round(stage.clientHeight || 240));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function requestRender() {
        if (renderQueued || disposed || !isRenderable()) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            if (!isRenderable()) return;
            renderer.render(scene, camera);
        });
    }

    function isRenderable() {
        return !disposed &&
            document.visibilityState === "visible" &&
            !container.hidden &&
            stage.clientWidth > 0 &&
            stage.clientHeight > 0;
    }

    function moveCamera(action) {
        const offset = camera.position.clone().sub(controls.target);
        switch (action) {
            case "left":
                offset.applyAxisAngle(Z_AXIS, ORBIT_STEP);
                break;
            case "right":
                offset.applyAxisAngle(Z_AXIS, -ORBIT_STEP);
                break;
            case "up":
                tiltOffset(offset, -ORBIT_STEP * 0.65);
                break;
            case "down":
                tiltOffset(offset, ORBIT_STEP * 0.65);
                break;
            case "in":
                offset.multiplyScalar(1 / ZOOM_FACTOR);
                break;
            case "out":
                offset.multiplyScalar(ZOOM_FACTOR);
                break;
            case "reset":
                frameScene(true);
                requestRender();
                return;
            default:
                return;
        }
        camera.position.copy(controls.target).add(offset);
        camera.lookAt(controls.target);
        controls.update();
        requestRender();
    }

    function tiltOffset(offset, angle) {
        const right = offset.clone().cross(Z_AXIS).normalize();
        if (!Number.isFinite(right.lengthSq()) || right.lengthSq() < 1e-8) return;
        const candidate = offset.clone().applyAxisAngle(right, angle);
        const polar = candidate.angleTo(Z_AXIS);
        if (polar < controls.minPolarAngle || polar > controls.maxPolarAngle) return;
        offset.copy(candidate);
    }

    function pickBin(event) {
        if (!sceneData || mode === "baseplate") return;
        const rect = renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, camera);
        const targets = sceneData.selectionTargets.filter(target => mode !== "selected" || target.userData.binId === selectedId);
        const hit = raycaster.intersectObjects(targets, false)
            .find((intersection) => intersection.object.userData.binId);
        if (hit) onSelect(hit.object.userData.binId);
    }

    function showOverlay(message) {
        overlay.hidden = false;
        overlay.textContent = message;
    }

    function clearOverlay() {
        overlay.hidden = true;
        overlay.textContent = "";
    }
}
