# GeoLint — GIS Geometry Inspector

GeoLint checks 2D GeoJSON and Shapefile geometry in your browser. File reading, ZIP extraction, and geometry calculations run locally in a Web Worker. Review findings and export CSV or JSON reports without changing your source data.

[Try GeoLint](https://geolint.app/) · [Help](https://geolint.app/help.html) · [Rules](https://geolint.app/rules.html) · [Report an issue](https://github.com/figwood/geolint/issues)

GeoLint is a development preview. A passing inspection covers the selected rules; it does not establish that a dataset meets every GIS or business requirement.

## Features

- Read GeoJSON Features, FeatureCollections, and all seven geometry types, including nested GeometryCollections.
- Open standalone 2D `.shp` files or ZIP archives containing one Shapefile layer, with matching DBF / CPG files when available.
- Check geometry validity with GEOS, plus optional duplicate, line-connectivity, overlap, enclosed-gap, and parameterized geometry rules.
- Filter findings, locate source records, and export reports with rule selections and coverage. Cancelled or incomplete runs cannot be exported as completed reports.

Open the website and select a file, or try the built-in sample. The [sample data](sample_data/README.md) includes synthetic examples for exploring the rules.

## Run locally

Requires Node.js 24+, npm, and Python 3.12+.

```sh
git clone https://github.com/figwood/geolint.git
cd geolint
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. `dev` builds the site before serving it. Workers and modules require HTTP(S); opening files through `file://` will not work.

## Limits and privacy

Calculations use planar x/y coordinates in the input's coordinate units. GeoLint does not check or transform the CRS, reproject geometry, or repair data. Empty geometry, Z/M coordinates, and MultiPatch records are skipped; malformed inputs are reported or rejected. ZIP archives must contain exactly one SHP layer; encryption, split archives, and ZIP64 are unsupported.

There is no fixed file-size limit, but browser memory and inspection budgets limit practical capacity. Complex or large datasets may need fewer optional rules or smaller inputs. Splitting data changes coverage of relationships between features. Rules use their documented semantics; validity alone does not establish network correctness, and results may differ from other GIS tools.

Inspection does not upload your geometry or save files/results in browser storage. Site assets and the public sample load from the hosting origin. Reports may contain file names, IDs, coordinates and finding geometry, so handle them with the same care as the input. Hosting logs, deployment-specific analytics, and browser extensions depend on your environment.

GeoPackage, multi-layer archives, cross-layer topology, URL import, and map editing are unsupported. JavaScript, WebAssembly, and Web Workers are required. See the [Help](https://geolint.app/help.html) and [Rules](https://geolint.app/rules.html) pages for input details and rule behavior.

## Build and self-host

```sh
npm run release
npm run preview
```

The release command prepares validation dependencies, rebuilds the engine with pinned Emscripten 3.1.73, includes corresponding source and notices, and stops unless all required checks pass. It needs network access, Git, CMake, a C/C++ compiler, make, and a supported SDK/QGIS platform. Linux CI can run the “Build verified release candidate” workflow.

Deploy the complete verified `dist/` directory, preserving its engine, source-download, license, and sample assets. Set the public URL when building for another host or subpath:

```sh
SITE_URL=https://example.com/geolint/ npm run release
```

Use `SITE_URL= npm run release` to omit absolute SEO URLs and the sitemap. `npm run build` remains a development preview build and does not produce a verified release. Cloudflare configuration is optional; any static host that serves the required modules, Worker, and WASM assets can host the build.

## Contributing

Issues and pull requests are welcome. Include selected rules, parameters, browser/OS versions, expected and actual results, and a minimal synthetic example. Keep private geometry and unredacted reports out of public issues.

```sh
npm test
npm run typecheck
npm run build
npm run test:engine
```

Browser checks use `npx playwright install chromium` followed by `npm run test:e2e` after building. Changes to inspection rules also need independent validation through `bash validation/test-all.sh`, which requires compatible QGIS. Report unavailable checks explicitly. Keep code, comments, and public documentation in English.

## License

GeoLint is [MIT licensed](LICENSE). Bundled components retain their own licenses; see the [third-party notices and source information](public/licenses/THIRD-PARTY-NOTICES.md).
