# CARE customisation module (OHIF v3.10)

Repo-owned assets copied into the OHIF build output by
`ohif/enterprise/Dockerfile`. Not part of upstream OHIF source.

| File | Role |
|------|------|
| `care-security.js` | Shared allowlist / return-URL / context helpers (Node-tested) |
| `care-config.js` | Optional NAS-local allowlist overrides (no secrets) |
| `care-bridge.js` | Allowlisted `postMessage` bridge for CARE ERP iframes |
| `care-chrome.js` | Title, About panel, safe Return control |
| `assets/care-diagnostics-logo.png` | Official CARE Diagnostics logo (header chrome only) |

See `docs/OHIF_CARE_CUSTOMIZATION.md` for architecture, schema, build, and rollback.

## Important

This folder is a **static build-time integration layer**, not a registered
OHIF extension. Scripts are injected into compiled `index.html`.

## Design choice

**Configuration + injected CARE scripts** (not a full OHIF React extension/mode).
Keeps upgrades reviewable and avoids vendoring the OHIF monorepo.

## P0 branding + P1 reading room + P2 radiologist workflow (current)

- Logo + whiteLabeling + `investigationalUseDialog: { option: 'never' }`
- Reading-room WL / layouts / Keys panel (P1)
- Measurement bridge + Measure panel (P2A) — see `docs/CARE_OHIF_MEASUREMENT_BRIDGE.md`
- CARE hanging protocols MRI/CT (P2B)
- Upstream remains **frozen**: OHIF `v3.10.0` /
  commit `0b6e9cba7613dba1df883985d3c821a86b3ba0ff`
- Builder: `node:18-bookworm`

## Browser globals

- `window.config.care` — primary config (from `/app-config.js`)
- `window.careConfig` — optional overrides merged by `care-config.js`
- `window.__CARE_BUILD_INFO__` — generated at image build time
- `window.CARE_SECURITY` — security helpers
- `window.CARE_VIEWER_BRIDGE` — read-only `getContext()` (non-PHI UIDs only)

## Security (fail-closed)

Empty `erpOriginAllowlist` / `returnUrlAllowlist` refuse ERP messages and hide Return.
Never put PHI in bridge payloads, localStorage, or URL query params.
Never `postMessage(..., '*')`.
