#!/bin/sh
# Archives a Release build of the iPhone app and uploads it to App Store Connect, where it shows in
# TestFlight once Apple has processed it (a few minutes). From the repo root:
#
#   ios/scripts/testflight.sh           archive and upload
#   ios/scripts/testflight.sh --dry     archive and export a local .ipa only, nothing uploaded
#
# Signing and upload use the Apple ID signed in to Xcode (team 8TXLSBW83Z), or an App Store
# Connect API key when ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (the .p8) are set. The build
# number is the UTC time, YYYYMMDDHHMM, so each upload is higher than the last; the version is
# MARKETING_VERSION in the project.
set -eu
cd "$(dirname "$0")/../.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

dest=upload
[ "${1:-}" = "--dry" ] && dest=export
out="${HOPPER_TF_OUT:-${TMPDIR:-/tmp}/hopper-testflight}"
build=$(date -u +%Y%m%d%H%M)
rm -rf "$out"
mkdir -p "$out"

set -- -allowProvisioningUpdates
if [ -n "${ASC_KEY_ID:-}" ]; then
  set -- "$@" -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
fi

cat >"$out/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$dest</string>
  <key>teamID</key><string>8TXLSBW83Z</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
EOF

echo "Archiving build ${build}…"
xcodebuild -project ios/Hopper.xcodeproj -scheme Hopper -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$out/Hopper.xcarchive" \
  CURRENT_PROJECT_VERSION="$build" "$@" archive >"$out/archive.log" 2>&1 ||
  { grep -E "error:|BUILD FAILED|ARCHIVE FAILED" "$out/archive.log" | head -20; echo "Archive failed: $out/archive.log"; exit 1; }

echo "Exporting ($dest)…"
xcodebuild -exportArchive -archivePath "$out/Hopper.xcarchive" -exportOptionsPlist "$out/ExportOptions.plist" \
  -exportPath "$out/export" "$@" >"$out/export.log" 2>&1 ||
  { grep -iE "error|failed" "$out/export.log" | head -20; echo "Export failed: $out/export.log"; exit 1; }

if [ "$dest" = upload ]; then
  echo "Uploaded build $build. It shows in TestFlight once App Store Connect has processed it."
else
  echo "Exported build $build: $out/export"
fi
