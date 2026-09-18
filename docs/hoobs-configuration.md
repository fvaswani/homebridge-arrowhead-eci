# HOOBS configuration notes

Verified on HOOBS 5.1.8, 16 September 2026.

## Blank plugin page after manual installation

The HOOBS client requests catalogue metadata before requesting the installed
plugin schema. For this unlisted plugin, missing metadata prevents the schema
request, leaving just the Plugin Configuration heading. The local backend can
still return the complete schema, and the alarm bridge can continue working.

The pilot installation uses a local, Arrowhead-only fallback in the HOOBS client
bundle to supply public package metadata when the catalogue entry is absent.
The original bundle was backed up. No alarm settings or other bridge processes
were changed. This is a local workaround, not a fix delivered by the plugin
package, and a HOOBS update can overwrite it. There is no general-purpose HOOBS
installer or supported automatic client patch in this project.

## Local plug-in icon

On 18 September 2026, the pilot's HOOBS 5.1.8 web client received the project's
shield-and-arrowhead artwork. The image is served locally as
`/arrowhead-eci-icon.png` from `/usr/lib/hoobsd/static/`. The existing
Arrowhead-only metadata fallback was preserved and extended with the icon.
Scoped changes in `/usr/lib/hoobsd/static/main.js` display it on the plug-in
card, the bridge's installed-plugin list, the configuration header, and the
fallback details content. Other plugins retain their existing icons.

This is a local presentation workaround, not a HOOBS catalogue registration.
A HOOBS update can replace it. No bridge restart is required. The SVG source
and PNG are retained under `assets/` in this repository and in the alpha.3 package.

The pre-icon client bundle is backed up under the pilot's
`/var/lib/hoobs/backups/arrowhead-icon-20260918-234031/` directory.
To roll back, restore its `main.js` to `/usr/lib/hoobsd/static/main.js`, remove
`/usr/lib/hoobsd/static/arrowhead-eci-icon.png`, and refresh the browser.

The installed package at
`/var/lib/hoobs/arrowheadalarmbridge/node_modules/homebridge-arrowhead-eci/`
also received `assets/icon.svg`, `assets/icon.png`, and an image prefix in its
schema's `headerDisplay`. No other schema fields were changed. Its previous
schema is backed up as `plugin-config.schema.json` in the same backup directory.
To undo these package-only additions, restore that schema and remove the two
new assets. Alarm configuration and runtime JavaScript were not changed.

## PIN field

HOOBS 5.1.8 ignores the schema's `format: password` when choosing its input
widget. Alpha.3 also sets `x-schema-form.type: password`, verified
as an HTML password input in the running pilot's form. This fix is absent from
the older alpha.2 release tarball. Masking protects the displayed field; it does not
change how the PIN is stored or transmitted.

Enter the PIN privately in the visual editor, keep controls disabled, and save
before arranging a supervised control test. Avoid the advanced JSON editor
while screen sharing because it shows configured secrets as text.
