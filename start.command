#!/bin/zsh
unsetopt BG_NICE
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  print "Resona needs Node.js."
  read
  exit 1
fi
resona_url="http://127.0.0.1:4178"
if /usr/bin/curl -fsS --max-time 1 "$resona_url" 2>/dev/null | /usr/bin/grep -q 'resona · the shape of sound'; then
  open "$resona_url"
  exit 0
fi
node server.js &
resona_pid=$!
trap 'kill "$resona_pid" 2>/dev/null' EXIT INT TERM
for resona_attempt in {1..50}; do
  if /usr/bin/curl -fsS --max-time 1 "$resona_url" 2>/dev/null | /usr/bin/grep -q 'resona · the shape of sound'; then
    open "$resona_url"
    wait "$resona_pid"
    exit $?
  fi
  if ! kill -0 "$resona_pid" 2>/dev/null; then
    wait "$resona_pid"
    exit $?
  fi
  sleep 0.1
done
print "The server did not respond. See the message above."
read
