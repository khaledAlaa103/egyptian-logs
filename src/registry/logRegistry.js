// Modular log registry. Each log: name, abbreviation, description, unit group (canonical unit +
// accepted units), scale type, validation rules, interpretation availability and limitations.
// Not every well has every log — nothing here assumes availability.
import { canonicalUnit, unitsFor } from '../engine/units/units.js';

export const CATEGORIES = ['electrical', 'radioactive', 'acoustic', 'borehole', 'additional'];

export const CATEGORY_NAMES = {
  electrical: { en: 'Electrical logs', ar: 'اللوجات الكهربائية' },
  radioactive: { en: 'Radioactive logs', ar: 'اللوجات الإشعاعية' },
  acoustic: { en: 'Acoustic logs', ar: 'اللوجات الصوتية' },
  borehole: { en: 'Borehole logs', ar: 'لوجات البئر' },
  additional: { en: 'Additional logs', ar: 'لوجات إضافية' },
};

// Helper to keep entries compact. `range` = physically plausible values in the CANONICAL unit.
// `use` = interpretation roles (resolved by the Phase 6 engine). `aliases` = header names for auto-mapping.
const L = (id, abbr, category, group, scale, range, en, ar, use, aliases, limEn, limAr) => ({
  id, abbr, category, group, scale, range, name: { en: en[0], ar: ar[0] },
  description: { en: en[1], ar: ar[1] }, use, aliases,
  limitations: { en: limEn, ar: limAr }, kind: 'curve',
});

const RES_LIM_EN = 'Apparent value; not true formation resistivity (Rt) without tool, borehole and invasion corrections.';
const RES_LIM_AR = 'قيمة ظاهرية؛ ليست المقاومية الحقيقية للتكوين (Rt) دون تصحيحات الأداة والحفرة والاختراق.';

