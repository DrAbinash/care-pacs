# Reserved for unavoidable OHIF core patches.

This foundation does **not** patch OHIF source. Prefer:

- `app-config.js` (supported whiteLabeling + dataSources)
- `care-customization/` scripts injected at build time

If a future OHIF upgrade forces a minimal core patch:

1. Add a versioned file here, e.g. `v3.10.0-0001-description.patch`
2. Target the pinned `OHIF_COMMIT` only
3. Apply it in the Dockerfile after checkout with `patch -p1 --forward --dry-run` then `patch -p1`
4. Fail the build if the patch does not apply cleanly

Do not silently skip failed patches.
