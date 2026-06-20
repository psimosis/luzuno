#!/bin/sh
set -eu

mkdir -p "$CHROME_PROFILE_DIR"
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
rm -f "$CHROME_PROFILE_DIR"/SingletonCookie "$CHROME_PROFILE_DIR"/SingletonLock "$CHROME_PROFILE_DIR"/SingletonSocket

cleanup() {
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
  rm -f "$CHROME_PROFILE_DIR"/SingletonCookie "$CHROME_PROFILE_DIR"/SingletonLock "$CHROME_PROFILE_DIR"/SingletonSocket
}
trap cleanup EXIT INT TERM

Xvfb :99 -screen 0 1366x768x24 -ac +extension RANDR &
sleep 1
pulseaudio --daemonize=yes --exit-idle-time=-1 || true
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

exec chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-setuid-sandbox \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --user-data-dir="$CHROME_PROFILE_DIR" \
  --window-size=1366,768 \
  about:blank
