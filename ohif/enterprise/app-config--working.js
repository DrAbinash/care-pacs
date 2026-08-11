/* CARE Diagnostics OHIF Enterprise Config
   CARE Orthanc only. No demo datasource.
*/

window.config = {
  routerBasename: "/",
  showStudyList: true,
  maxNumberOfWebWorkers: 3,

  dangerouslyUseDynamicConfig: {
    enabled: false,
  },

  dataSources: [
    {
      namespace: "@ohif/extension-default.dataSourcesModule.dicomweb",
      sourceName: "care-orthanc",
      configuration: {
        friendlyName: "CARE Diagnostics Orthanc",
        name: "care-orthanc",

        qidoRoot: "/dicom-web",
        wadoRoot: "/dicom-web",
        wadoUriRoot: "/wado",

        qidoSupportsIncludeField: false,
        supportsReject: false,
        supportsStow: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        enableStudyLazyLoad: true,

        imageRendering: "wadors",
        thumbnailRendering: "wadors",
      },
    },
  ],

  defaultDataSourceName: "care-orthanc",

  customizationService: {},
  cornerstoneExtensionConfig: {},

  extensions: [
    "@ohif/extension-default",
    "@ohif/extension-cornerstone",
    "@ohif/extension-measurement-tracking",
    "@ohif/extension-cornerstone-dicom-sr",
    "@ohif/extension-dicom-pdf",
    "@ohif/extension-dicom-video"
  ],

  modes: [
    "@ohif/mode-longitudinal"
  ],
};

window.__APP_CONFIG__ = window.config;
window.appConfig = window.config;
