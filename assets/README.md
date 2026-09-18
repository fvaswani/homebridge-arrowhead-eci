# Plug-in artwork

`icon.svg` is the editable 512 x 512 source; `icon.png` is the matching PNG for
README rendering and interfaces that need a raster image. Both use the project's
MIT license. This is original community-project artwork, not an official
Arrowhead, Homebridge, or HOOBS logo or certification badge.

To regenerate the PNG with ImageMagick:

```sh
magick -background none assets/icon.svg -strip assets/icon.png
```

The README and Homebridge settings header use the image hosted in this
repository. Both assets are included in the npm package. A package asset alone
does not register an icon in either platform's catalogue.

Homebridge manages tile artwork through its
[verified plugin icon process](https://github.com/homebridge/plugins).
For the pilot installation's local HOOBS artwork, see
[HOOBS configuration notes](../docs/hoobs-configuration.md).
