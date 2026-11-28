#!/bin/sh
# Tinkerlings for macOS and Linux, in one line:
#
#   curl -fsSL https://raw.githubusercontent.com/maidevberlin/tinkerlings/main/install.sh | sh
#
# Puts Tinkerlings and the Node it runs on into ~/.tinkerlings (nothing else on the computer is touched,
# and no admin rights are needed), then starts it and opens it in the browser. Run again, it
# updates Tinkerlings to the newest version and starts it. On a Mac, "Tinkerlings" on the desktop does
# the same with a double click.

set -eu

# (All in one function: the shell reads it whole before running any of it, also from a pipe.)
main() {
  REPO=maidevberlin/tinkerlings
  PORT=${PORT:-8765}
  URL="http://127.0.0.1:$PORT"
  BOX="$HOME/.tinkerlings"
  APP="$BOX/app"
  NODE="$BOX/node"

  say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
  fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
  browse() { if command -v open >/dev/null; then open "$URL"; elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true; fi; }
  running() { curl -fs -m 2 -o /dev/null "$URL/api/worlds"; }
  # Downloads a tar.gz whole, then unpacks what is in its one folder into a new folder `$2`.
  # (Whole first: a download that breaks off leaves nothing half there.) `$3`: how curl shows it.
  unpack() {
    rm -rf "$2" "$2.tar.gz" && mkdir -p "$2"
    if curl -fL "$3" -o "$2.tar.gz" "$1" && tar -xzf "$2.tar.gz" -C "$2" --strip-components 1; then
      rm -f "$2.tar.gz"
    else
      rm -rf "$2" "$2.tar.gz"
      return 1
    fi
  }

  command -v curl >/dev/null || fail "Tinkerlings needs curl to install."
  if running; then
    say "Tinkerlings is running already: opening it."
    browse
    exit 0
  fi
  mkdir -p "$BOX"

  # ---- Node: the newest long-term version, its own copy
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) fail "This is for macOS and Linux. On Windows, see $REPO on GitHub." ;; esac
  case "$(uname -m)" in x86_64 | amd64) arch=x64 ;; arm64 | aarch64) arch=arm64 ;; *) fail "This computer's processor ($(uname -m)) is not supported." ;; esac
  wanted=$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null | grep -v '"lts":false' | grep -o '"version":"v[0-9.]*"' | head -1 | cut -d'"' -f4) || wanted=
  have=$("$NODE/bin/node" --version 2>/dev/null) || have=
  if [ -n "$wanted" ] && [ "$wanted" != "$have" ]; then
    say "Getting Node ${wanted}…"
    if unpack "https://nodejs.org/dist/$wanted/node-$wanted-$os-$arch.tar.gz" "$NODE.new" -# && [ -x "$NODE.new/bin/node" ]; then
      rm -rf "$NODE" && mv "$NODE.new" "$NODE"
    fi
  fi
  [ -x "$NODE/bin/node" ] || fail "Node could not be downloaded. Is this computer online?"
  PATH="$NODE/bin:$PATH"
  export PATH

  # ---- Tinkerlings itself: the newest version. Its runs stay.
  say "Getting the newest Tinkerlings…"
  if unpack "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" "$APP.new" -s && [ -f "$APP.new/package.json" ]; then
    for kept in runs node_modules; do
      if [ -d "$APP/$kept" ]; then mv "$APP/$kept" "$APP.new/"; fi
    done
    rm -rf "$APP" && mv "$APP.new" "$APP"
    (cd "$APP" && npm install --omit=dev --no-fund --no-audit --no-update-notifier --loglevel=error) || fail "Tinkerlings' parts could not be installed."
    cp "$APP/install.sh" "$BOX/install.sh"
  else
    rm -rf "$APP.new"
    [ -d "$APP/node_modules" ] || fail "Tinkerlings could not be downloaded. Is this computer online?"
    say "The newest version could not be fetched: starting the one that is here."
  fi

  # ---- On a Mac: a double click on the desktop starts it from now on.
  if [ "$os" = darwin ] && [ -d "$HOME/Desktop" ] && [ ! -e "$HOME/Desktop/Tinkerlings.command" ]; then
    # (macOS may ask first whether the Terminal may write to the desktop: without, there is just no icon.)
    { printf '#!/bin/sh\nexec sh "$HOME/.tinkerlings/install.sh"\n' > "$HOME/Desktop/Tinkerlings.command" &&
      chmod +x "$HOME/Desktop/Tinkerlings.command"; } 2>/dev/null || true
  fi

  # ---- Start, and open it once it answers. It runs as long as this window is open.
  say "Starting Tinkerlings. Keep this window open while you use it: closing it, or Ctrl+C, ends Tinkerlings."
  cd "$APP"
  node src/viewer/server.ts < /dev/null &
  server=$!
  trap 'kill $server 2>/dev/null' INT TERM EXIT
  tries=0
  until running; do
    kill -0 $server 2>/dev/null || fail "Tinkerlings did not start."
    tries=$((tries + 1)); [ $tries -gt 120 ] && fail "Tinkerlings did not start."
    sleep 0.5
  done
  browse
  say "Tinkerlings is at $URL"
  wait $server
}

main
