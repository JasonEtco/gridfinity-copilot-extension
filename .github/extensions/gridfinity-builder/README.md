# Gridfinity Builder

Open the `gridfinity-builder` canvas with `{ "designId": "my-drawer" }`.
Use a separate design ID for each drawer. Ask Copilot to open the canvas, then
use the direct controls, the **3D model** viewer, or ask Copilot in the session
chat to edit the design through its canvas actions.

Use **Layout** to arrange or resize the current grid, **New bin** to create
and place a bin, and **New grid** to fit standard 42 mm cells to a drawer.
Both creation tabs have live 3D previews. Bin options include wall/floor
thickness, compartments, solid fill, stacking lips, labels, scoops, and mounting
holes. Grid controls include nine alignments, custom offsets, solid-floor/open-frame
plates, and highlighted excess. Excess can remain empty, export as separate
spacers, or form an integrated solid border.
The layout fits a compact preview; Zoom and Fit grid change only the view.
With Use drawer dimensions checked, Columns and Rows are disabled. Editing
drawer width, depth, or clearance recalculates the grid and spacers and saves
valid changes automatically. Uncheck it to set cell counts manually.
Bin and layout inspector fields save valid edits automatically after a short
typing pause. Invalid changes keep the saved geometry and show an error.
Use Reset fields to discard invalid or conflicting edits.
To start a new bin from an existing one, select **Use as new** in the
inspector, or double-click or right-click the bin in the top view, bin list, or
3D model viewer. This opens **New bin** with size, color, and construction
settings copied. Photo recesses are not copied into the draft.

The layout size and rulers use grid cells. Drawer dimensions accept cm or mm:
20 cm by 20 cm becomes 4 by 4 cells plus 15.5 mm edge spacers at the default
0.5 mm clearance. New designs use the IKEA ALEX five-drawer preset: approximately
29.2 by 52.4 cm inside, producing 6 by 12 cells. Measure your own drawer;
ALEX variants differ. Saved designs keep their existing dimensions.

There is no embedded chat composer. The extension remains steerable through
`get_state`, `apply_edits`, `import_layout`, and `export_design`. Edits require
the current revision and reject the whole batch if any final geometry is invalid.
The extension does not grant tool permissions or use a separate AI endpoint.

Designs save automatically under
`$COPILOT_HOME/extensions/gridfinity-builder/artifacts/<designId>.json`.
`COPILOT_HOME` defaults to `~/.copilot`. Keep this folder when updating.
Use JSON export for backups. Import replaces contents, not the design ID.

Select a bin and choose **Fit item from photo**. Upload a top-down JPEG, PNG,
or WebP photo, trace the item with outline points, and enter the item's measured
width, recess depth, and clearance. The result is a solid bin with a
constant-depth item recess. This is not a 3D scan; photo perspective and your
measurements affect the fit. Photos are resized, re-encoded, and saved inside
the design JSON (4 MiB maximum). Copilot state responses omit the photo bytes.

OpenSCAD exports are **experimental editable geometry**, not certified
print-ready files. They use a 42 mm pitch and 7 mm height units. Bins have
rounded walls and repeated feet. Plates have sockets over a solid floor.
Specialty vase/cylinder bins, baseplate mounting holes, connectors, and automatic
printer-bed splitting are not included.
The 3D preview supports orbit, zoom, and inspection, but is not a certified
print mesh. Render the SCAD and print a fit sample before printing a full design.

**Export STL** uses a local OpenSCAD installation. **Open in Bambu** also
requires Bambu Studio and opens the rendered STL for review; it never starts
a print. Click **Refresh apps** after installing these applications.
Rendered files are kept in the user-owned `artifacts/exports/` folder.

For installation, dimensions, sources, action examples, development, and limits,
see the [project documentation](https://github.com/JasonEtco/gridfinity-copilot-extension#readme).

MIT license; see [LICENSE](LICENSE).
