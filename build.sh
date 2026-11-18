#!/bin/bash
# Build the signed APK on helix in a capped scope. The editor is CurryCaster II's own renderer/outliner.js,
# copied in fresh on every build, so the phone runs exactly the desktop's editor. Output: ./OPML-Outliner.apk
set -e
cd "$(dirname "$0")"
cp ~/Work/studiocast2/renderer/outliner.js ~/Work/studiocast2/renderer/outliner-publish.js app/src/main/assets/
export JAVA_HOME=$HOME/opt/jdk-21 ANDROID_HOME=$HOME/Android/Sdk
export OUTLINER_KEYSTORE=$HOME/.android-keys/outliner.jks OUTLINER_KEYPASS=$(cat $HOME/.android-keys/outliner.pass)
systemd-run --user --scope -q -p MemoryMax=6G -p MemorySwapMax=0 -E JAVA_HOME -E ANDROID_HOME -E OUTLINER_KEYSTORE -E OUTLINER_KEYPASS -- \
  $HOME/opt/gradle-8.14.3/bin/gradle --no-daemon -q assembleRelease "$@"
cp app/build/outputs/apk/release/app-release.apk OPML-Outliner.apk
ls -la OPML-Outliner.apk
