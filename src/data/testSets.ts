/** Test sets and color palette — ported from Hadassah graphs.js */

export const TEST_SETS: Record<string, string[] | null> = {
  cbc: [
    'WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLATELETS','RDW','MPV',
    'NEUTROPHILE','NEUTROPHILE%','LYMPHOCYTE','LYMPHOCYTE%',
    'MONOCYTE','MONOCYTE%','EOSINOPHILS','EOSINOPHILS%',
    'BASOPHILES','BASOPHILES%',
    'LARGE UNSTAINED CELLS#','LARGE UNSTAINED CELLS%',
  ],
  chemistry: [
    'GLUCOSE','BUN','CREATININE','SODIUM','POTASSIUM','CL',
    'CALCIUM','PHOSPHATE','MAGNESIUM','ALBUMIN','PROTEIN',
    'ALK. PHOS.','ALANINE.AM.TRAN (ALT)','ASPART.AM.TRANS (AST)',
    'GGTP','T.BILIRUBIN','D. BILIRUBIN','LDH','URIC ACID',
    'IRON','TRANSFERRIN','TOT. IRON BIND. CAPAC.',
    'FERRITIN','FOLIC ACID','VITAMIN B12','DIASTASE','LIPASE',
  ],
  bloodgas: ['PH','PCO2','PO2','HCO3','BE','O2SAT'],
  immunology: [
    'IGA','IGG','IGM','IgE Total',
    'FREE CHAIN KAPPA','FREE CHAIN LAMBDA','KAP/LAB RATIO',
    'Protein Electrophoresis','Protein immunofixation',
  ],
  urine: null,  // null = all urine tests
};

export const TEST_SET_LABELS: Record<string, string> = {
  cbc:       'ספירת דם',
  chemistry: 'כימיה',
  bloodgas:  'גזי דם',
  immunology:'אימונולוגיה',
  urine:     'שתן',
};

export const PALETTE = [
  '#1a6fc4','#e67e22','#27ae60','#8e44ad','#c0392b',
  '#16a085','#d35400','#2980b9','#f39c12','#1abc9c',
];
