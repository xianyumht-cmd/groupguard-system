# Resource recovery notes

## Extraction outputs

| output | purpose |
| --- | --- |
| `resource_classification.json` | Raw resource classification for all four DLLs. |
| `RESOURCE_CLASSIFICATION.md` | Human-readable resource classification table. |
| `viewable/` | Converted DIB bitmaps and WAVE resources for direct inspection. |

## Resource conclusion

The four DLLs contain mostly small UI/control resources:

| module | resources | finding |
| --- | ---: | --- |
| core | 68 | Small bitmaps/icons/cursors/dialog/menu/string resources, one WAVE. |
| master_servant | 58 | Small bitmaps/icons/dialog/menu/string resources; no obvious large gameplay image template. |
| light_entertainment | 60 | Small bitmaps/icons plus one WAVE; gameplay uses QQ BigFace payload for `猜拳`. |
| racing | 69 | Small bitmaps/icons plus one WAVE; no embedded full car/track image set found in resources. |

## Viewable dimensions

Most recovered bitmaps are tiny:

- `20x20`, `33x11`, `39x13`, `64x15`, `70x39`: likely VCL/UI editor/control assets.
- Icon DIBs: `16x32`, `32x64`, `48x96`, `128x256`: icon images include mask/double-height icon data.
- WAVE resources: about `5192` bytes each, likely bundled UI sound rather than gameplay asset.

## Racing asset implication

The racing DLL advertises image/animation gameplay, but current resource extraction does not show a large embedded car/track asset pack. Static evidence points to external assets/config:

| evidence | implication |
| --- | --- |
| `\皮肤图片` path | Car skins are likely loaded from external files. |
| `Skinprice.ini` | Skin options/prices are data-driven. |
| `price.ini`, `LVprice.ini`, `PVPprice.ini` | Shop, upgrade and PVP costs are config-driven. |
| Handler strings `皮肤`, `名称`, `资产`, `出战` | Runtime builds gameplay state from player/config files. |

## Next resource work

1. Decode default embedded INI text blobs referenced by `racing_init_storage_config`, especially `LVprice.ini`, `price.ini`, `PVPprice.ini`, `Skinprice.ini`.
2. Search filesystem/runtime paths for external `SUB-F-竞速赛车` or `皮肤图片` directories if the user provides an old runtime data folder.
3. Link bitmap/icon resources to functions only if GDI+/resource-load calls reference their ids; current evidence suggests they are mostly UI shell resources.

