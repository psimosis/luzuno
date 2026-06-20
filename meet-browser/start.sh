#!/bin/sh
set -eu

MEET_PROFILE_DIR="${MEET_PROFILE_DIR:-/data/chrome-profile}"
SOFIA_PROFILE_DIR="${SOFIA_PROFILE_DIR:-/data/sofia-profile}"
SOFIA_SOURCE_URL="${SOFIA_SOURCE_URL:-http://meet-bridge-sofia:3200/sofia-source}"
VIRTUAL_CAMERA_DEVICE="${VIRTUAL_CAMERA_DEVICE:-/dev/video10}"
ENABLE_VIRTUAL_CAMERA="${ENABLE_VIRTUAL_CAMERA:-0}"

mkdir -p "$MEET_PROFILE_DIR" "$SOFIA_PROFILE_DIR"
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/.X100-lock /tmp/.X11-unix/X100
rm -f "$MEET_PROFILE_DIR"/SingletonCookie "$MEET_PROFILE_DIR"/SingletonLock "$MEET_PROFILE_DIR"/SingletonSocket
rm -f "$SOFIA_PROFILE_DIR"/SingletonCookie "$SOFIA_PROFILE_DIR"/SingletonLock "$SOFIA_PROFILE_DIR"/SingletonSocket

cleanup() {
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/.X100-lock /tmp/.X11-unix/X100
  rm -f "$MEET_PROFILE_DIR"/SingletonCookie "$MEET_PROFILE_DIR"/SingletonLock "$MEET_PROFILE_DIR"/SingletonSocket
  rm -f "$SOFIA_PROFILE_DIR"/SingletonCookie "$SOFIA_PROFILE_DIR"/SingletonLock "$SOFIA_PROFILE_DIR"/SingletonSocket
}
trap cleanup EXIT INT TERM

Xvfb :99 -screen 0 1366x768x24 -ac +extension RANDR &
Xvfb :100 -screen 0 720x480x24 -ac +extension RANDR &
sleep 1
cat >/tmp/luzuno-pulse.pa <<'PA'
.fail
load-module module-null-sink sink_name=meet_sink sink_properties=device.description=Meet_Output
load-module module-null-sink sink_name=sofia_sink sink_properties=device.description=Sofia_Output
load-module module-remap-source source_name=meet_audio_source master=meet_sink.monitor source_properties=device.description=Meet_Audio_For_Sofia
load-module module-remap-source source_name=sofia_audio_source master=sofia_sink.monitor source_properties=device.description=Sofia_Audio_For_Meet
set-default-sink meet_sink
set-default-source sofia_audio_source
PA
pulseaudio -nF /tmp/luzuno-pulse.pa --daemonize=yes --exit-idle-time=-1 --log-target=stderr || true

x11vnc -display :99 -forever -shared -rfbport 5901 -nopw &
websockify --web=/usr/share/novnc/ 7900 localhost:5901 &
python3 - <<'PY' &
import socket
import threading

def pipe(source, target):
    try:
        while True:
            data = source.recv(65536)
            if not data:
                break
            target.sendall(data)
    finally:
        source.close()
        target.close()

def forward_client(client):
    upstream = socket.create_connection(("127.0.0.1", 9222))
    try:
        first = b""
        while b"\r\n\r\n" not in first and len(first) < 65536:
            chunk = client.recv(4096)
            if not chunk:
                break
            first += chunk
        if first:
            headers, separator, body = first.partition(b"\r\n\r\n")
            rewritten = []
            for line in headers.split(b"\r\n"):
                if line.lower().startswith(b"host:"):
                    rewritten.append(b"Host: 127.0.0.1:9222")
                else:
                    rewritten.append(line)
            upstream.sendall(b"\r\n".join(rewritten) + separator + body)
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        pipe(upstream, client)
    except Exception:
        client.close()
        upstream.close()

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", 9223))
server.listen(20)
while True:
    client, _ = server.accept()
    threading.Thread(target=forward_client, args=(client,), daemon=True).start()
PY

if [ "$ENABLE_VIRTUAL_CAMERA" = "1" ]; then
  (
    until python3 - <<'PY'
import urllib.request
urllib.request.urlopen("http://meet-bridge-sofia:3200/health", timeout=2).read()
PY
    do
      sleep 2
    done
    DISPLAY=:100 PULSE_SINK=sofia_sink PULSE_SOURCE=meet_audio_source chromium \
      --no-sandbox \
      --disable-dev-shm-usage \
      --disable-gpu \
      --disable-setuid-sandbox \
      --autoplay-policy=no-user-gesture-required \
      --use-fake-ui-for-media-stream \
      --unsafely-treat-insecure-origin-as-secure=http://meet-bridge-sofia:3200 \
      --user-data-dir="$SOFIA_PROFILE_DIR" \
      --window-size=720,480 \
      "$SOFIA_SOURCE_URL"
  ) &

  if [ -e "$VIRTUAL_CAMERA_DEVICE" ]; then
    ffmpeg -loglevel warning -f x11grab -framerate 30 -video_size 720x480 -i :100 \
      -vf format=yuv420p -f v4l2 "$VIRTUAL_CAMERA_DEVICE" &
    sleep 4
  else
    echo "Virtual camera device $VIRTUAL_CAMERA_DEVICE not found; Meet video will not be available." >&2
  fi
fi

exec env PULSE_SINK=meet_sink PULSE_SOURCE=sofia_audio_source chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-setuid-sandbox \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --unsafely-treat-insecure-origin-as-secure=https://meet.google.com,http://meet-bridge-sofia:3200 \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --user-data-dir="$MEET_PROFILE_DIR" \
  --window-size=1366,768 \
  about:blank
