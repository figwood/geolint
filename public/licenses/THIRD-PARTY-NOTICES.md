# Third-party notices and source information

GeoLint's own code is covered by the MIT License distributed at `../LICENSE.txt`. Components listed below retain their original copyright notices and license terms.

## geos-wasm 3.1.1 and GEOS 3.13.0

The engine is distributed unmodified as `../vendor/geos/geos.esm.js` and is loaded separately from GeoLint's application modules.

The geos-wasm 3.1.1 upstream `package.json` declares `LGPL-3.0-or-later`, while its `LICENSE.md` contains LGPL 2.1. This difference is present in the upstream source revision, not introduced by GeoLint. The original license text and the LGPL 3 / GPL 3 terms referenced by the package metadata are provided without changing either upstream statement:

- [Original geos-wasm license](geos-wasm-LICENSE.txt)
- [LGPL 3.0 or later](LGPL-3.0-or-later.txt)
- [GPL 3.0 or later](GPL-3.0-or-later.txt)
- [GEOS 3.13.0 COPYING](GEOS-COPYING.txt)

The installed engine matches the upstream binary at commit [`82e49f9ba1849a004bf31fc1c1be2ff918889586`](https://github.com/chrispahm/geos-wasm/tree/82e49f9ba1849a004bf31fc1c1be2ff918889586). Both have Git blob SHA-1 `3e114eb4af4585d820c0b085fc64cbdef4dcc2f1` and a size of 2,578,331 bytes. The installed engine SHA-256 is `b04ef48ab717ad3653f7405a9b8733ee7d35b215c9def3f06ee393b67fc2e512`.

Upstream source and build information:

- [geos-wasm source archive for that commit](https://github.com/chrispahm/geos-wasm/archive/82e49f9ba1849a004bf31fc1c1be2ff918889586.tar.gz)
- [Makefile](https://github.com/chrispahm/geos-wasm/blob/82e49f9ba1849a004bf31fc1c1be2ff918889586/Makefile), [export configuration](https://github.com/chrispahm/geos-wasm/blob/82e49f9ba1849a004bf31fc1c1be2ff918889586/GEOS_EMCC_FLAGS.mk), and [JavaScript bundling configuration](https://github.com/chrispahm/geos-wasm/blob/82e49f9ba1849a004bf31fc1c1be2ff918889586/rollup.config.js)
- [GEOS 3.13.0 source archive](https://download.osgeo.org/geos/geos-3.13.0.tar.bz2) and [source tree](https://github.com/libgeos/geos/tree/3.13.0)

These are upstream download locations. This site does not currently contain a complete corresponding-source bundle. The upstream commit does not pin the Emscripten SDK used to produce the prebuilt engine; no byte-for-byte rebuild is claimed. Providing additional license texts does not resolve the difference in upstream declarations.

You can replace the engine module in a local build while preserving its loader interface. The GeoLint application source is available at https://github.com/figwood/geolint. GeoLint imposes no additional restrictions on modification or reverse engineering for debugging library modifications.

## Components included in GEOS

GEOS 3.13.0 includes the following third-party components. Their original notices are supplied separately:

- JSON for Modern C++ 3.9.1, copyright Niels Lohmann, MIT: [license and copyright notice](GEOS-nlohmann-json-LICENSE.txt). [Upstream GEOS header](https://github.com/libgeos/geos/blob/3.13.0/include/geos/vend/json.hpp).
- Ryu, copyright 2018 Ulf Adams and contributors, Apache 2.0 or Boost 1.0: [source copyright and license header](GEOS-ryu-COPYRIGHT.txt), [upstream license statement](GEOS-ryu-LICENSE.txt), [Apache 2.0](GEOS-ryu-Apache2.txt), and [Boost 1.0](GEOS-ryu-Boost.txt). [Upstream GEOS sources](https://github.com/libgeos/geos/tree/3.13.0/src/deps/ryu).

The engine also contains generated Emscripten runtime code. The upstream SDK license is documented at https://emscripten.org/docs/introducing_emscripten/emscripten_license.html. Compiler and source provenance for the selected build is described above.

## fflate 0.8.3

ZIP decompression uses fflate under the MIT License. The installed package's full copyright and license text is distributed at `../vendor/fflate/LICENSE`.

Source: [fflate v0.8.3](https://github.com/101arrowz/fflate/tree/v0.8.3) and its [source archive](https://github.com/101arrowz/fflate/archive/refs/tags/v0.8.3.tar.gz). The installed license and package metadata match that upstream version. Exact npm versions and package integrity values are recorded in GeoLint's `package-lock.json`.
