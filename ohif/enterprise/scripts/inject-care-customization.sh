#!/bin/sh
# Copy CARE assets into the OHIF dist tree and inject script tags into index.html.
# Fails loudly if required files or markers are missing.
set -eu

DIST="${1:?dist dir required}"
CARE_SRC="${2:?care-customization dir required}"

test -d "$DIST"
test -f "$DIST/index.html"
test -d "$CARE_SRC"

CARE_DST="$DIST/care"
mkdir -p "$CARE_DST"

for f in care-security.js care-bridge.js care-chrome.js care-config.js care-measurement.js; do
  test -f "$CARE_SRC/$f" || { echo "ERROR: missing CARE file $CARE_SRC/$f" >&2; exit 1; }
  cp "$CARE_SRC/$f" "$CARE_DST/$f"
done

# Measurement adapter (subdir)
mkdir -p "$CARE_DST/measurement"
test -f "$CARE_SRC/measurement/care-measurement-adapter.js" \
  || { echo "ERROR: missing measurement adapter" >&2; exit 1; }
cp "$CARE_SRC/measurement/care-measurement-adapter.js" "$CARE_DST/measurement/"

# Optional assets directory
if [ -d "$CARE_SRC/assets" ]; then
  mkdir -p "$CARE_DST/assets"
  cp -a "$CARE_SRC/assets/." "$CARE_DST/assets/" 2>/dev/null || true
fi

INDEX="$DIST/index.html"

# Idempotent injection: remove prior CARE block if re-run.
if grep -q 'CARE_CUSTOMIZATION_BEGIN' "$INDEX"; then
  awk '
    /CARE_CUSTOMIZATION_BEGIN/ {skip=1; next}
    /CARE_CUSTOMIZATION_END/ {skip=0; next}
    !skip {print}
  ' "$INDEX" > "$INDEX.tmp"
  mv "$INDEX.tmp" "$INDEX"
fi

if ! grep -q '</body>' "$INDEX"; then
  echo "ERROR: index.html has no </body> to inject CARE scripts" >&2
  exit 1
fi

awk '
  /<\/body>/ && !done {
    print "    <!-- CARE_CUSTOMIZATION_BEGIN -->"
    print "    <script src=\"/care/care-security.js\"></script>"
    print "    <script src=\"/care/care-config.js\"></script>"
    print "    <script src=\"/care/build-info.js\"></script>"
    print "    <script src=\"/care/measurement/care-measurement-adapter.js\"></script>"
    print "    <script src=\"/care/care-bridge.js\"></script>"
    print "    <script src=\"/care/care-measurement.js\"></script>"
    print "    <script src=\"/care/care-chrome.js\"></script>"
    print "    <!-- CARE_CUSTOMIZATION_END -->"
    done=1
  }
  { print }
' "$INDEX" > "$INDEX.tmp"
mv "$INDEX.tmp" "$INDEX"

grep -q 'care/care-bridge.js' "$INDEX" || { echo "ERROR: CARE bridge not injected" >&2; exit 1; }
grep -q 'care/care-security.js' "$INDEX" || { echo "ERROR: CARE security not injected" >&2; exit 1; }
grep -q 'CARE_CUSTOMIZATION_BEGIN' "$INDEX" || { echo "ERROR: CARE markers missing" >&2; exit 1; }

echo "CARE customisation injected into $INDEX"
