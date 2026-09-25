# CARE OHIF ↔ ERP measurement bridge (P2A)

Contract for **one-way** structured measurements:

`OHIF MeasurementService` → CARE adapter → allowlisted `postMessage` → CARE ERP

OHIF remains fully usable without an ERP parent. Empty allowlists fail closed.

Pinned viewer: OHIF **v3.10.0** / `0b6e9cba7613dba1df883985d3c821a86b3ba0ff`.

## OHIF API used

| Item | Value |
|------|--------|
| Service | `servicesManager.services.measurementService` (`MeasurementService`) |
| Events | `MEASUREMENT_ADDED`, `RAW_MEASUREMENT_ADDED`, `MEASUREMENT_UPDATED`, `MEASUREMENT_REMOVED` |
| Access | `window.__CARE_OHIF__.servicesManager` (CARE patch `v3.10.0-0001-…`) |
| Adapter | `/care/measurement/care-measurement-adapter.js` |
| Runtime | `/care/care-measurement.js` |

No DOM scraping. Values come from measurement `data` / `cachedStats` produced by Cornerstone Length / Bidirectional mappings.

## Dual outbound protocols

Every add/update emits **both** (same security gate):

### 1. CARE bridge v1 (new)

```json
{
  "type": "care.viewer.measurementAdded",
  "schemaVersion": 1,
  "measurement": {
    "id": "annotation-uid",
    "toolType": "Length",
    "label": "Spinal Canal AP C4-C5",
    "intent": "CANAL_AP",
    "spinalLevel": "C4-C5",
    "values": { "lengthMm": 12.2 },
    "unit": "mm",
    "context": {
      "studyInstanceUID": "1.2…",
      "seriesInstanceUID": "1.2…",
      "sopInstanceUID": "1.2…",
      "frameNumber": 3
    }
  }
}
```

Update → `care.viewer.measurementUpdated`  
Remove → `{ "type": "care.viewer.measurementRemoved", "schemaVersion": 1, "measurementId": "…" }`

### 2. Legacy ERP producer (`ohifViewerBridge.ts`)

```json
{
  "source": "care-ohif",
  "type": "measurement",
  "studyInstanceUID": "1.2…",
  "seriesInstanceUID": "1.2…",
  "sopInstanceUID": "1.2…",
  "frameNumber": 3,
  "label": "Spinal Canal AP C4-C5",
  "value": 12.2,
  "unit": "mm",
  "measurementType": "Length",
  "annotationId": "annotation-uid",
  "intent": "CANAL_AP"
}
```

Delete → `{ "source": "care-ohif", "type": "measurement-deleted", "annotationId": "…" }`

Existing CARE ERP `subscribeCareOhifBridge` can consume (2) without waiting for a new receiver.
Prefer (1) for new code; keep (2) for compatibility.

## Required / optional fields

| Field | Required | Notes |
|-------|----------|-------|
| `measurement.id` / `annotationId` | yes (when known) | Deduplicate / upsert key |
| `toolType` | yes | Length, Bidirectional, … |
| `values.*` | when geometry present | Never invented |
| `unit` | preferred | Usually `mm` |
| `context.studyInstanceUID` | preferred | May be null early |
| `intent` | optional | `CANAL_AP` \| `LESION` \| `MIDLINE_SHIFT` \| `OTHER` |
| `spinalLevel` | optional | Manual only — never auto-guessed |
| `label` | optional | Radiologist free text / quick chip |

Bidirectional values: `longAxisMm`, `shortAxisMm` (from Cornerstone `length`/`width`).  
Do **not** invent a third (CC) axis from a 2D annotation.

## Security

- `erpOriginAllowlist` empty ⇒ no measurement posts
- Target is parent frame or `window.opener` only (same trust model as context bridge)
- Never `postMessage(..., "*")`
- No PHI keys (`patientName`, `PatientID`, `accessionNumber`, DOB, phone, pixels, …)
- ERP must bind `patientId` / `studyId` from **session**, never trust iframe-supplied ids

## Spine workflow (high priority)

1. Measure Length (no label required)
2. Open CARE chrome **Measure**
3. Tap **Canal AP** + level chip (`C2-3` … `C6-7` or `L1-2` … `L5-S1`)
4. Sticky intent applies to the last measurement and re-broadcasts update

Levels stored as CARE ERP form (`C4-C5`, `L4-L5`). Display chips use short form.

## Brain workflow

Optional labels (Lesion, Mass, Hematoma, Midline Shift, …) via Measure panel.  
Labels are **not** diagnoses.

## Recommended ERP UX

“Measurements from Viewer” checklist (radiologist selects what to insert):

```
MRI LS SPINE
☑ L1-L2   12.4 mm
☑ L4-L5    7.8 mm
[Insert into canal table]

Brain
☑ Lesion — 21.7 × 18.4 mm
☑ Midline shift — 4.2 mm
[Insert selected]
```

**Never** auto-insert into the final report.

## Backward compatibility

Unchanged:

- `care.viewer.requestContext` / `care.viewer.context`
- `care.viewer.ping` / `care.viewer.pong`
- `care.viewer.error`

## Outbound ERP → OHIF (not in P2)

Deferred: viewport capture request, navigate-to-anchor, any mutation of OHIF annotations from ERP.
