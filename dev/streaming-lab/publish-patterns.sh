#!/bin/sh
set -eu

RTSP_HOST="${RTSP_HOST:-mediamtx}"
RTSP_PORT="${RTSP_PORT:-8554}"
SOURCES="${SOURCES:-hama rtmp1 rtmp2 cam1 cam2 cam3 PiPGM1 PiPGM2}"
WIDTH="${WIDTH:-640}"
HEIGHT="${HEIGHT:-360}"
FPS="${FPS:-10}"

children=""

stop_children() {
  trap - INT TERM EXIT
  for pid in $children; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in $children; do
    wait "$pid" 2>/dev/null || true
  done
}
trap stop_children INT TERM EXIT

# Give MediaMTX time to start. FFmpeg is also restarted by Compose if this
# producer container exits, but the loop below retries initial connection.
sleep 2

for source in $SOURCES; do
  (
    while true; do
      echo "Publishing synthetic source '$source' to rtsp://$RTSP_HOST:$RTSP_PORT/$source"
      ffmpeg -hide_banner -loglevel warning -nostdin -re \
        -f lavfi -i "testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}" \
        -vf "drawtext=text='$source':x=20:y=20:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.65" \
        -an -c:v libx264 -preset ultrafast -tune zerolatency \
        -g "$((FPS * 2))" -pix_fmt yuv420p \
        -f rtsp -rtsp_transport tcp "rtsp://$RTSP_HOST:$RTSP_PORT/$source" || true
      echo "Source '$source' exited; retrying in 2 seconds"
      sleep 2
    done
  ) &
  children="$children $!"
done

wait
