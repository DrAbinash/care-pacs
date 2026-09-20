/* CARE Diagnostics OHIF config
   This file MUST be served by OHIF at /app-config.js.
   It intentionally uses window.config because the OHIF Docker image reads runtime config from window.config.
*/
window.config = {
  routerBasename: '/',
  showStudyList: true,
  maxNumberOfWebWorkers: 3,

  // Important: prevent OHIF from trying to load configUrl dynamically.
  dangerouslyUseDynamicConfig: {
    enabled: false,
  },

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'Care Diagnostics Orthanc',
        name: 'orthanc',
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        wadoUriRoot: '/wado',
        qidoSupportsIncludeField: true, // FIXED: Changed from false to true
        supportsReject: false,
        supportsStow: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        enableStudyLazyLoad: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
      },
    },
  ],

  defaultDataSourceName: 'orthanc',
  customizationService: {},
  cornerstoneExtensionConfig: {},
  extensions: [],
  modes: [],
};

// Extra aliases are harmless and help if a cached OHIF build looks for alternate globals.
window.__APP_CONFIG__ = window.config;
window.appConfig = window.config;
