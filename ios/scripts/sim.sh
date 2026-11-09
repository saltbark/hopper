#!/bin/sh
# Screenshots of the app in a simulator, against the demo Mac (demo-mac.ts), for checking a
# change without a phone. Debug builds only: they read HOPPER_PAIR_LINK and HOPPER_SHOW.
#
#   ios/scripts/sim.sh <simulator id> <link file> <show> <out.png> [--fresh]
#
# show: lock, work, projects, accounts, new, new:<project>, draft, queued, routines, routine:<name>, archived,
#       project:<key>, conversation
# --fresh forgets the pairing first and pairs from the link again.
set -eu
sim=$1 link=$2 show=$3 out=$4 fresh=${5:-}
export SIMCTL_CHILD_HOPPER_PAIR_LINK="$(cat "$link")"
export SIMCTL_CHILD_HOPPER_SHOW="$show"
if [ "$fresh" = "--fresh" ]; then export SIMCTL_CHILD_HOPPER_UNPAIR=1; fi
xcrun simctl launch --terminate-running-process "$sim" com.saltbark.hopper >/dev/null
sleep "${HOPPER_SIM_WAIT:-6}"
xcrun simctl io "$sim" screenshot "$out" >/dev/null 2>&1
echo "$out"
