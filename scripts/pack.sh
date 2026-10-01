#!/bin/sh
# Packs a release into release/: hopper.tar.gz and its .sha256. Run after pnpm build, on a Mac.
# The tarball holds one folder, hopper-<version>, with the built app and its production
# node_modules, node-pty's prebuilds for both Mac architectures among them. RELEASE in it marks
# a release copy, so `hopper --version` prints the bare version.
set -eu
cd "$(dirname "$0")/.."

v=$(node -p "require('./package.json').version")
stage="release/hopper-$v"
rm -rf release
mkdir -p "$stage"
cp -R bin dist docs templates package.json pnpm-lock.yaml LICENSE README.md "$stage/"
echo "$v" >"$stage/RELEASE"

# Hoisted, so the tree is plain folders rather than pnpm's links.
(cd "$stage" && pnpm install --prod --frozen-lockfile --config.node-linker=hoisted)
rm -rf "$stage"/node_modules/node-pty/prebuilds/win32-*
rm -f "$stage/pnpm-lock.yaml"

# A smoke test of the packed copy, not the checkout.
test "$(node "$stage/bin/hopper.js" --version)" = "$v"

tar -czf release/hopper.tar.gz -C release "hopper-$v"
(cd release && shasum -a 256 hopper.tar.gz >hopper.tar.gz.sha256)
echo "release/hopper.tar.gz: hopper $v, $(du -h release/hopper.tar.gz | cut -f1)"
