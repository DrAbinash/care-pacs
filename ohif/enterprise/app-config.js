/**
 * CARE Diagnostics Viewer — OHIF v3.10 runtime configuration (active).
 *
 * Served as /app-config.js. Uses relative DICOMweb/WADO roots so the same
 * build works on LAN (:3010) and Tailscale (serve → ohif:80) without baking
 * a Tailscale IP into the image.
 *
 * Historical absolute Tailscale roots are preserved only in
 * app-config--working.js (backup; not used by the Dockerfile).
 *
 * API notes (OHIF v3.10):
 *   - Global is window.config
 *   - whiteLabeling.createLogoComponentFn(React[, props]) must return a React node
 *   - dataSources use @ohif/extension-default.dataSourcesModule.dicomweb
 */
window.config = {
  routerBasename: '/',
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  strictZSpacingForVolumeViewport: true,

  // Browser / OS title hint (CARE chrome also enforces document.title).
  softApplicationName: 'CARE Diagnostics Viewer',

  investigationalUseDialog: {
    option: 'never',
  },

  dangerouslyUseDynamicConfig: {
    enabled: false,
  },

  // Supported OHIF white-label hook (v3.10). Text only — no graphic logo asset.
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'div',
        {
          className: 'care-ohif-logo',
          title: 'CARE Diagnostics Viewer',
          style: {
            color: '#e8eef7',
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.02em',
            paddingLeft: '8px',
            whiteSpace: 'nowrap',
          },
        },
        'CARE Diagnostics Viewer'
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
        // Same-origin relative roots — nginx in this image proxies to Orthanc.
        // Path prefix matches Orthanc DicomWeb.Root (/dicom-web/) and the
        // previously working absolute URL path on :3010.
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        wadoUriRoot: '/wado',
        qidoSupportsIncludeField: true,
        supportsReject: false,
        dicomUploadEnabled: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
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
   * CARE-owned viewer integration settings (read by /care/care-config.js).
   * Keep PHI out of this object. No secrets.
   */
  care: {
    viewerName: 'CARE Diagnostics Viewer',
    defaultReturnUrl: '',
    erpOriginAllowlist: [],
    returnUrlAllowlist: [],
  },
};
