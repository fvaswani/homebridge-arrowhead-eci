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

## PIN field

HOOBS 5.1.8 ignores the schema's `format: password` when choosing its input
widget. The current source also sets `x-schema-form.type: password`, verified
as an HTML password input in the running form. This fix is not in the existing
alpha.2 release tarball. Masking protects the displayed field; it does not
change how the PIN is stored or transmitted.

Enter the PIN privately in the visual editor, keep controls disabled, and save
before arranging a supervised control test. Avoid the advanced JSON editor
while screen sharing because it shows configured secrets as text.
