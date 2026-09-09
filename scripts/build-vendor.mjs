import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import esbuild from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, ".github/extensions/gridfinity-builder/vendor");
const licensePath = join(root, "node_modules/three/LICENSE");
const outFile = join(outdir, "three.mjs");
const outLicense = join(outdir, "three.LICENSE.txt");
const license = await readFile(licensePath, "utf8");

await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "scripts/three-entry.mjs")],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  banner: {
    js: `/*!
 * Bundled vendor module for the Gridfinity viewer.
 * Includes three.js core and OrbitControls from the three.js examples.
 * Copyright © 2010-2026 three.js authors
 * SPDX-License-Identifier: MIT
 * Full license: ./three.LICENSE.txt
 */`,
  },
});

await writeFile(outLicense, license);