export const BUILTIN_LOGS = [
  // ---- Electrical ----
  L('res_deep', 'RD', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Deep Resistivity', 'Deep-investigation resistivity'], ['المقاومية العميقة', 'مقاومية بعمق استقصاء كبير'],
    ['resistivity', 'rt', 'sw'], ['rd', 'lld', 'ild', 'ildeep', 'resdeep', 'deepres', 'rdeep', 'ild', 'ae90', 'at90', 'rt'], RES_LIM_EN, RES_LIM_AR),
  L('res_medium', 'RM', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Medium Resistivity', 'Medium-investigation resistivity'], ['المقاومية المتوسطة', 'مقاومية بعمق استقصاء متوسط'],
    ['resistivity', 'invasion'], ['rm', 'ilm', 'resmed', 'medres', 'rmed', 'ae30', 'at30'], RES_LIM_EN, RES_LIM_AR),
  L('res_shallow', 'RS', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Shallow Resistivity', 'Shallow-investigation resistivity (invaded zone)'], ['المقاومية الضحلة', 'مقاومية الاستقصاء الضحل (النطاق المخترق)'],
    ['resistivity', 'invasion'], ['rs', 'lls', 'msfl', 'ressh', 'shallowres', 'rshallow', 'ae10', 'at10'], RES_LIM_EN, RES_LIM_AR),
  L('lateral', 'LAT', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Lateral Log', 'Lateral-array apparent resistivity'], ['اللوج الجانبي (Lateral)', 'مقاومية ظاهرية بترتيب جانبي'],
    ['resistivity'], ['lat', 'lateral', 'lt'], 'Strong bed-thickness and shoulder effects; thin beds poorly resolved.', 'تأثيرات قوية للسمك والطبقات المجاورة؛ الطبقات الرقيقة غير واضحة.'),
  L('laterolog', 'LL', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Laterolog', 'Focused-current resistivity'], ['اللاتيرولوج', 'مقاومية بتيار مركّز'],
    ['resistivity', 'rt'], ['ll', 'laterolog', 'lldl', 'lls3'], 'Requires conductive borehole fluid; apparent value until corrected.', 'يتطلب سائل حفرة موصلًا؛ قيمة ظاهرية حتى تُصحَّح.'),
  L('induction', 'IL', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Induction Log', 'Induction resistivity'], ['لوج الحث (Induction)', 'مقاومية بالحث'],
    ['resistivity', 'rt'], ['il', 'induction', 'ind', 'ildinduction'], 'Not suitable in very resistive formations or with non-conductive fluid.', 'غير مناسب في التكوينات عالية المقاومية أو مع سائل غير موصل.'),
  L('short_normal', 'SN', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Short Normal', 'Short normal (16 in) apparent resistivity'], ['العادي القصير', 'مقاومية ظاهرية بالترتيب العادي القصير'],
    ['resistivity', 'invasion'], ['sn', 'shortnormal', 'n16', 'sn16', 'res16'], RES_LIM_EN, RES_LIM_AR),
  L('long_normal', 'LN', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Long Normal', 'Long normal (64 in) apparent resistivity'], ['العادي الطويل', 'مقاومية ظاهرية بالترتيب العادي الطويل'],
    ['resistivity', 'rt'], ['ln', 'longnormal', 'n64', 'ln64', 'res64'], RES_LIM_EN, RES_LIM_AR),
  L('normal_res', 'NR', 'electrical', 'resistivity', 'log', [0.01, 100000],
    ['Normal Resistivity', 'Normal-array resistivity (spacing unspecified)'], ['المقاومية العادية', 'مقاومية بالترتيب العادي (تباعد غير محدد)'],
    ['resistivity'], ['nr', 'normal', 'normalres'], RES_LIM_EN, RES_LIM_AR),
  L('micro_res', 'MR', 'electrical', 'resistivity', 'log', [0.01, 10000],
    ['Micro Resistivity', 'Micro-resistivity (flushed zone)'], ['المقاومية الدقيقة', 'مقاومية دقيقة للنطاق المغسول'],
    ['resistivity', 'rxo'], ['mr', 'micro', 'mlog', 'mcal', 'microres', 'rxo', 'mll', 'pl'], 'Affected by mud cake and hole rugosity; reads the flushed zone (Rxo).', 'يتأثر بكعكة الطين وخشونة الحفرة؛ يقرأ النطاق المغسول (Rxo).'),
  L('ec', 'EC', 'electrical', 'conductivity', 'linear', [0, 1000000],
    ['Electrical Conductivity', 'Formation or fluid electrical conductivity'], ['الموصلية الكهربائية', 'موصلية التكوين أو السائل'],
    ['conductivity', 'water_quality'], ['ec', 'cond', 'conductivity', 'cond_ec'], 'State whether this is formation, borehole-fluid or water-sample conductivity before using it for TDS.', 'حدّد هل هي موصلية تكوين أو سائل حفرة أو عينة مياه قبل استخدامها لتقدير TDS.'),
  L('sp', 'SP', 'electrical', 'potential', 'linear', [-1000, 1000],
    ['Spontaneous Potential (SP)', 'Natural electrochemical potential'], ['الجهد الذاتي (SP)', 'جهد كهروكيميائي طبيعي'],
    ['shale_baseline', 'rw'], ['sp', 'spontaneous', 'ssp'], 'Needs shale baseline; unreliable when mud and formation water salinity are similar.', 'يحتاج خط أساس الطين؛ غير موثوق عند تقارب ملوحة الطين وماء التكوين.'),

  // ---- Radioactive ----
  L('gr', 'GR', 'radioactive', 'gr', 'linear', [0, 1000],
    ['Gamma Ray (GR)', 'Total natural gamma radiation'], ['أشعة جاما (GR)', 'إجمالي إشعاع جاما الطبيعي'],
    ['gr_index', 'vshale', 'lithology'], ['gr', 'gamma', 'gammaray', 'gamma_ray', 'grc', 'gr_api', 'cgr'], 'Radioactive non-shale minerals (K-feldspar, micas, U) bias Vshale; needs clean/shale baselines.', 'معادن مشعة غير طينية تُحدث انحيازًا في Vshale؛ يحتاج خطوط أساس للرمل النظيف والطين.'),
  L('sgr', 'SGR', 'radioactive', 'gr', 'linear', [0, 1000],
    ['Spectral Gamma Ray (total)', 'Total gamma from spectral tool'], ['أشعة جاما الطيفية (الإجمالي)', 'إجمالي جاما من الأداة الطيفية'],
    ['gr_index', 'vshale'], ['sgr', 'spectralgr', 'sgrtotal'], 'Use K/U/Th channels to separate clay from non-clay radioactivity.', 'استخدم قنوات K/U/Th للتمييز بين الإشعاع الطيني وغير الطيني.'),
  L('sgr_k', 'K', 'radioactive', 'pct', 'linear', [0, 20],
    ['Spectral GR – Potassium', 'Potassium concentration'], ['جاما الطيفية – بوتاسيوم', 'تركيز البوتاسيوم'],
    ['clay_type'], ['k', 'pota', 'potassium', 'sgrk'], 'Concentration units depend on the tool; calibrate before comparing wells.', 'وحدات التركيز تعتمد على الأداة؛ عايِر قبل مقارنة الآبار.'),
  L('sgr_u', 'U', 'radioactive', 'ppm', 'linear', [0, 500],
    ['Spectral GR – Uranium', 'Uranium concentration'], ['جاما الطيفية – يورانيوم', 'تركيز اليورانيوم'],
    ['clay_type'], ['u', 'uran', 'uranium', 'sgru'], 'Uranium may be mobile in groundwater; not a pure clay indicator.', 'قد يكون اليورانيوم متحركًا في المياه الجوفية؛ ليس مؤشر طين خالصًا.'),
  L('sgr_th', 'Th', 'radioactive', 'ppm', 'linear', [0, 500],
    ['Spectral GR – Thorium', 'Thorium concentration'], ['جاما الطيفية – ثوريوم', 'تركيز الثوريوم'],
    ['clay_type'], ['th', 'thor', 'thorium', 'sgrth'], 'Concentration units depend on the tool.', 'وحدات التركيز تعتمد على الأداة.'),
  L('density', 'RHOB', 'radioactive', 'density', 'linear', [0.5, 4],
    ['Density Log', 'Bulk density'], ['لوج الكثافة', 'الكثافة الكلية'],
    ['porosity'], ['rhob', 'den', 'density', 'rho', 'bulkdensity', 'zden'], 'Density porosity needs matrix and fluid densities for the lithology; affected by washouts.', 'مسامية الكثافة تحتاج كثافة الصخر والسائل لنوع الصخر؛ تتأثر بالتجاويف.'),
  L('neutron', 'NPHI', 'radioactive', 'porosity', 'linear', [-0.05, 1],
    ['Neutron Porosity', 'Neutron porosity (tool-lithology units)'], ['المسامية النيوترونية', 'مسامية نيوترونية (بوحدات الصخر المعايَر)'],
    ['porosity'], ['nphi', 'neu', 'neutron', 'cnl', 'tnph', 'phin'], 'Reports in the tool calibration lithology; gas and clay bound water effects.', 'تُقاس بصخر معايرة الأداة؛ تتأثر بالغاز والماء المرتبط بالطين.'),
  L('pef', 'PEF', 'radioactive', 'pef', 'linear', [0, 20],
    ['Photoelectric Factor (PEF)', 'Photoelectric absorption factor'], ['معامل الامتصاص الكهروضوئي (PEF)', 'معامل الامتصاص الكهروضوئي'],
    ['lithology'], ['pef', 'pe', 'pefz'], 'Distorted by barite mud; lithology indicator only.', 'يتشوه بطين الباريت؛ مؤشر ليثولوجي فقط.'),

  // ---- Acoustic ----
  L('sonic', 'DT', 'acoustic', 'sonic', 'linear', [40, 500],
    ['Sonic Log', 'Interval transit time (generic)'], ['اللوج الصوتي', 'زمن عبور الفترة (عام)'],
    ['porosity'], ['dt', 'sonic', 'ac', 'delta_t'], 'Cycle skipping in poorly consolidated or gas-bearing zones; compaction correction may be needed.', 'قفز الدورات في الطبقات غير المتماسكة أو الغازية؛ قد يلزم تصحيح الانضغاط.'),
  L('dtc', 'DTC', 'acoustic', 'sonic', 'linear', [40, 500],
    ['Compressional Travel Time', 'P-wave slowness'], ['زمن العبور الانضغاطي', 'بطء الموجة P'],
    ['porosity'], ['dtc', 'dtco', 'dtp', 'dtcomp'], 'See sonic log limitations.', 'انظر قيود اللوج الصوتي.'),
  L('dts', 'DTS', 'acoustic', 'sonic', 'linear', [60, 1000],
    ['Shear Travel Time', 'S-wave slowness'], ['زمن العبور القصّي', 'بطء الموجة S'],
    ['lithology', 'mechanical'], ['dts', 'dtsm', 'dtshear'], 'Shear arrival may be undetectable in slow formations.', 'قد يتعذر رصد وصول الموجة القصية في التكوينات البطيئة.'),

  // ---- Borehole ----
  L('caliper', 'CAL', 'borehole', 'length', 'linear', [0, 1500],
    ['Caliper', 'Borehole caliper'], ['الكاليبر', 'قطر الحفرة المقيس'],
    ['borehole_correction', 'quality'], ['cal', 'cali', 'caliper', 'hcal'], 'Used for borehole corrections and to flag unreliable washed-out intervals.', 'يُستخدم لتصحيحات الحفرة ولتمييز المقاطع المتجوفة غير الموثوقة.'),
  L('bhd', 'BHD', 'borehole', 'length', 'linear', [0, 1500],
    ['Borehole Diameter', 'Borehole diameter (drilled or measured)'], ['قطر الحفرة', 'قطر الحفرة (حفر أو قياس)'],
    ['borehole_correction'], ['bhd', 'bs', 'bitsize', 'diameter', 'hole'], 'State whether bit size or measured diameter.', 'حدّد هل هو قطر الريشة أم قطر مقيس.'),
  L('temp', 'TEMP', 'borehole', 'temperature', 'linear', [-20, 300],
    ['Temperature', 'Borehole fluid temperature'], ['درجة الحرارة', 'حرارة سائل الحفرة'],
    ['temperature_correction'], ['temp', 'temperature', 'tmp', 'btemp'], 'Borehole fluid temperature may differ from formation temperature (not at equilibrium).', 'قد تختلف حرارة سائل الحفرة عن حرارة التكوين (غير متزن).'),
  L('fluid_ec', 'FEC', 'borehole', 'conductivity', 'linear', [0, 1000000],
    ['Fluid Conductivity', 'Borehole fluid conductivity'], ['موصلية السائل', 'موصلية سائل الحفرة'],
    ['conductivity', 'water_quality'], ['fec', 'fluidec', 'fluidcond', 'fcond'], 'Borehole fluid may not represent formation water (mud, mixing, crossflow).', 'قد لا يمثل سائل الحفرة ماء التكوين (طين، اختلاط، تدفق عرضي).'),
  L('fluid_res', 'FRES', 'borehole', 'resistivity', 'log', [0.01, 10000],
    ['Fluid Resistivity', 'Borehole fluid resistivity'], ['مقاومية السائل', 'مقاومية سائل الحفرة'],
    ['rm', 'water_quality'], ['fres', 'fluidres', 'rmf', 'rm_fluid'], 'Report the measurement temperature; borehole fluid is not necessarily formation water.', 'سجّل حرارة القياس؛ سائل الحفرة ليس بالضرورة ماء التكوين.'),

  // ---- Additional ----
  L('nmr', 'NMR', 'additional', 'porosity', 'linear', [-0.05, 1],
    ['Nuclear Magnetic Resonance (NMR)', 'NMR total porosity'], ['الرنين المغناطيسي النووي (NMR)', 'المسامية الكلية بالرنين'],
    ['porosity', 'permeability'], ['nmr', 'tcmr', 'mphi', 'cmr', 'nmrphi'], 'Only total/effective porosity is imported here; T2 distributions need a dedicated workflow.', 'تُستورد المسامية الكلية/الفعالة فقط؛ توزيعات T2 تحتاج مسارًا مخصصًا.'),
];

