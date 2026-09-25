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
 * API (OHIF v3.10 / that commit only):
 *   - Global: window.config
 *   - whiteLabeling.createLogoComponentFn(React[, props]) → React node
 *   - dataSources: @ohif/extension-default.dataSourcesModule.dicomweb
 */
window.config = {
  routerBasename: '/',
  showStudyList: true,
  maxNumberOfWebWorkers: 3,

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

  customizationService: {},
  extensions: [],
  modes: [],

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
