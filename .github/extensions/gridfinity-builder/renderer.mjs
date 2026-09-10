import { renderBinControls } from "./bin-controls.mjs";
import { GRID_ALIGNMENTS } from "./grid.mjs";

export function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Gridfinity workbench</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/viewer.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <header class="app-header">
    <h1 class="sr-only">Gridfinity workbench</h1>
    <nav class="workflow-tabs" role="tablist" aria-label="Workbench tasks">
      <button id="tab-layout" role="tab" aria-controls="workflow-layout" aria-selected="true" data-workflow="layout">Layout</button>
      <button id="tab-bin" role="tab" aria-controls="workflow-bin" aria-selected="false" tabindex="-1" data-workflow="bin">New bin</button>
      <button id="tab-grid" role="tab" aria-controls="workflow-grid" aria-selected="false" tabindex="-1" data-workflow="grid">New grid</button>
    </nav>
    <div class="header-actions">
      <span id="connection-dot" class="connection-dot" role="img" aria-label="Connecting" title="Connecting"></span>
      <details id="file-menu" class="header-menu">
        <summary>File</summary>
        <div class="command-popover" role="group" aria-label="File actions">
          <button id="new-design">New design</button><button id="open-design">Open</button><button id="save-design" data-requires-state>Save</button>
          <button id="import-json" data-requires-state>Import JSON</button>
          <div class="menu-status"><span id="save-status" class="quiet">Edits autosave</span><span id="connection-status" class="quiet" role="status">Connecting...</span></div>
        </div>
      </details>
      <details id="export-panel" class="header-menu">
        <summary id="export-menu-trigger">Export</summary>
        <div class="command-popover" role="group" aria-label="Export actions">
          <p id="export-context" class="quiet">Saved layout</p>
          <label for="fabrication-part">Export part</label><select id="fabrication-part"><option value="baseplate">Baseplate</option><option value="spacers">Edge spacers</option><option value="bin">Selected bin</option><option value="bins">All bins</option></select>
          <div class="menu-buttons"><button id="export-stl" class="primary" disabled>Export STL</button><button id="open-bambu" disabled>Open in Bambu</button></div>
          <span id="fabrication-status" class="quiet" role="status">Checking local export tools...</span>
          <button id="refresh-fabrication" class="text-button">Refresh apps</button>
          <button id="export-json" data-requires-state>Export layout JSON</button>
          <button id="export-active-scad" hidden>Export draft OpenSCAD</button>
          <details id="saved-scad-menu" class="export-menu"><summary>OpenSCAD source ▾</summary><div class="export-options"><button data-export="baseplate" data-requires-state>Download baseplate</button><button data-export="spacers" data-requires-state>Download edge spacers</button><button data-export="bins" data-requires-state>Download all bins</button><button data-export="bin" data-needs-selection>Download selected bin</button></div></details>
        </div>
      </details>
    </div>
  </header>
  <input id="import-file" type="file" accept=".json,application/json" hidden>
  <div id="error-banner" class="notice error" role="alert" hidden><span id="error-message"></span><button id="edit-drawer-error" type="button" hidden>Edit drawer</button><button id="dismiss-error" aria-label="Dismiss error">×</button></div>
  <div id="workflow-layout" role="tabpanel" aria-labelledby="tab-layout">
  <main>
    <section class="workbench" aria-labelledby="layout-heading">
      <div class="section-heading"><div><p id="preview-label" class="eyebrow">Layout / top view</p><h2 id="layout-heading">Your workbench</h2></div><button id="add-bin" class="primary" data-requires-state>+ Add bin</button></div>
      <div class="measurement-strip"><span><strong id="cell-size">— × —</strong> cells</span><span><strong id="physical-size">— × —</strong> mm</span><span><strong>42</strong> mm / cell</span><span><strong>7</strong> mm / U</span></div>
      <p id="drawer-summary" class="drawer-summary" hidden></p>
      <div class="view-switch" role="group" aria-label="Preview mode"><button id="view-layout" aria-pressed="true">Layout</button><button id="view-3d" aria-pressed="false">3D model</button><div id="layout-zoom" class="layout-zoom"><label for="grid-zoom">Zoom</label><input id="grid-zoom" type="range" min="100" max="250" step="25" value="100"><button id="fit-grid" type="button">Fit grid</button></div></div>
      <div id="layout-preview" class="board-scroll" tabindex="0" aria-label="Scrollable layout preview">
        <div id="board-frame" class="board-frame">
          <span class="ruler-origin" aria-hidden="true">cell</span>
          <div id="ruler-x" class="ruler ruler-x" aria-hidden="true"></div>
          <div id="ruler-y" class="ruler ruler-y" aria-hidden="true"></div>
          <div id="board" class="board" role="group" aria-label="Bin layout. Select a bin, then use arrow keys to move it."></div>
        </div>
      </div>
      <div id="model-viewer" hidden></div>
      <div class="layout-footer"><span id="layout-summary">Waiting for your design…</span><span class="keyboard-hint">Drag to snap · Arrow keys to move · Double-click or right-click to start a similar bin</span></div>
      <div class="occupancy-track" aria-hidden="true"><span id="occupancy-fill"></span></div>
      <p id="empty-hint" class="empty-hint" hidden>Add a bin to start. Select a bin to fit an item from a photo.</p>
      <p class="prototype-note"><strong>Inspect and fit-test before printing.</strong> STL files are rendered with OpenSCAD, not copied from preview meshes. Bin construction follows its saved options; photo recesses have a constant depth. Bambu opens the file for review and does not start a print.</p>
    </section>
    <aside class="inspector" aria-label="Layout and bin settings">
      <section class="inspector-section">
        <div class="panel-heading"><h2>Design</h2><span id="revision-label" class="quiet">v1 JSON</span></div>
        <form id="design-form">
          <label for="design-name">Name</label><input id="design-name" name="name" maxlength="100" required autocomplete="off">
          <div class="field-pair"><div><label for="grid-columns">Columns</label><input id="grid-columns" name="columns" type="number" min="1" max="32" step="1" required></div><div><label for="grid-rows">Rows</label><input id="grid-rows" name="rows" type="number" min="1" max="32" step="1" required></div></div>
          <p id="grid-sizing-help" class="field-help">Use drawer dimensions to calculate the cell count, or switch it off to set cells manually.</p>
          <div class="layout-drawer-controls">
            <label class="checkbox-label"><input id="layout-drawer-enabled" type="checkbox"> Use drawer dimensions</label>
            <fieldset id="layout-drawer-fields" disabled>
              <legend>Drawer dimensions</legend>
              <div class="field-pair"><div><label for="layout-drawer-width">Width (cm)</label><input id="layout-drawer-width" type="number" min="4.2" max="200" step="any" required></div><div><label for="layout-drawer-depth">Depth (cm)</label><input id="layout-drawer-depth" type="number" min="4.2" max="200" step="any" required></div></div>
              <label for="layout-drawer-clearance">Clearance per edge (mm)</label><input id="layout-drawer-clearance" type="number" min="0" max="5" step="any" required>
            </fieldset>
            <p class="field-help">Drawer width, depth, and clearance calculate the cells and spacers automatically. Valid changes update the layout and save. Switch off drawer dimensions to set cells manually.</p>
          </div>
          <div class="form-actions"><span class="field-help">Valid changes save automatically.</span><button id="reset-design" class="text-button" type="button" data-requires-state>Reset fields</button></div>
        </form>
      </section>
      <section class="inspector-section bin-section">
        <div class="panel-heading"><h2>Selected bin</h2><span id="selection-count" class="quiet">None</span></div>
        <div id="no-selection" class="no-selection"><span aria-hidden="true">▱</span><p>Select a bin to adjust its size, position, and finish.</p></div>
        <form id="bin-form" hidden>
          <label for="bin-label">Label</label><input id="bin-label" name="label" maxlength="80" required autocomplete="off">
          <div class="field-pair"><div><label for="bin-width">Width <span>(cells)</span></label><input id="bin-width" name="width" type="number" min="1" max="32" step="1" required></div><div><label for="bin-depth">Depth <span>(cells)</span></label><input id="bin-depth" name="depth" type="number" min="1" max="32" step="1" required></div></div>
          <div class="field-pair"><div><label for="bin-x">X <span>(column)</span></label><input id="bin-x" name="x" type="number" min="0" max="31" step="1" required></div><div><label for="bin-y">Y <span>(row)</span></label><input id="bin-y" name="y" type="number" min="0" max="31" step="1" required></div></div>
          <div class="field-pair"><div><label for="bin-height">Height <span>(U)</span></label><input id="bin-height" name="height" type="number" min="1" max="20" step="1" required></div><div><label for="bin-rotation">Rotation</label><select id="bin-rotation" name="rotation"><option value="0">0°</option><option value="90">90°</option></select></div></div>
          <label for="bin-color">Color</label><select id="bin-color" name="color"><option value="blue">Workshop blue</option><option value="teal">Teal</option><option value="amber">Amber</option><option value="rose">Rose</option><option value="slate">Slate</option></select>
          ${renderBinControls("bin")}
          <p id="bin-dimensions" class="bin-dimensions"></p>
          <p class="field-help">X/Y start at 0. Width and depth are before rotation. Preview color is for organization only.</p>
          <div class="form-actions"><span class="field-help">Valid changes save automatically.</span><button id="reset-bin" type="button" class="text-button" data-needs-selection>Reset fields</button></div>
          <div class="bin-actions"><button id="rotate-bin" type="button" data-needs-selection>↻ Rotate</button><button id="duplicate-bin" type="button" data-needs-selection>Duplicate</button><button id="use-bin-template" type="button" data-needs-selection>Use as new</button><button id="remove-bin" type="button" class="danger-button" data-needs-selection>Remove</button></div>
          <div class="inlay-controls"><h3>Item recess</h3><p id="inlay-summary" class="field-help">This is an open bin.</p><button id="edit-inlay" type="button" data-needs-selection>Fit item from photo</button><button id="remove-inlay" type="button">Remove recess</button><p class="field-help">Trace a top-down photo to make a solid bin with an item-shaped recess.</p></div>
        </form>
      </section>
      <section class="inspector-section layout-inventory"><div class="panel-heading"><h2>Bins</h2><span id="bin-count" class="quiet">0</span></div><div id="bin-list" class="bin-list"></div><button id="clear-bins" class="text-button danger-button" data-requires-state>Clear all bins</button></section>
      <p id="draft-status" class="draft-status" role="status"></p>
    </aside>
  </main>
  </div>
  <section id="workflow-bin" class="workflow-page" role="tabpanel" aria-labelledby="tab-bin" hidden>
    <header><p class="eyebrow">Bin creation</p><h2>Create a bin before placing it</h2><p>Choose its size, then place it in the first free space in your current layout.</p></header>
    <div class="creator-grid">
      <form id="create-bin-form">
        <label for="new-bin-preset">Starting point</label><select id="new-bin-preset"><option value="standard">Standard bin</option><option value="parts">Parts organizer</option><option value="solid">Solid insert blank</option><option value="custom">Custom settings</option></select>
        <label for="new-bin-label">Bin label</label><input id="new-bin-label" value="New bin" maxlength="80" required>
        <div class="field-pair"><label>Width (cells)<input id="new-bin-width" type="number" min="1" max="32" step="1" value="1" required></label><label>Depth (cells)<input id="new-bin-depth" type="number" min="1" max="32" step="1" value="1" required></label></div>
        <div class="field-pair"><label>Height (U)<input id="new-bin-height" type="number" min="1" max="20" step="1" value="3" required></label><label>Rotation<select id="new-bin-rotation"><option value="0">0 degrees</option><option value="90">90 degrees</option></select></label></div>
        <label for="new-bin-color">Color</label><select id="new-bin-color"><option value="blue">Workshop blue</option><option value="teal">Teal</option><option value="amber">Amber</option><option value="rose">Rose</option><option value="slate">Slate</option></select>
        ${renderBinControls("new-bin")}
        <div class="form-actions"><button id="create-bin-submit" class="primary" type="submit" data-requires-state>Create and place</button><button id="create-bin-photo" type="submit" data-photo="true" data-requires-state>Create and fit photo</button></div>
        <p id="new-bin-template-status" class="field-help" role="status"></p>
        <p class="field-help">Existing bins are not moved. If this bin does not fit, resize the layout or create a larger grid first.</p>
      </form>
      <div class="creator-preview generator-preview">
        <p class="eyebrow">Live 3D preview</p><div id="new-bin-viewer" class="draft-model-viewer"></div>
        <p id="new-bin-error" class="dialog-error" role="alert"></p><strong id="new-bin-size"></strong>
        <div class="draft-export-actions"><button id="export-bin-draft-stl" type="button">Export draft STL</button><button id="export-bin-draft-scad" type="button">OpenSCAD source</button></div>
        <p id="new-bin-export-status" class="field-help" role="status"></p><p id="new-bin-fit" role="status"></p>
        <p class="field-help">Preview exports do not change the layout. Photo recesses cannot be combined with compartments, labels, or scoops.</p>
      </div>
    </div>
  </section>
  <section id="workflow-grid" class="workflow-page" role="tabpanel" aria-labelledby="tab-grid" hidden>
    <header><p class="eyebrow">Grid creation</p><h2>Drawer size in, grid cells out</h2><p>Enter your drawer dimensions. The workbench calculates full 42 mm cells and edge spacers.</p></header>
    <div class="creator-grid">
      <form id="create-grid-form">
        <div class="field-pair"><label>Baseplate type<select id="new-plate-type"><option value="solid">Solid floor</option><option value="frame">Open frame</option></select></label><label>Floor thickness (mm)<input id="new-plate-floor" type="number" value="2" min="0.8" max="5" step="0.1" required></label></div>
        <label for="new-grid-mode">Sizing method</label><select id="new-grid-mode"><option value="cells">Cell count only (no drawer spacers)</option><option value="drawer">Fit to drawer dimensions</option></select>
        <fieldset id="new-grid-cells"><legend>Grid size</legend><div class="field-pair"><label>Columns<input id="new-grid-columns" type="number" min="1" max="32" step="1" value="6" required></label><label>Rows<input id="new-grid-rows" type="number" min="1" max="32" step="1" value="4" required></label></div></fieldset>
        <fieldset id="new-grid-drawer" hidden disabled><legend>Measured drawer interior</legend>
          <button id="alex-preset" type="button">Use IKEA ALEX 5-drawer</button>
          <p class="field-help">ALEX default: approximately 29.2 × 52.4 cm inside the common 36 × 58 cm five-drawer unit. Sizes vary; measure your drawer before printing.</p>
          <label for="drawer-unit">Drawer size units</label><select id="drawer-unit"><option value="cm">Centimetres (cm)</option><option value="mm">Millimetres (mm)</option></select>
          <div class="field-pair"><label><span id="drawer-width-label">Width (cm)</span><input id="drawer-width" type="number" min="4.2" max="200" step="any" value="29.2" required></label><label><span id="drawer-depth-label">Depth (cm)</span><input id="drawer-depth" type="number" min="4.2" max="200" step="any" value="52.4" required></label></div>
          <p class="field-help">For a 20 cm by 20 cm drawer, choose cm and enter 20 for both dimensions.</p>
          <label for="drawer-clearance">Clearance at each drawer edge (mm)</label><input id="drawer-clearance" type="number" min="0" max="5" step="any" value="0.5" required>
          <p class="field-label">Grid alignment</p><input id="drawer-alignment" type="hidden" value="center">
          <div class="alignment-matrix" role="group" aria-label="Grid alignment presets">${Object.keys(GRID_ALIGNMENTS).map((alignment, index) => `<button type="button" data-alignment="${alignment}" aria-label="Align ${alignment.replaceAll("-", " ")}" aria-pressed="${alignment === "center"}">${["↖", "↑", "↗", "←", "•", "→", "↙", "↓", "↘"][index]}</button>`).join("")}</div>
          <label for="grid-offset-x">Horizontal offset from left (mm)</label><div class="offset-control"><input id="grid-offset-x" type="range" min="0" max="42" step="0.1" value="0"><input id="grid-offset-x-mm" aria-label="Horizontal offset in millimeters" type="number" min="0" step="any" value="0"></div><p id="horizontal-excess" class="field-help"></p>
          <label for="grid-offset-y">Vertical offset from front (mm)</label><div class="offset-control"><input id="grid-offset-y" type="range" min="0" max="42" step="0.1" value="0"><input id="grid-offset-y-mm" aria-label="Vertical offset in millimeters" type="number" min="0" step="any" value="0"></div><p id="vertical-excess" class="field-help"></p>
          <label class="checkbox-label"><input id="drawer-spacers" type="checkbox" checked> Fill the excess space</label>
          <label for="drawer-margin">Excess material</label><select id="drawer-margin"><option value="separate">Separate spacer parts</option><option value="integrated">Integrated solid border</option></select>
        </fieldset>
        <div class="form-actions"><button id="create-grid-submit" class="primary" type="submit" data-requires-state>Apply grid to layout</button><button id="reset-new-grid" type="button">Reset fields</button></div>
        <p class="field-help">This resizes the current layout without deleting bins. A smaller grid is rejected if any existing bin would be outside it. Use New design for a separate drawer.</p>
      </form>
      <div class="creator-preview generator-preview">
        <p class="eyebrow">Live baseplate preview</p><div id="new-grid-viewer" class="draft-model-viewer"></div>
        <p id="new-grid-error" class="dialog-error" role="alert"></p>
        <strong id="grid-fit-size"></strong><p id="grid-fit-gaps"></p><p id="grid-fit-warning" class="field-help" role="status"></p>
        <div class="draft-export-actions"><button id="export-grid-draft-stl" type="button">Export draft STL</button><button id="export-grid-draft-scad" type="button">OpenSCAD source</button><button id="export-grid-draft-spacers" type="button">Spacer STL</button></div>
        <p id="new-grid-export-status" class="field-help" role="status"></p>
        <label class="checkbox-label"><input id="highlight-excess" type="checkbox" checked> Highlight excess space</label>
        <details class="fit-plan"><summary>Top view and excess</summary><svg id="grid-fit-diagram" role="img" aria-label="Grid and excess-space preview; front is at the bottom"></svg></details>
        <p class="field-help">Amber marks excess material. An integrated border exports with the baseplate; separate spacers export as their own parts. Long parts may need splitting in your slicer.</p>
      </div>
    </div>
  </section>
  <dialog id="design-dialog" aria-labelledby="design-dialog-heading">
    <div class="dialog-heading"><h2 id="design-dialog-heading">Open design</h2><button id="close-design-dialog" aria-label="Close design dialog">×</button></div>
    <form id="open-form"><label for="saved-designs">Saved designs</label><select id="saved-designs" required></select><p id="design-list-status" role="status"></p><button id="open-submit" class="primary" type="submit">Open in new panel</button></form>
    <form id="new-form" hidden><label for="new-name">New design name</label><input id="new-name" maxlength="100" value="Untitled workbench" required autocomplete="off"><p class="field-help">Create a separate workbench in a new panel. This panel and its unapplied fields stay as they are.</p><button class="primary" type="submit">Create and open</button></form>
    <p id="dialog-error" class="dialog-error" role="alert"></p>
  </dialog>
  <dialog id="confirm-dialog" aria-labelledby="confirm-heading"><h2 id="confirm-heading">Replace layout?</h2><p id="confirm-message"></p><div class="form-actions"><button id="confirm-cancel">Cancel</button><button id="confirm-accept" class="primary">Continue</button></div></dialog>
</body>
</html>`;
}
