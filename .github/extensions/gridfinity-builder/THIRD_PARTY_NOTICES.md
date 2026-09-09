# Third-party notices

This extension includes a bundled runtime dependency.

## Included in `vendor/three.mjs`

### three.js core and OrbitControls

- Package: `three`
- Version: `0.185.1`
- Source: <https://www.npmjs.com/package/three>
- Upstream project: <https://threejs.org/>
- License: MIT

The bundled module contains code from the three.js core package and `examples/jsm/controls/OrbitControls.js`. The corresponding license text is included in:

- `vendor/three.LICENSE.txt`

## Build-time tooling

### esbuild

- Package: `esbuild`
- Version: `0.28.2`
- Source: <https://www.npmjs.com/package/esbuild>
- License: MIT

`esbuild` is used only to generate the bundled vendor module during development and is not shipped as part of the extension runtime.
