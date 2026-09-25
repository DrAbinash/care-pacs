/**
 * CARE hanging protocols — ES module form for OHIF extension-default registration.
 * Keep in sync with protocols.cjs (Node tests).
 */

const imagesRequired = {
  weight: 5,
  attribute: 'numImageFrames',
  constraint: { greaterThan: { value: 0 } },
  required: true,
};

function modalityEquals(mod) {
  return {
    weight: 50,
    attribute: 'Modality',
    constraint: { equals: { value: mod } },
    required: true,
  };
}

function desc(token, weight = 12) {
  return {
    weight,
    attribute: 'SeriesDescription',
    constraint: { contains: { value: token } },
    required: false,
  };
}

function studyModality(mod, weight = 120) {
  return {
    id: `modality-${mod}`,
    weight,
    attribute: 'ModalitiesInStudy',
    constraint: { contains: mod },
    required: true,
  };
}

function studyDesc(token, weight = 80, required = false) {
  return {
    id: `desc-${token}`,
    weight,
    attribute: 'StudyDescription',
    constraint: { contains: { value: token } },
    required,
  };
}

function stackViewport(displaySetId) {
  return {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
    },
    displaySets: [{ id: displaySetId }],
  };
}

function mrSelector(id, tokens) {
  return {
    [id]: {
      allowUnmatchedView: true,
      seriesMatchingRules: [imagesRequired, modalityEquals('MR'), ...tokens.map((t, i) => desc(t, 15 - i))],
    },
  };
}

function ctSelector(id, tokens) {
  return {
    [id]: {
      allowUnmatchedView: true,
      seriesMatchingRules: [
        imagesRequired,
        modalityEquals('CT'),
        ...tokens.map((t, i) => desc(t, 14 - i)),
        desc('AX', 4),
        desc('Axial', 4),
      ],
    },
  };
}

function merge(...objs) {
  return Object.assign({}, ...objs);
}

function stage2x2(id, name, ids) {
  return {
    id,
    name,
    stageActivation: { enabled: { minViewportsMatched: 1 } },
    viewportStructure: {
      layoutType: 'grid',
      properties: { rows: 2, columns: 2 },
    },
    viewports: ids.map(stackViewport),
  };
}

function stage1x1(id, name, ds) {
  return {
    id,
    name,
    stageActivation: { enabled: { minViewportsMatched: 1 } },
    viewportStructure: {
      layoutType: 'grid',
      properties: { rows: 1, columns: 1 },
    },
    viewports: [stackViewport(ds)],
  };
}