/** Image logs are not scalar depth curves: handled by the image/digitisation module (Phase 5). */
export const IMAGE_LOG = {
  id: 'image_log', abbr: 'IMG', category: 'additional', kind: 'image', group: null, scale: null, range: null,
  name: { en: 'Image Logs', ar: 'لوجات الصور' },
  description: { en: 'Borehole image logs (acoustic/resistivity imaging)', ar: 'لوجات صور الحفرة (صوتية/مقاومية)' },
  use: [], aliases: [],
  limitations: { en: 'Stored as images, not numeric curves.', ar: 'تُخزَّن كصور وليست منحنيات رقمية.' },
};

export const NUMERIC_LOGS = BUILTIN_LOGS;
export const ALL_BUILTIN = [...BUILTIN_LOGS, IMAGE_LOG];

/** Build a custom (user-defined) curve definition. Custom curves have one free unit, no conversion. */
export function makeCustomCurve({ id, abbr, name, unit, scale = 'linear', min = null, max = null, description = '' }) {
  return {
    id, abbr, category: 'additional', kind: 'curve', group: null, custom: true, scale,
    range: min == null && max == null ? null : [min ?? -Infinity, max ?? Infinity],
    customUnit: unit || '',
    name: { en: name, ar: name }, description: { en: description, ar: description },
    use: [], aliases: [abbr.toLowerCase()],
    limitations: { en: 'User-defined curve: no built-in interpretation.', ar: 'منحنى معرّف من المستخدم: لا يوجد تفسير مدمج.' },
  };
}

