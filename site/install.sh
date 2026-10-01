#!/bin/sh
# Installs Hopper: curl -fsSL https://hopper.saltbark.com/install.sh | sh
#
# Fetches the latest release from GitHub (or HOPPER_VERSION, as 0.2.0), checks its sha256,
# unpacks it to ~/.hopper/app/<version>, points ~/.hopper/app/current at it and links
# ~/.local/bin/hopper. Running it again upgrades. Needs macOS and Node 22.6 or later.
#
# Everything is in main, called on the last line, so a download cut short runs nothing.
set -eu

REPO=https://github.com/saltbark/hopper
APP="$HOME/.hopper/app"
BIN="$HOME/.local/bin"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'hopper: %s\n' "$*" >&2
  exit 1
}

main() {
  [ "$(uname -s)" = Darwin ] || fail "Hopper runs on macOS only, for now."

  command -v node >/dev/null 2>&1 ||
    fail "Hopper needs Node 22.6 or later, and there's no node on your PATH. https://nodejs.org"
  node -e '
    const [a, b] = process.versions.node.split(".").map(Number)
    process.exit(a > 22 || (a === 22 && b >= 6) ? 0 : 1)
  ' || fail "Hopper needs Node 22.6 or later; this is $(node --version). https://nodejs.org"

  if [ -n "${HOPPER_VERSION:-}" ]; then
    url="${HOPPER_DOWNLOAD:-$REPO/releases/download/v${HOPPER_VERSION#v}}"
  else
    url="${HOPPER_DOWNLOAD:-$REPO/releases/latest/download}"
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  say "Downloading Hopper…"
  curl -fsSL "$url/hopper.tar.gz" -o "$tmp/hopper.tar.gz" || fail "Couldn't download $url/hopper.tar.gz"
  curl -fsSL "$url/hopper.tar.gz.sha256" -o "$tmp/hopper.tar.gz.sha256" ||
    fail "Couldn't download $url/hopper.tar.gz.sha256"
  (cd "$tmp" && shasum -a 256 -c hopper.tar.gz.sha256 >/dev/null 2>&1) ||
    fail "The download doesn't match its checksum. Try again; if it keeps happening, tell us at $REPO/issues"

  top=$(tar -tzf "$tmp/hopper.tar.gz" | head -1)
  top=${top%%/*}
  version=${top#hopper-}
  case "$version" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "That doesn't look like a Hopper release ($top)." ;;
  esac

  mkdir -p "$APP" "$BIN"
  rm -rf "${APP:?}/$version" "$tmp/$top"
  tar -xzf "$tmp/hopper.tar.gz" -C "$tmp"
  mv "$tmp/$top" "$APP/$version"
  ln -sfn "$version" "$APP/current"
  ln -sf "$APP/current/bin/hopper.js" "$BIN/hopper"
  say "Installed Hopper $version in ~/.hopper/app/$version."

  case ":$PATH:" in
    *":$BIN:"*)
      found=$(command -v hopper 2>/dev/null || true)
      if [ -n "$found" ] && [ "$found" != "$BIN/hopper" ]; then
        say ""
        say "Another hopper comes first on your PATH: $found"
        say "Remove it (pnpm unlink --global hopper, if you built it from source), or run $BIN/hopper."
      fi
      ;;
    *)
      say ""
      say "~/.local/bin isn't on your PATH. Add this line to ~/.zshrc, then open a new terminal:"
      say ""
      say '  export PATH="$HOME/.local/bin:$PATH"'
      ;;
  esac

  command -v claude >/dev/null 2>&1 ||
    { say ""; say "Hopper drives Claude Code, which isn't on your PATH: https://claude.com/claude-code"; }

  say ""
  if [ -f "${HOPPER_CONFIG:-$HOME/.config/hopper/config.toml}" ]; then
    say "Run hopper to open it."
  else
    say "Next: hopper init, then hopper."
  fi
}

main "$@"
