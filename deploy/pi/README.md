# Raspberry Pi HDMI output (hardware mode)

Verified on a Pi 4 (Debian 13): two ffplay processes cannot share the display via SDL `kmsdrm` (the second fails with `Could not queue pageflip: -13`, only one DRM master per card). A compositor owns the display instead and each player is a window on one output.

```sh
sudo apt install labwc seatd wlr-randr ffmpeg
sudo systemctl enable --now seatd
mkdir -p ~/.config/labwc && cp deploy/pi/labwc-rc.xml ~/.config/labwc/rc.xml
sudo cp deploy/pi/pimatrix-compositor.service /etc/systemd/system/
sudo systemctl enable --now pimatrix-compositor
```

pimatrix environment:

```dotenv
PIMATRIX_DISPLAY_MODE=hardware
PIMATRIX_HDMI_PLAYER=/path/to/pimatrix/deploy/pi/pimatrix-player
PIMATRIX_HDMI0_DEVICE=HDMI-A-1
PIMATRIX_HDMI1_DEVICE=HDMI-A-2
```

`pimatrix-player` overrides `PIMATRIX_HDMI_SDL_VIDEODRIVER`: it sets `SDL_VIDEODRIVER=wayland` itself, because the players are Wayland clients of the compositor, not `kmsdrm` processes.

The user running the compositor must be able to open `/dev/dri/card1` and `/run/seatd.sock` (group `video`). `card1` is the card with the HDMI connectors on a Pi 4; check `/sys/class/drm`. Which physical connector is `hdmi0`/`hdmi1` is set by `labwc-rc.xml`.

Cabling (re-plugged 2026-10-25): `hdmi0` (HDMI-A-1, red) feeds Atlona input 3 and `hdmi1` (HDMI-A-2, green) feeds Atlona input 4 at the Keskuskirkko install. The matrix outputs 1 and 2 are the left and right screens. See the keskuskirkko repo, `docs/hardware/pi-hdmi-cabling.md`.