export const careMriBrain = {
  id: 'care.mriBrain',
  name: 'CARE MRI Brain',
  protocolMatchingRules: [
    studyModality('MR'),
    studyDesc('BRAIN', 80),
    studyDesc('HEAD', 50),
    studyDesc('NEURO', 40),
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: merge(
    mrSelector('t2', ['T2', 't2_']),
    mrSelector('flair', ['FLAIR', 'Flair', 'T2FLAIR']),
    mrSelector('dwi', ['DWI', 'DIFF', 'Diffusion']),
    mrSelector('adc', ['ADC', 'Apparent Diffusion']),
    mrSelector('swi', ['SWI', 'SWAN', 'VenBold', 'T2*']),
    mrSelector('t1', ['T1', 't1_']),
    mrSelector('t1c', ['T1C', 'T1+C', 'POST', 'GD', 'Gad'])
  ),
  defaultViewport: stackViewport('t2'),
  stages: [stage2x2('care-mri-brain-2x2', 'T2/FLAIR/DWI/ADC', ['t2', 'flair', 'dwi', 'adc'])],
};

export const careMriCervicalSpine = {
  id: 'care.mriCervicalSpine',
  name: 'CARE MRI Cervical Spine',
  protocolMatchingRules: [
    studyModality('MR'),
    studyDesc('CERVICAL', 90),
    studyDesc('C-SPINE', 90),
    studyDesc('CSPINE', 80),
    studyDesc('C SPINE', 80),
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: merge(
    mrSelector('sagT1', ['SAG T1', 'SAGITTAL T1', 'T1 SAG']),
    mrSelector('sagT2', ['SAG T2', 'SAGITTAL T2', 'T2 SAG']),
    mrSelector('stir', ['STIR', 'T2 STIR', 'T2FS']),
    mrSelector('axT2', ['AX T2', 'AXIAL T2', 'T2 AX'])
  ),
  defaultViewport: stackViewport('sagT2'),
  stages: [
    stage2x2('care-mri-cspine-2x2', 'Sag T1/T2 / STIR / Ax T2', [
      'sagT1',
      'sagT2',
      'stir',
      'axT2',
    ]),
  ],
};

export const careMriLumbarSpine = {
  id: 'care.mriLumbarSpine',
  name: 'CARE MRI Lumbar Spine',
  protocolMatchingRules: [
    studyModality('MR'),
    studyDesc('LUMBAR', 90),
    studyDesc('L-SPINE', 90),
    studyDesc('LSPINE', 80),
    studyDesc('L SPINE', 80),
    studyDesc('LUMBOSACRAL', 70),
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: merge(
    mrSelector('sagT1', ['SAG T1', 'SAGITTAL T1', 'T1 SAG']),
    mrSelector('sagT2', ['SAG T2', 'SAGITTAL T2', 'T2 SAG']),
    mrSelector('stir', ['STIR', 'T2 STIR', 'T2FS']),
    mrSelector('axT2', ['AX T2', 'AXIAL T2', 'T2 AX'])
  ),
  defaultViewport: stackViewport('sagT2'),
  stages: [
    stage2x2('care-mri-lspine-2x2', 'Sag T1/T2 / STIR / Ax T2', [
      'sagT1',
      'sagT2',
      'stir',
      'axT2',
    ]),
  ],
};

export const careCtBrain = {
  id: 'care.ctBrain',
  name: 'CARE CT Brain',
  protocolMatchingRules: [
    studyModality('CT'),
    studyDesc('BRAIN', 80),
    studyDesc('HEAD', 60),
    studyDesc('SKULL', 40),
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: merge(
    ctSelector('axial', ['AX', 'Axial', 'BRAIN', 'HEAD']),
    ctSelector('bone', ['BONE', 'BONEALG'])
  ),
  defaultViewport: stackViewport('axial'),
  stages: [stage1x1('care-ct-brain-1x1', 'CT Brain axial', 'axial')],
};

export const careCtChest = {
  id: 'care.ctChest',
  name: 'CARE CT Chest',
  protocolMatchingRules: [
    studyModality('CT'),
    studyDesc('CHEST', 90),
    studyDesc('THORAX', 80),
    studyDesc('LUNG', 50),
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: merge(ctSelector('axial', ['AX', 'Axial', 'CHEST', 'THORAX', 'LUNG'])),
  defaultViewport: stackViewport('axial'),
  stages: [stage1x1('care-ct-chest-1x1', 'CT Chest axial', 'axial')],
};

export const careCtAbdomen = {
  id: 'care.ctAbdomen',
  name: 'CARE CT Abdomen',
  protocolMatchingRules: [
    studyModality('CT'),
    studyDesc('ABDOMEN', 90),
    studyDesc('ABDO', 70),
    studyDesc('PELVIS', 40),
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: merge(
    ctSelector('axial', ['AX', 'Axial', 'ABDOMEN', 'ABDO', 'PORTAL', 'VENOUS'])
  ),
  defaultViewport: stackViewport('axial'),
  stages: [stage1x1('care-ct-abdomen-1x1', 'CT Abdomen axial', 'axial')],
};

export const CARE_HANGING_PROTOCOLS = [
  careMriBrain,
  careMriCervicalSpine,
  careMriLumbarSpine,
  careCtBrain,
  careCtChest,
  careCtAbdomen,
];

export const CARE_ACTIVE_PROTOCOL_IDS = [
  'care.mriBrain',
  'care.mriCervicalSpine',
  'care.mriLumbarSpine',
  'care.ctBrain',
  'care.ctChest',
  'care.ctAbdomen',
  'default',
];
