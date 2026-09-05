# CARE customisation module (OHIF v3.10)

Repo-owned assets copied into the OHIF build output by
`ohif/enterprise/Dockerfile`. Not part of upstream OHIF source.

| File | Role |
|------|------|
| `care-security.js` | Shared allowlist / return-URL / context helpers (Node-tested) |
| `care-config.js` | Optional NAS-local allowlist overrides (no secrets) |
| `care-bridge.js` | Allowlisted `postMessage` bridge for CARE ERP iframes |
| `care-chrome.js` | Title, About panel, safe Return control |
| `assets/` | Optional static assets (none required for foundation) |

See `docs/OHIF_CARE_CUSTOMIZATION.md` for architecture, schema, build, and rollback.

## Important

This folder is a **static build-time integration layer**, not a registered
OHIF extension. Scripts are injected into compiled `index.html`.

## Design choice

**Configuration + injected CARE scripts** (not a full OHIF React extension/mode).
Keeps upgrades reviewable and avoids vendoring the OHIF monorepo.

## Browser globals

- `window.config.care` — primary config (from `/app-config.js`)
- `window.careConfig` — optional overrides merged by `care-config.js`
- `window.__CARE_BUILD_INFO__` — generated at image build time
- `window.CARE_SECURITY` — security helpers
- `window.CARE_VIEWER_BRIDGE` — read-only `getContext()` (non-PHI UIDs only)
