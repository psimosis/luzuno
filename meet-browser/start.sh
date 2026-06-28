#!/bin/sh
set -eu

MEET_PROFILE_DIR="${MEET_PROFILE_DIR:-/data/chrome-profile}"
SOFIA_PROFILE_DIR="${SOFIA_PROFILE_DIR:-/data/sofia-profile}"
SOFIA_SOURCE_URL="${SOFIA_SOURCE_URL:-http://meet-bridge-sofia:3200/sofia-source}"
VIRTUAL_CAMERA_DEVICE="${VIRTUAL_CAMERA_DEVICE:-/dev/video10}"
ENABLE_VIRTUAL_CAMERA="${ENABLE_VIRTUAL_CAMERA:-0}"
PULSE_SOCKET_DIR="${PULSE_SOCKET_DIR:-/tmp/luzuno-pulse}"
PULSE_SERVER="unix:${PULSE_SOCKET_DIR}/native"
export PULSE_SERVER
export PULSE_LATENCY_MSEC="${PULSE_LATENCY_MSEC:-200}"

mkdir -p "$MEET_PROFILE_DIR" "$SOFIA_PROFILE_DIR" "$PULSE_SOCKET_DIR"
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/.X100-lock /tmp/.X11-unix/X100
rm -f "${PULSE_SOCKET_DIR}/native"
rm -f "$MEET_PROFILE_DIR"/SingletonCookie "$MEET_PROFILE_DIR"/SingletonLock "$MEET_PROFILE_DIR"/SingletonSocket
rm -f "$SOFIA_PROFILE_DIR"/SingletonCookie "$SOFIA_PROFILE_DIR"/SingletonLock "$SOFIA_PROFILE_DIR"/SingletonSocket

cleanup() {
  if [ -n "${pulse_supervisor_pid:-}" ]; then
    kill "$pulse_supervisor_pid" >/dev/null 2>&1 || true
  fi
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/.X100-lock /tmp/.X11-unix/X100
  rm -f "$MEET_PROFILE_DIR"/SingletonCookie "$MEET_PROFILE_DIR"/SingletonLock "$MEET_PROFILE_DIR"/SingletonSocket
  rm -f "$SOFIA_PROFILE_DIR"/SingletonCookie "$SOFIA_PROFILE_DIR"/SingletonLock "$SOFIA_PROFILE_DIR"/SingletonSocket
}
trap cleanup EXIT INT TERM

Xvfb :99 -screen 0 1024x576x24 -ac +extension RANDR &
Xvfb :100 -screen 0 480x270x24 -ac +extension RANDR &
sleep 1
cat >/tmp/luzuno-pulse.pa <<'PA'
.fail
load-module module-native-protocol-unix auth-anonymous=1 socket=/tmp/luzuno-pulse/native
load-module module-null-sink sink_name=meet_sink rate=48000 channels=1 channel_map=mono sink_properties=device.description=Meet_Output
load-module module-null-sink sink_name=sofia_sink rate=48000 channels=1 channel_map=mono sink_properties=device.description=Sofia_Output
load-module module-remap-source source_name=meet_audio_source master=meet_sink.monitor channels=1 channel_map=mono source_properties=device.description=Meet_Audio_For_Sofia
load-module module-remap-source source_name=sofia_audio_source master=sofia_sink.monitor channels=1 channel_map=mono source_properties=device.description=Sofia_Audio_For_Meet
set-default-sink meet_sink
set-default-source sofia_audio_source
PA
(
  while true; do
    rm -f "${PULSE_SOCKET_DIR}/native"
    pulseaudio -nF /tmp/luzuno-pulse.pa --daemonize=no --exit-idle-time=-1 --log-target=stderr
    echo "PulseAudio exited; restarting in 1s." >&2
    sleep 1
  done
) &
pulse_supervisor_pid=$!
for i in $(seq 1 50); do
  if PULSE_SERVER="$PULSE_SERVER" pactl info >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$pulse_supervisor_pid" >/dev/null 2>&1; then
    echo "PulseAudio exited before becoming ready." >&2
    exit 1
  fi
  sleep 0.1
done
PULSE_SERVER="$PULSE_SERVER" pactl info >/dev/null 2>&1

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

def forward_client(client, upstream_port):
    upstream = socket.create_connection(("127.0.0.1", upstream_port))
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
                    rewritten.append(f"Host: 127.0.0.1:{upstream_port}".encode())
                else:
                    rewritten.append(line)
            upstream.sendall(b"\r\n".join(rewritten) + separator + body)
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        pipe(upstream, client)
    except Exception:
        client.close()
        upstream.close()

def serve(listen_port, upstream_port):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", listen_port))
    server.listen(20)
    while True:
        client, _ = server.accept()
        threading.Thread(target=forward_client, args=(client, upstream_port), daemon=True).start()

threading.Thread(target=serve, args=(9223, 9222), daemon=True).start()
serve(9225, 9224)
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
    DISPLAY=:100 PULSE_SINK=sofia_sink PULSE_SOURCE=meet_audio_source PULSE_SERVER="$PULSE_SERVER" PULSE_LATENCY_MSEC="$PULSE_LATENCY_MSEC" chromium \
      --no-sandbox \
      --disable-dev-shm-usage \
      --disable-gpu \
      --disable-setuid-sandbox \
      --disable-session-crashed-bubble \
      --disable-infobars \
      --noerrdialogs \
      --autoplay-policy=no-user-gesture-required \
      --use-fake-ui-for-media-stream \
      --unsafely-treat-insecure-origin-as-secure=http://meet-bridge-sofia:3200 \
      --remote-debugging-address=0.0.0.0 \
      --remote-debugging-port=9224 \
      --remote-allow-origins=* \
      --user-data-dir="$SOFIA_PROFILE_DIR" \
      --window-size=480,270 \
      "$SOFIA_SOURCE_URL"
  ) &

  if [ -e "$VIRTUAL_CAMERA_DEVICE" ]; then
    ffmpeg -loglevel warning -f x11grab -framerate 10 -video_size 480x270 -i :100 \
      -vf format=yuv420p -f v4l2 "$VIRTUAL_CAMERA_DEVICE" &
    sleep 4
  else
    echo "Virtual camera device $VIRTUAL_CAMERA_DEVICE not found; Meet video will not be available." >&2
  fi
fi

env PULSE_SINK=meet_sink PULSE_SOURCE=sofia_audio_source PULSE_SERVER="$PULSE_SERVER" PULSE_LATENCY_MSEC="$PULSE_LATENCY_MSEC" chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-setuid-sandbox \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --noerrdialogs \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --unsafely-treat-insecure-origin-as-secure=https://meet.google.com,http://meet-bridge-sofia:3200 \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --user-data-dir="$MEET_PROFILE_DIR" \
  --window-size=1024,576 \
  about:blank &
chrome_pid=$!
wait "$chrome_pid"
