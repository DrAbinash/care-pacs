/**
 * CARE Diagnostics Viewer — OHIF v3.10 runtime configuration (active).
 *
 * Served as /app-config.js. Uses same-origin relative DICOMweb/WADO roots so
 * LAN (:3010) and Tailscale (serve → ohif:80) share one build.
 *
 * Historical absolute Tailscale roots: app-config--working.js (inactive backup).
 *
 * Behavioural policy:
 *   - Keep whiteLabeling (official CARE logo + product name) and relative DICOMweb.
 *   - Suppress the investigational-use dialog for the CARE clinical deployment.
 *   - Do NOT change volume Z-spacing defaults.
 *   - Do NOT enable DICOM upload (baseline had supportsStow; OHIF v3.10 uses
 *     dicomUploadEnabled — left false until a dedicated clinical review).
 *   - omitQuotationForMultipartRequest + bulkDataURI are Orthanc DICOMweb
 *     compatibility flags required for reliable WADO-RS multipart retrieval.
 *
 * FROZEN UPSTREAM — DO NOT UPGRADE without an explicit clinical migration:
 *   OHIF_REF=v3.10.0
 *   OHIF_COMMIT=0b6e9cba7613dba1df883985d3c821a86b3ba0ff
 *
 * P1 reading-room UX (config-only, no OHIF upgrade):
 *   - CARE-tuned window/level presets for CT / MR / CR / DX / US
 *   - Common layout presets including 2×1 compare
 *   - Extra W/L hotkeys 5–6 (liver, mediastinum) via $push (defaults kept)
 *
 * API (OHIF v3.10 / that commit only):
 *   - Global: window.config
 *   - whiteLabeling.createLogoComponentFn(React[, props]) → React node
 *   - customizationService: immutability-helper overrides ($set / $push)
 *   - dataSources: @ohif/extension-default.dataSourcesModule.dicomweb
 */
