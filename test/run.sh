#!/bin/bash
# Web-layer test of the Android app: phone-size headless Chromium + mock bridge + a real outliner-sync.
set -e; cd "$(dirname "$0")"
cp ~/Work/studiocast2/renderer/outliner.js ~/Work/studiocast2/renderer/outliner-publish.js ../app/src/main/assets/
T=$(mktemp -d); mkdir -p "$T/home/NO_AGENDA" "$T/home/.config/OPML Outliner"
F="$T/home/NO_AGENDA/NA-9999-phone.opml"
cat > "$F" <<X
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>t</title><state selectedPath="0/0"/></head><body>
<outline text="Open parent" _expanded="true" _custom="keep"><outline text="Kid one"/><outline text="Kid two"/></outline>
<outline text="Shut parent"><outline text="hidden kid"/></outline>
$(for i in $(seq 1 30); do echo "<outline text=\"filler $i\"/>"; done)
</body></opml>
X
python3 -c "import json;json.dump({'recent':['$F']},open('$T/home/.config/OPML Outliner/prefs.json','w'))"
HOME="$T/home" OUTLINER_SYNC_TEST_NO_AUTH=1 OUTLINER_SYNC_HOST=127.0.0.1 OUTLINER_SYNC_PORT=18795 python3 ~/Work/studiocast2/outliner/sync/outliner-sync.py >/dev/null 2>&1 & SP=$!
( cd ~/Work/cartpub && CARTPUB_HOST=127.0.0.1 CARTPUB_PORT=18796 CARTPUB_LOGINS='*' CARTPUB_DRY=1 CARTPUB_STATE="$T/cartpub" ~/.local/bin/uv run -q python -m cartpub.server >/dev/null 2>&1 ) & CP=$!
sleep 3
GCFILE="$F" BACKUPS="$T/home/.config/OPML Outliner/opml-backups" OUTDIR="$T" ~/Work/studiocast2/node_modules/.bin/electron --no-sandbox --ozone-platform=headless --ozone-override-screen-size=412,860 --disable-gpu main.cjs 2>/dev/null | grep -E "^  (ok|FAIL)|DRIVER"; R=${PIPESTATUS[0]}
kill $SP; kill $CP 2>/dev/null; for p in $(ss -ltnp | grep ':18796 ' | grep -o 'pid=[0-9]*' | cut -d= -f2); do kill $p; done; echo "screenshot: $T/phone.png"; exit $R
