#!/bin/sh
# Write build metadata into the OHIF dist tree (JSON + JS).
# Never records secrets, env credentials, or PHI.
set -eu

DIST="${1:?dist dir required}"
shift

CARE_VERSION="unknown"
OHIF_REF="unknown"
OHIF_COMMIT="unknown"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --care-version) CARE_VERSION="${2:?}"; shift 2 ;;
    --ohif-ref) OHIF_REF="${2:?}"; shift 2 ;;
    --ohif-commit) OHIF_COMMIT="${2:?}"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

test -d "$DIST"
mkdir -p "$DIST/care"

BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

JSON="$DIST/care/build-info.json"
JS="$DIST/care/build-info.js"

cat > "$JSON" <<EOF
{
  "careViewerVersion": "${CARE_VERSION}",
  "ohifRef": "${OHIF_REF}",
  "ohifCommit": "${OHIF_COMMIT}",
  "builtAtUtc": "${BUILT_AT}",
  "productName": "CARE Diagnostics Viewer"
}
EOF

cat > "$JS" <<EOF
window.__CARE_BUILD_INFO__ = {
  careViewerVersion: $(printf '%s' "$CARE_VERSION" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  ohifRef: $(printf '%s' "$OHIF_REF" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  ohifCommit: $(printf '%s' "$OHIF_COMMIT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  builtAtUtc: $(printf '%s' "$BUILT_AT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  productName: "CARE Diagnostics Viewer"
};
EOF

test -s "$JSON"
test -s "$JS"
echo "Wrote CARE build metadata to $JSON"
