# SUB Gameplay Resource Integration

## Source

Resources were imported from `D:/project2/unpackage/recovered`.

Imported resource groups:

- `core`: raw DLL resources and viewable converted resources
- `master_servant`: raw DLL resources and viewable converted resources
- `light_entertainment`: raw DLL resources, viewable converted resources, and selected gameplay PNGs
- `racing`: raw DLL resources and viewable converted resources
- `shared`: recovered resource classification, viewable manifest, recovery notes and text-pack documents

Current manifest coverage:

- 352 total entries
- 255 raw DLL resource blobs
- 80 viewable converted resources, including the viewable README
- 12 selected light-entertainment PNGs
- 5 root/shared recovery documents

The plugin-local resource root is:

`resources/sub-gameplay`

The build copies this folder to:

`dist/resources/sub-gameplay`

Regenerate the manifest after replacing resources:

`npm run resources:sub-gameplay`

Verify source coverage, manifest consistency and built SnowLuma resource copy:

`npm run verify:sub-gameplay-resources`

Verify the SnowLuma WebUI resource tab wiring and resource filters:

`npm run verify:sub-gameplay-webui`

Manifest entries include stable `resourceId` values. Use these ids for future command-to-resource mappings instead of hard-coded relative paths.

Every manifest entry also includes:

- `sourcePath`: the original recovered file under `D:/project2/unpackage/recovered`
- `sourceRelation`: `direct` when the plugin file is copied from the source file, or `converted` when a viewable asset was generated from a raw DLL resource

## Runtime Wiring

Runtime lookup is implemented by `src/services/sub_gameplay_resources.ts`.

Current command-level usage:

- `SUB` light entertainment `rps`: can send selected RPS hand images and outcome icon.
- `SUB` light entertainment `dice`: can send selected dice-face images.
- `SUB` light entertainment `number`: remains text-only because recovered notes identify it as text-rendered.
- `SUB` master-servant commands: can attach the module representative recovered image when `resourceMode=all`.
- `SUB` racing commands: can attach the module representative recovered image when `resourceMode=all`.

Runtime resource visibility:

- `/sub-gameplay/overview` includes `importedResources.summary` and sample entries.
- `/sub-gameplay/resources?module=light_entertainment&limit=100` lists imported resources from the manifest.
- The resources endpoint supports `q=` search over `resourceId`, path, semantic key, source path, media type and collection.
- The resources endpoint also supports `collection=` (`raw`, `viewable`, `selected`, `root`), `mediaType=` (`image`, `audio`, `document`, `binary`) and `sourceRelation=` (`direct`, `converted`) filters.
- Resource list responses include `integrity`, which checks the deployed resource root against the manifest and reports missing, duplicate or unindexed files.
- SnowLuma WebUI injects a `SUB资源` tab that lists manifest statistics and resource rows.
- The SnowLuma resource tab can filter by module, collection, media type, source relation and search text, shows deployed resource integrity/source-trace status, and links every listed resource to the protected file endpoint.
- The resource table exposes `sourceRelation` per row so operators can distinguish direct copied resources from converted viewable assets.
- SnowLuma WebUI APIs:
  - `/api/sub-gameplay/resources?module=light_entertainment&collection=selected&mediaType=image&sourceRelation=direct&limit=100&q=rps`
  - `/api/sub-gameplay/resource-file?id=sub.light_entertainment.rps_win`

The file endpoint is path-normalized through the resource service and only serves files under the imported resource root.

Resource sending is controlled by `subGameplay.resourceMode`:

- `off`: text-only, default
- `light`: enable selected light-entertainment images
- `all`: allow all resource-backed modules as mappings are added

## Remaining Mapping Work

All four DLL resource sets are now present in the plugin and deployable. Light entertainment has semantic image mapping for specific commands. Master-servant and racing currently use representative module images in `resourceMode=all` until deeper command-to-resource semantic mapping is recovered.

Remaining work toward full parity:

- Map `master_servant` viewable/raw resources to contract/profile/rank scenes where meaningful.
- Map `racing` viewable/raw resources to garage/shop/race scenes where meaningful.
- Decide whether core resources are only UI/system artifacts or should be exposed to gameplay output.
- Add per-module image-send policy controls beyond the current global `subGameplay.resourceMode`.