export const getLog = (id, custom = []) => [...ALL_BUILTIN, ...custom].find((l) => l.id === id) || null;
export const logName = (def, lang) => def.name[lang] || def.name.en;
export const canonicalUnitOf = (def) => (def.group ? canonicalUnit(def.group) : def.customUnit);
export const acceptedUnitsOf = (def) => (def.group ? unitsFor(def.group) : [def.customUnit].filter(Boolean));
export const interpretationAvailable = (def) => def.use.length > 0;

/** Validation rule: returns null if OK, else an error code. Value is in the CANONICAL unit. */
export function validateCurveValue(def, v) {
  if (!Number.isFinite(v)) return 'not_number';
  if (def.scale === 'log' && v <= 0) return 'log_nonpositive';
  if (def.range && (v < def.range[0] || v > def.range[1])) return 'out_of_range';
  return null;
}

/** Header normalisation for auto-mapping (lowercase, strip units/brackets/non-alphanumerics). */
export const normalizeHeader = (h) =>
  String(h ?? '').toLowerCase().replace(/[([].*?[)\]]/g, '').replace(/[^a-z0-9]/g, '');

export function guessCurve(header, custom = []) {
  const n = normalizeHeader(header);
  if (!n) return null;
  const hit = [...BUILTIN_LOGS, ...custom].find((l) => l.aliases.map(normalizeHeader).includes(n) || normalizeHeader(l.abbr) === n);
  return hit ? hit.id : null;
}
