# Reserved for unavoidable OHIF core patches.

Prefer `app-config.js` and `care-customization/` when possible.

## Active patches (pinned OHIF `0b6e9cba…` / v3.10.0 only)

| Patch | Purpose |
|-------|---------|
| `v3.10.0-0001-expose-care-ohif-services.patch` | Expose `window.__CARE_OHIF__` (`servicesManager`) for CARE measurement bridge |
| `v3.10.0-0002-register-care-hanging-protocols.patch` | Register CARE protocols from `hangingprotocols/care/careProtocols.js` |

Dockerfile applies every `v3.10.0-*.patch` with `patch -p1 --forward` after checkout and **fails the build** if a patch does not apply cleanly.

Do not silently skip failed patches. Do not retarget patches to another OHIF commit without a clinical migration plan.
