# Gridfinity Builder guide

[Back to the README](../README.md)

A local Copilot canvas for Gridfinity baseplates, bins, and drawer layouts.
Fit grids to drawers, arrange bins, preview them in 3D, and trace item photos
into custom recesses. Export STL files or send them to Bambu Studio.
Use the workbench controls or ask Copilot in chat to edit the same saved design.

[Install](#install) · [Usage](#open-and-use) · [Fabrication limits](#fabrication-exports-and-limits) · [Contributing](../CONTRIBUTING.md)

The workbench uses a **42 mm XY pitch** and **7 mm height units**. It checks
rotated bin footprints, collisions, and grid boundaries before it saves a
change. Invalid edits do not remove existing work.

## Install

Requires a Copilot app/CLI release with **extension canvases** and the
`install_extension` tool. The canvas API is experimental. A plain terminal-only
client without a canvas renderer cannot show the workbench. Copilot chat uses
your current signed-in session and its normal permissions and usage limits.

Ask Copilot:

```text
Install this canvas extension for my user:
https://github.com/JasonEtco/gridfinity-copilot-extension/tree/main/.github/extensions/gridfinity-builder
```

The exact tool call is:

```json
{
  "url": "https://github.com/JasonEtco/gridfinity-copilot-extension/tree/main/.github/extensions/gridfinity-builder",
  "name": "gridfinity-builder",
  "scope": "user"
}
```

This uses **`install_extension`**, not a package manager.
To use a reviewed release, replace `main` in the URL with its commit SHA.

For a manual install, clone this repository and copy the **whole**
`.github/extensions/gridfinity-builder/` folder to:

```text
$COPILOT_HOME/extensions/gridfinity-builder/
```

`COPILOT_HOME` defaults to `~/.copilot`. For a project-only install, copy the
folder to that project's `.github/extensions/`. Do not overwrite an existing
`artifacts/` folder when updating. Reload extensions or restart Copilot.
Project extensions take priority over user extensions with the same name.

The layout, photo editor, and viewer are self-contained: no `npm install`, CDN,
external fonts, or API keys are needed. Three.js is bundled locally in
`vendor/`. Copilot resolves `@github/copilot-sdk` itself; do not install that
package in this extension. STL export also needs a local OpenSCAD installation.
The Bambu button needs Bambu Studio. See [STL and Bambu Studio](#stl-and-bambu-studio).

## Open and use

The compact top bar contains the task tabs and two menus. **File** contains
new/open/save and JSON import. **Export** contains STL, Bambu Studio, JSON,
OpenSCAD, and export-tool status. Menus open over the work area, not as extra
header rows.
The Export menu follows the active tab: **New bin** exports only the current
bin draft; **New grid** exports only the current baseplate draft. Neither
requires placing the draft in the layout. Use the draft preview's **Spacer STL**
button for separate grid spacers. **Layout** exposes the saved-part selector,
layout JSON, and Bambu Studio handoff.

Ask: **"Open Gridfinity Builder for design `tool-drawer`."** The canvas type is
`gridfinity-builder`; the open input must include a stable `designId`.

```json
{
  "canvasId": "gridfinity-builder",
  "instanceId": "drawer-panel",
  "input": { "designId": "tool-drawer", "name": "Tool drawer" }
}
```

- **Layout:** move and edit existing bins. Change columns and rows in the
  inspector to resize the layout without deleting bins. The main size and
  rulers use grid cells; millimeter dimensions are shown alongside them.
  Drawer width, depth, and edge clearance are directly below the cell counts.
  With **Use drawer dimensions** on, Columns and Rows are disabled and calculated
  from the measurements. Changing width, depth, or clearance updates the cell
  count, spacers, preview, and saved layout automatically.
  The grid fits a compact preview by default; use **Zoom** or **Fit grid** to
  change the view without changing the design's physical size.
- **New bin:** set the size, height, label, and color before creating the bin.
  A live 3D preview responds to construction options before anything is saved.
  Expand the compartments/walls, lip/labels/access, and magnets/screws groups.
  Export the draft directly as STL or SCAD without placing it in the layout.
  **Create and place** uses the first free space. **Create and fit photo**
  continues into the photo editor.
- **New grid:** use cell counts or measured drawer dimensions. Apply the grid
  to the current layout; existing bins must still fit. Its own live 3D preview
  and top-view diagram show alignment and excess space.
  Draft export does not change the saved layout, even if the new grid would
  be too small for its current bins.
- Move bins on the grid, or use position fields. Rotate, duplicate, and remove
  bins with the inspector controls. Arrow keys move a focused bin one cell.
- Use the local 3D viewer to orbit and zoom around the layout or selected bin.
  It shows prototype geometry, not a validated printable mesh.
- Add a photo inlay to a selected bin to make a recess shaped like an item.
- Bin and layout inspector fields update and save automatically after a short
  typing pause; there is no Apply button for these fields. Invalid dimensions,
  collisions, or a stale revision leave the saved layout unchanged and show an
  error. Fix the fields or use **Reset fields** to load the current saved values.
  **Save** can also flush pending valid edits.
  **Open** and **New** open a separate panel so each panel keeps its document
  identity when the extension restarts.
- Export JSON for a backup. Import JSON to replace the current design contents;
  the current design ID stays the same.

### Drawer fit and edge spacers

In **New grid**, choose **Fit to drawer dimensions** and enter the measured
interior width and depth in **cm or mm**. Changing the unit converts the values
without changing the physical size. Set the clearance at each drawer edge, then choose
one of nine grid-alignment positions, or set custom horizontal and vertical
offsets in millimeters.

New designs default to the common **IKEA ALEX five-drawer unit** (36 × 58 cm
outside), using an approximate **29.2 × 52.4 cm interior**. This measured preset
comes from [these ALEX interior measurements](https://theworkspacehero.com/alex-drawer-dimensions/),
not the cabinet's outer dimensions. With 0.5 mm edge clearance it produces
**6 × 12 cells**, plus edge spacers. ALEX versions and manufacturing tolerances
vary; measure your own drawer. Seven cells across need at least 29.5 cm inside
at that clearance. Use **Use IKEA ALEX 5-drawer** to restore the preset in New
grid. Existing saved designs are not changed by the new default.

For a **20 cm × 20 cm** drawer, choose cm and enter **20** in both fields.
The result is **4 × 4 cells** (168 × 168 mm), with **15.5 mm spacers on each
side** and 0.5 mm clearance at each drawer edge.

Cells always stay **42 mm** apart. The remaining space is not spread between
cells or used to stretch them. **Fill the excess space** supports separate
spacer parts or an **integrated solid border**. Turn it off to leave the excess
empty. The margins use the baseplate's height: 7 mm with the default solid
floor, or 5 mm with an open frame.

The alignment pad uses back/left/right/front positions. Offsets are measured
from the left and front edges of the usable area. The controls show the excess
on all four sides; **Highlight excess space** marks it in the previews.
Front is at the bottom of the top-view diagram. Custom offsets must fit the
available excess; when resizing automatically in Layout, offsets are limited
to the remaining space.

Choose **Solid floor** or **Open frame** for the baseplate. Solid floor
thickness is configurable from 0.8 to 5 mm. Separate spacers export with
**Edge spacers**; an integrated border is part of the **Baseplate** export.

For example, a 300 × 430 mm drawer with 0.5 mm clearance per edge fits a
7 × 10 grid (294 × 420 mm). Centered alignment leaves 2.5 mm spacers on the
left and right, and 4.5 mm spacers at the front and back.

With **Use drawer dimensions** on, edit the measurements rather than Columns
and Rows. The cell count is calculated automatically; it cannot be edited by
hand in this mode. A change that would put existing bins outside the grid is
rejected without removing them.
Switch off **Use drawer dimensions** to enable manual cell counts, or choose
**Cell count only (no drawer spacers)** in New grid to remove those limits.
Resizing never removes bins to force a fit: the whole edit is rejected if a
bin would be outside the new grid. Use **New design** for a separate drawer.
Thin spacers and parts larger than your printer bed need review in the slicer;
the extension does not split large parts automatically.

Other useful requests:

```text
Keep the screwdriver bins. Add four 1 by 1 bins for screws in the empty space.
Rotate the long bin and move it to the right edge, without moving other bins.
Make all screw bins 4U high and color them amber.
Tell me how much space is still free.
```

### Bin construction options

**New bin** has a live, orbitable 3D preview. Standard bin, parts organizer,
and solid insert presets provide starting points. Invalid combinations keep
the last valid preview and cannot be placed.

| Group | Controls |
|---|---|
| Compartments and walls | Wall and floor thickness, compartment rows/columns, divider thickness, solid fill |
| Lip, labels and access | Stacking lip, label position/width/depth, finger scoop radius |
| Magnets and screws | Bin magnet pockets and blind screw holes, diameters and depths |

These options remain editable in the selected-bin inspector after placement.
They are stored in `bin.options` and used by both the preview and SCAD/STL
exports. Partial `update_bin` option edits preserve other settings.
The grid pitch stays 42 mm. A stacking lip adds 4.4 mm above the nominal
`7 * U` body height and requires walls no thicker than 2.6 mm. Label ledges
have sloped support, and finger scoops form curved ramps at the front floor.
Hole depths must leave material above them; very thin
floors, small compartments, and incompatible feature combinations are rejected.

Photo recesses support wall/floor settings, mounting holes, and a stacking
lip, but not multiple compartments, label ledges, or scoops. A lipped photo
recess must also fit through the lip's inner opening.

The controls take inspiration from [Perplexing Labs](https://gridfinity.perplexinglabs.com/)
and [Extrabold Tools](https://www.extrabold.tools/gridfinity-baseplate), with
an independent geometry implementation. This is not feature-for-feature
parity: vase/cylinder bins, refined magnets, CLICKbase connectors, baseplate
mounting holes, and automatic printer-bed splitting are not included.

### Working with Copilot

Make requests in Copilot chat; there is no separate chat composer in the canvas.
For example: "Make a 6 by 4 grid with two long bins for screwdrivers and small
bins for screws."

Copilot can inspect and steer the canvas through its documented actions:

| Action | Purpose |
|---|---|
| `get_state` | Read the layout, revision, and photo-reference metadata (not image bytes) |
| `apply_edits` | Apply a transactional batch with `expectedRevision` |
| `import_layout` | Validate and replace layout contents with `expectedRevision` |
| `export_design` | Export JSON, OpenSCAD source, or a locally rendered STL file |

Read state before editing. If the revision changed, read again and reconsider
the edits rather than overwriting newer work. Invalid batches do not partially
apply. Edits appear in other panels for the design on their next state refresh.
Use `list_canvas_capabilities` for the current input schemas. Permissions,
model access, and session mode still apply; the extension grants no blanket
permission.

For example, call `invoke_canvas_action` on the panel opened above:

```json
{
  "instanceId": "drawer-panel",
  "actionName": "get_state",
  "input": {}
}
```

Suppose the returned design has revision `12` and an existing bin named
`pliers` that is at least 1 × 1 cells and 2U high. This example adds a rectangular
recess; replace the revision, bin ID, and outline with values from your design:

```json
{
  "instanceId": "drawer-panel",
  "actionName": "apply_edits",
  "input": {
    "expectedRevision": 12,
    "operations": [
      {
        "type": "update_bin",
        "id": "pliers",
        "changes": {
          "inlay": {
            "outline": [[5, 5], [25, 5], [25, 15], [5, 15]],
            "depth": 3,
            "clearance": 0.4
          }
        }
      }
    ]
  }
}
```

`get_state` omits photo bytes and includes `photoReferences` metadata; it does
not give Copilot the image itself. Inlay edits that omit `photo` preserve the
saved reference photo. Set `changes.inlay` to `null` to remove both the recess
and its photo. JSON export includes photos; do not use the photo-stripped state
as a portable backup.

Grid actions include `resize_grid`, `set_drawer`, `fit_drawer`, `clear_drawer`,
and `set_baseplate`.
`set_drawer` changes drawer settings without recalculating the cell count;
batch it with `resize_grid` to update both atomically.
`set_baseplate` accepts `{ "type": "solid", "floorMm": 2 }`; use `"frame"` for
an open frame.
Drawer settings also accept nine alignment names or `"custom"` with
`offsetXmm` and `offsetYmm`, plus `margin: "separate" | "integrated"` when
`spacers` is true.
The action format stores millimeters, so a request for 20 cm × 20 cm uses
`widthMm: 200` and `depthMm: 200`. A drawer-fit operation uses this shape inside
a revision-checked `operations` array:

```json
{
  "type": "fit_drawer",
  "drawer": {
    "widthMm": 300,
    "depthMm": 430,
    "clearanceMm": 0.5,
    "alignment": "center",
    "spacers": true
  }
}
```

### Photo inlays

1. Select a bin and upload a top-down photo of the item.
2. Click around its silhouette to trace an outline, then edit the outline to
   fit. Use a clear photo taken straight above the item to reduce distortion.
3. Enter the item's known real width in millimeters. This scales the traced
   silhouette; it does not infer dimensions from the photo.
4. Set the recess depth and clearance, then inspect the result in 3D.

An inlay produces a **solid bin with an item-shaped recess**, rather than a
normal hollow bin. This is a **2.5D silhouette**, not a 3D scan: the outline is
cut to the depth you provide, without automatic depth or hidden-shape inference.
Photo perspective, tracing accuracy, printer tolerance, and clearance all affect
fit. Verify dimensions and print a sample before making a full insert.

Upload JPEG, PNG, or WebP files up to **10 MiB**. The client downsizes and
re-encodes them as JPEG, at most **1200 pixels per side** and **512 KiB** of
encoded image data. Photos are saved with the design outside the repository
and included in portable JSON exports. The complete design or JSON import must
fit within **4 MiB**, including image data. The layout format remains
**version 1**, with optional `bin.inlay`; older layouts without inlays still work.

For direct canvas edits, outline points are millimeters in the **unrotated
outer bin's** XY coordinates, not grid cells or photo pixels. Its bounds are
`0..42 * width - 0.5` by `0..42 * depth - 0.5` mm; the recess must also pass
wall/clearance fit checks. Use a simple polygon with **3–128 points** and no
self-intersections. Recess depth is **0.1 to `7 * height - 4.75 - floorMm` mm**
(the floor defaults to 1.2 mm); clearance
is **0–3 mm per side**. Here `width` and `depth` are the bin's cell dimensions,
and `height` is in 7 mm units.

## Storage and privacy

Designs are stored by **design ID**, never by panel instance ID:

```text
$COPILOT_HOME/extensions/gridfinity-builder/artifacts/<designId>.json
```

This applies to project installs too. Private layouts and reference photos do
not go in the source repository unless you copy or export them there. Design IDs
use 1-64 letters, numbers, underscores, or hyphens and start with a letter or
number. Use a distinct ID for each drawer or project.
Two sessions that open the same ID share the same file.

Writes use a per-design lock, a private temporary file, and atomic rename.
Concurrent writers get a conflict rather than lost changes. After a process
crash, a `<designId>.lock` directory can remain. Stop all writers for that
design, back up the JSON, then remove **only that design's lock directory**.
Do not remove a lock held by a running session.

The server listens on `127.0.0.1` only. All data routes require a random
per-panel token. Browser requests with a foreign origin are rejected.
The token is in the panel URL fragment; do not share a live panel URL.
Static assets have no design data. Rendering and photo editing run locally;
the viewer does not load a network CDN. Copilot can read design information
through canvas actions, so treat anything you ask it to inspect with the same
care as information shared in Copilot chat. Exported JSON can contain the full
reference photo: review it before attaching it to a public issue.

See [SECURITY.md](../SECURITY.md) for vulnerability reporting. Never share a live
panel URL, its token, private photos, or unredacted logs in a public report.

## Fabrication exports and limits

**Inspect exports and print a fit sample before printing a full design.**
The interactive 3D viewer helps inspect proportions and placement, but it is
not a slicer. STL export runs OpenSCAD against the generated solid geometry;
it does not copy overlapping preview meshes into a file. Physical fit still
depends on measurement, material, and printer settings.
Binary STL conversion can collapse coincident vertices into zero-area facets.
Export removes only those exact zero-area facets, retains the other triangles,
and records the removal count in the file header and artifact metadata.

### STL and Bambu Studio

Install [OpenSCAD](https://openscad.org/downloads.html) to enable **Export STL**.
On macOS, the current supported Homebrew snapshot can be installed with:

```sh
brew install --cask openscad@snapshot
```

Use a supported build for your OS; do not bypass Gatekeeper or other platform
security checks. Open **Export → Refresh apps** after installation. If a required app
is missing, the workbench reports that dependency instead of generating an
approximate substitute.

For a non-standard installation, set `GRIDFINITY_OPENSCAD_PATH` to the full
OpenSCAD executable path before starting Copilot. `GRIDFINITY_BAMBU_PATH` can
point to the Bambu Studio `.app` bundle on macOS, or its executable on Windows
and Linux. Browser requests cannot choose application paths.

From **Layout**, choose **Baseplate**, **Edge spacers**, **Selected bin**, or **All bins** in the
export selector. Rendering can take up to two minutes. Exports use the saved
design revision, not unapplied form fields.

With [Bambu Studio](https://bambulab.com/download/studio) installed,
**Open in Bambu** renders an STL and opens that local file for review.
It does **not** select a printer, upload a model, slice it, or start a print.
Inspect orientation and dimensions, choose your own print settings, then print
from Bambu Studio when ready.

Rendered files are kept under the design storage folder's `exports/`
subdirectory, outside the repository. JSON and editable SCAD downloads do not
need OpenSCAD. Installing the extension does not install external applications.

| Item | Supported |
|---|---|
| Grid | 1-32 columns and rows, full cells only |
| Bins | Rectangular footprints, 1-20U high, 0 or 90 degree rotation |
| Bin body | `42 * cells - 0.5` mm outer size, configurable walls/floor, rounded corners |
| Bin height | `7 * U` mm body height; optional lip adds 4.4 mm |
| Bin feet | Repeated per cell; 0.8 / 1.8 / 2.15 mm profile sections |
| Baseplate | Solid floor (0.8-5 mm) or open frame; 5 mm socket/relief above the floor |
| Photo inlay | Editable scaled silhouette, user-set depth and clearance, solid bin |
| Drawer fit | Nine alignments or custom offsets; empty excess, separate spacers, or integrated border |
| Downloads | Version-1 JSON; baseplate, spacer, all-bin or selected-bin SCAD/STL |
| Handoff | Open a rendered local STL in Bambu Studio; no automatic printing |
| Not included | Half cells, vase/cylinder bins, baseplate mounting holes, connectors, automatic bed splitting |

All-bin SCAD and STL exports use the layout positions on the XY plane, with each bin
on its own feet at Z=0. The plate is exported separately. Colors and labels
are layout metadata, not embossed geometry. SCAD parameters can be changed
after export, but those changes do not flow back into the saved design.
Spacer exports pack the separate bars in a row with 5 mm gaps; they are not
joined to the baseplate. Large plates and bin groups can exceed your printer's
build area.

### Geometry sources

The geometry code is original. No third-party CAD implementation is bundled.
Dimensional references:

- [Gridfinity specification](https://gridfinity.xyz/specification/), including
  the community design reference drawing. The page calls the specification a
  work in progress.
- [Unofficial Gridfinity specification](https://github.com/gridfinity-unofficial/specification):
  the 42 x 42 x 7 mm format and 41.5 mm single-cell block.
- [Stu142 engineering drawings](https://github.com/Stu142/Gridfinity-Documentation/tree/main/drawing_svg):
  `bin_bottom_profile.svg`, `bin_profile_width.svg`, `bin_radius.svg`,
  `bin_total_width.svg`, and `baseplate_profile.svg`.
- [Cross-referenced interface notes](https://github.com/ferrivbe/gridfinity-generator/blob/master/docs/SPEC.md):
  useful comparison of the foot/socket heights and bottom relief.

The export uses these nominal dimensions. Printer tolerance, slicing,
material behavior, and physical fit still need testing for your setup.
The baseplate floor and bin wall/floor thickness are this project's choices,
not a claim that every Gridfinity variant uses them.
The export uses a 0.01 mm Boolean tolerance and a tiny finite socket rim to
avoid coincident surfaces and degenerate STL facets.

## Development

Use Node.js **22 or 24**. From the repository root:

```sh
npm ci
npm test
npm run build:vendor
```

Tests use Node's built-in runner. They cover model validation, rotations,
collisions, atomic edits, import/export, persistence, and HTTP access checks.
They do not claim a physical print fit or replace a live runtime check.
Three.js and esbuild are development dependencies used to produce the checked-in
local viewer bundle. Commit regenerated `vendor/` files when changing the
bundle inputs; CI checks that rebuilding leaves them unchanged.

The extension folder is self-contained:

| File | Responsibility |
|---|---|
| `extension.mjs` | SDK registration, canvas actions, open/close lifecycle |
| `model.mjs`, `schemas.mjs` | Layout rules and public action schemas |
| `storage.mjs` | User-owned files and atomic persistence |
| `geometry.mjs` | Original editable OpenSCAD generation |
| `bin-options.mjs`, `bin-controls.mjs`, `bin-scad.mjs`, `bin-mesh.mjs` | Configurable bin validation, controls, CAD and preview meshes |
| `grid.mjs`, `workflows.mjs` | Drawer fitting, edge spacers, and task tabs |
| `preview.mjs` | Compact grid sizing and view-only zoom |
| `fabrication.mjs` | Local OpenSCAD rendering and Bambu Studio handoff |
| `inlay.mjs`, `photo-editor.mjs` | Scaled photo outlines, recess validation, and tracing controls |
| `scene-geometry.mjs`, `viewer.mjs`, `viewer.css` | Local 3D geometry, camera controls, and preview |
| `vendor/` | Bundled browser dependencies, with license notices |
| `workbench.mjs` | Shared design operations |
| `server.mjs` | Protected loopback HTTP routes |
| `renderer.mjs`, `app.js`, `styles.css` | Workbench UI |

After code changes, call `extensions_reload`, then
`extensions_manage` with `list` and `inspect`. Provider logs are shown by
`inspect`. Never write to stdout from extension code; it is reserved for
JSON-RPC. Use `list_canvas_capabilities`, `open_canvas`, and
`invoke_canvas_action` to check runtime routing. Action names with the
`canvas.` prefix are reserved.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, testing, and pull requests.

## License

[MIT](../LICENSE). Gridfinity is a system created by Zack Freedman. This project
is an independent tool and is not an official Gridfinity or GitHub product.
Bundled libraries retain their own MIT notices; see
[third-party notices](../.github/extensions/gridfinity-builder/THIRD_PARTY_NOTICES.md).
