# AMX <-> PiMatrix TCP protocol

ASCII, each message ends with `;` (CR/LF after it is ignored), fields are separated by `:`. A request may start with a message id (`r7:CAM:cam1:POWER:ON;`), which the reply repeats (`r7:CAM:OK:cam1:POWER:ON;`). The same text is kept in `keskuskirkko` (docs/pimatrix-protocol.md).

Both sides poll the other every 2 seconds. Ports: PiMatrix listens on 6600 (`PIMATRIX_AMX_TCP_PORT`), AMX listens on 6501 (`PIMATRIX_AMX_MASTER_PORT`). AMX at 192.168.1.10 is the client of PiMatrix and PiMatrix is the client of AMX.

## AMX asks PiMatrix (PiMatrix listens)

| Request | Reply |
|---|---|
| `PING;` | `PONG;` |
| `STATUS:ALL;` | `STATUS:ALL:<key=value,...>;` keys: `mode`, `hdmi0`, `hdmi0state`, `hdmi1`, `hdmi1state`, `multiviewstate`, `cam<n>pwr` (`on`/`standby`/`unknown`, last command), `cam<n>link`, `atlona` (`o1/o2/o3/o4/o5` input per output, 0 unknown), `program` |
| `OUTPUT:SET:<hdmi0\|hdmi1>:<sourceId\|none>;` | `OUTPUT:OK:<outputId>:<sourceId\|none>;` |
| `OUTPUT:LIST;`, `SOURCE:LIST;`, `SOURCE:GET:<id>;` | see README |
| `QUICK:LIST;` | `QUICK:LIST:<n>=<name>,...;` |
| `QUICK:RUN:<n>;` | `QUICK:OK:<n>;` or `ERR:QUICK_NOT_FOUND:<n>;` |
| `CAM:LIST;` | `CAM:LIST:cam1=<power>/<link>,...;` |
| `CAM:<id\|ALL>:POWER:ON\|OFF;` | `CAM:OK:<id>:POWER:ON\|OFF;` |
| `CAM:<id>:PRESET:<0-254>;`, `CAM:<id>:SAVE:<n>;` | `CAM:OK:<id>:PRESET\|SAVE:<n>;` |
| `CAM:<id>:MOVE:<UP\|DOWN\|LEFT\|RIGHT\|UPLEFT\|UPRIGHT\|DOWNLEFT\|DOWNRIGHT\|STOP\|HOME>;` | `CAM:OK:<id>:MOVE:<dir>;` |
| `CAM:<id>:ZOOM:<IN\|OUT\|STOP>;` | `CAM:OK:<id>:ZOOM:<action>;` |
| `PROGRAM:ON\|OFF\|STATUS;` | `PROGRAM:OK:ON\|OFF;` / `PROGRAM:STATUS:ON\|OFF;` or `ERR:PROGRAM_UNAVAILABLE;` |

`<id>` is `cam1` or `cam2` (`1`/`2` also work). Errors are `ERR:<CODE>[:<detail>];`.

Quick options have a number (1-99) set when saving (`POST /api/v1/quick-options` with `number`, otherwise the lowest free one); options saved before this get numbers in saved order.

## PiMatrix asks AMX (AMX listens)

| Request | Reply |
|---|---|
| `PING;` | `PONG;` |
| `DEV:VERSION;` | `DEV:VERSION:<n>;` |
| `ATLONA:ROUTE:<reqId>:<in>:<out>;` | `ATLONA:CONFIRMED:<reqId>:<in>:<out>;` or `ATLONA:ERR:<reqId>:<reason>;` |
| `ATLONA:STATUS:<reqId>;` | `ATLONA:STATUS:<reqId>:<o1>,<o2>,<o3>,<o4>,<o5>;` (input per output, 0 unknown) |

AMX remains the only controller of the Atlona matrix.

Atlona inputs: 1 Lukupulpetti, 2 Rack PC, 3 Pi 1, 4 Pi 2. Outputs: 1 Proj1, 2 Proj2, 3 Screen3, 4 Screen4, 5 Videomixer (2026-10-26; the current AT-UHD-PRO3-44M has only four outputs, so outputs 3-5 assume a larger matrix).

## Not verified

Written against simulation and unit tests only. Nothing has run against the real AMX master, the cameras or piprogram.
