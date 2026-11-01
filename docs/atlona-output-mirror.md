# Atlona AT-UHD-PRO3-44M: output 5 mirrors output 4

Found 2026-11-01. Routing to Atlona output 5 had no effect: the HDMI output (5) was mirroring the HDBaseT output (4), so the ATEM feed followed output 4. We now use **output 4** as the videomixer / ATEM feed (AMX bridge v11, pigateway #14, pimatrix #45). Output 5 follows it while the mirror is on.

## Turning the mirror off

Nobody has done this on the real unit yet. What is known, and from where:

- **WebGUI (not verified on our unit):** Atlona help article KB01545, "How to Independently Route to HDMI Outputs on the AT-UHD-PRO3 Matrices" (https://support.atlona.com/hc/en-us/articles/360014650213). A search summary of it says: open the matrix web interface, go to the Configuration > I/O tab, and set the HDMI output's Mirror Mode from On to Off. After that the HDMI output can take its own input. The article itself could not be fetched from this Pi (HTTP 403), so confirm the exact menu names on the unit.
- **Control interface (verified in the openHAB Atlona binding docs, https://v40.openhab.org/addons/bindings/atlona):** for `pro3-44m` there are two settings for HDMI port 5: `mirror5#portmirrorenabled` (enable or disable mirroring) and `mirror5#portmirror` (which output port to mirror when enabled). That shows the setting exists on this model. It does not show the command syntax.

## Before turning it off

- The AMX only knows outputs 1 to 5 through its own routing. Check how the NetLinx code handles output 5 once the mirror is off (v11 sends videomixer routes to output 4 and treats a route to 5 as an update of its own record only).
- With the mirror off, output 5 would need its own route. Anything that expects output 5 to follow output 4 stops working.
- Keep the ATEM input fed by the Hama off air: the Hama is fed from an ATEM output.