window.config = {
  routerBasename: '/',
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showLoadingIndicator: true,
  showCPUFallbackMessage: true,
  showWarningMessageForCrossOrigin: true,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    prefetch: 25,
  },

  investigationalUseDialog: {
    option: 'never',
  },

  // Match working baseline: block dynamic remote configUrl loading.
  dangerouslyUseDynamicConfig: {
    enabled: false,
  },

  whiteLabeling: {
    createLogoComponentFn: function (React) {
      // Official CARE Diagnostics logo (CARE-owned asset under /care/assets/).
      // Kept small (~26px tall) so it never covers viewport pixels or toolbars.
      return React.createElement(
        'div',
        {
          className: 'care-ohif-logo',
          title: 'CARE Diagnostics Viewer',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            paddingLeft: '6px',
            maxHeight: '28px',
            overflow: 'hidden',
          },
        },
        React.createElement('img', {
          src: '/care/assets/care-diagnostics-logo.png',
          alt: 'CARE Diagnostics',
          style: {
            height: '26px',
            width: 'auto',
            maxWidth: '140px',
            objectFit: 'contain',
            display: 'block',
          },
        }),
        React.createElement(
          'span',
          {
            style: {
              color: '#e8eef7',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            },
          },
          'CARE Diagnostics Viewer'
        )
      );
    },
  },

  defaultDataSourceName: 'orthanc',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'CARE Diagnostics Orthanc',
        name: 'orthanc',
        // Same-origin relative roots — nginx proxies to Orthanc.
        // Paths match Orthanc DicomWeb.Root (/dicom-web/) and prior :3010 URLs.
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        wadoUriRoot: '/wado',
        qidoSupportsIncludeField: true,
        supportsReject: false,
        // Upload intentionally disabled for this foundation (see header comment).
        dicomUploadEnabled: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        // Orthanc multipart WADO-RS compatibility (OHIF + Orthanc).
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
  ],

  // OHIF v3.10 global customizations (CustomizationService.addReferences).
  // Order of CT presets 0–3 matches stock hotkeys 1–4 (soft tissue, lung, bone, brain).
  customizationService: [
    {
      'cornerstone.windowLevelPresets': {
        $set: {
          CT: [
            { id: 'ct-soft-tissue', description: 'Soft tissue', window: '400', level: '40' },
            { id: 'ct-lung', description: 'Lung', window: '1500', level: '-600' },
            { id: 'ct-bone', description: 'Bone', window: '2500', level: '480' },
            { id: 'ct-brain', description: 'Brain', window: '80', level: '40' },
            { id: 'ct-liver', description: 'Liver', window: '150', level: '90' },
            { id: 'ct-mediastinum', description: 'Mediastinum', window: '350', level: '50' },
            { id: 'ct-abdomen', description: 'Abdomen', window: '350', level: '40' },
            { id: 'ct-stroke', description: 'Stroke / narrow brain', window: '40', level: '40' },
            { id: 'ct-subdural', description: 'Subdural', window: '150', level: '75' },
          ],
          MR: [
            { id: 'mr-brain-t1', description: 'Brain T1', window: '500', level: '250' },
            { id: 'mr-brain-t2', description: 'Brain T2', window: '350', level: '150' },
            { id: 'mr-spine', description: 'Spine', window: '400', level: '200' },
            { id: 'mr-soft-tissue', description: 'Soft tissue', window: '600', level: '300' },
          ],
          CR: [
            { id: 'cr-chest', description: 'Chest XR', window: '2000', level: '500' },
            { id: 'cr-bone', description: 'Bone XR', window: '2500', level: '500' },
            { id: 'cr-abdomen', description: 'Abdomen XR', window: '2000', level: '400' },
          ],
          DX: [
            { id: 'dx-chest', description: 'Chest DX', window: '2000', level: '500' },
            { id: 'dx-bone', description: 'Bone DX', window: '2500', level: '500' },
            { id: 'dx-abdomen', description: 'Abdomen DX', window: '2000', level: '400' },
          ],
          US: [
            { id: 'us-default', description: 'US default', window: '255', level: '127' },
            { id: 'us-bright', description: 'US brighter', window: '200', level: '100' },
            { id: 'us-contrast', description: 'US contrast', window: '180', level: '90' },
          ],
        },
      },
      'layoutSelector.commonPresets': {
        $set: [
          {
            icon: 'layout-common-1x1',
            commandOptions: { numRows: 1, numCols: 1 },
          },
          {
            icon: 'layout-common-1x2',
            commandOptions: { numRows: 1, numCols: 2 },
          },
          {
            icon: 'layout-common-2x1',
            commandOptions: { numRows: 2, numCols: 1 },
          },
          {
            icon: 'layout-common-2x2',
            commandOptions: { numRows: 2, numCols: 2 },
          },
          {
            icon: 'layout-common-2x3',
            commandOptions: { numRows: 2, numCols: 3 },
          },
        ],
      },
      'ohif.hotkeyBindings': {
        $push: [
          {
            commandName: 'setWindowLevelPreset',
            commandOptions: { presetName: 'ct-liver', presetIndex: 4 },
            label: 'W/L Liver',
            keys: ['5'],
            isEditable: true,
          },
          {
            commandName: 'setWindowLevelPreset',
            commandOptions: { presetName: 'ct-mediastinum', presetIndex: 5 },
            label: 'W/L Mediastinum',
            keys: ['6'],
            isEditable: true,
          },
        ],
      },
    },
  ],
  extensions: [],
  modes: [],

  /**
   * Rank CARE hanging protocols before stock `default`.
   * Protocol matching is conservative — unmatched studies fall back to default.
   * Prior/current auto-pairing is NOT enabled (deferred; no patient-name matching).
   */
  modesConfiguration: {
    '@ohif/mode-longitudinal': {
      hangingProtocol: [
        'care.mriBrain',
        'care.mriCervicalSpine',
        'care.mriLumbarSpine',
        'care.ctBrain',
        'care.ctChest',
        'care.ctAbdomen',
        'default',
      ],
    },
  },

  /**
   * CARE static-integration settings (read by /care/*.js).
   * Empty allowlists fail closed. No PHI / secrets.
   */
  care: {
    viewerName: 'CARE Diagnostics Viewer',
    defaultReturnUrl: '',
    erpOriginAllowlist: [],
    returnUrlAllowlist: [],
  },
};
