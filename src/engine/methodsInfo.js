// Documentation of every scientific method used by the engine (bilingual). Used by the UI and by
// the PDF report ("Scientific equations", "Calculation assumptions", "Uncertainty").
// Equations are plain text on purpose. Constants of empirical correlations must be verified against
// the reference the user's organisation follows; the source field says where each comes from.

const m = (name, equation, source, assumptions, uncertainty, validity) => ({ name, equation, source, assumptions, uncertainty, validity });

export const METHOD_INFO = {
  arps: m(
    { en: 'Arps temperature correction of water/mud resistivity', ar: 'تصحيح أرپس لمقاومية المياه/الطين مع الحرارة' },
    'R2 = R1 · (T1 + 21.5) / (T2 + 21.5)   [T in °C]   (T + 6.77 for °F)',
    'Arps (1953), widely used empirical relation',
    { en: ['Solution is predominantly NaCl.', 'Valid for a single solution; mixtures of salts differ.'], ar: ['المحلول غالبًا كلوريد صوديوم.', 'صالح لمحلول واحد؛ تختلف خلائط الأملاح.'] },
    { en: '≈ ±3–5 % for NaCl brines in 15–150 °C', ar: '≈ ±3–5 % لمحاليل NaCl بين 15 و150 °م' },
    { en: 'Temperatures roughly −5 to 200 °C', ar: 'درجات حرارة من −5 إلى 200 °م تقريبًا' },
  ),
  rt_none: m(
    { en: 'Apparent resistivity (no correction declared)', ar: 'مقاومية ظاهرية (بدون تصحيح معلَن)' },
    'Ra = measured reading   (Rt is NOT available)', 'Measured value',
    { en: ['The reading is apparent and is not equated with true formation resistivity.'], ar: ['القراءة ظاهرية ولا تُعادَل بالمقاومية الحقيقية للتكوين.'] },
    { en: 'Not quantified', ar: 'غير مقدّر' }, { en: 'n/a', ar: 'لا ينطبق' },
  ),
  rt_direct: m(
    { en: 'Deep reading taken as Rt (user-asserted conditions)', ar: 'اعتبار القراءة العميقة Rt (بشروط يقرّها المستخدم)' },
    'Rt ≈ Ra(deep)   only if: thick bed, negligible invasion/borehole effect', 'User assertion',
    { en: ['The user confirmed thick bed, negligible invasion effect and negligible borehole effect.'], ar: ['أكّد المستخدم سماكة الطبقة وإهمال تأثير الاختراق وتأثير الحفرة.'] },
    { en: 'Unquantified; may be ±20 % or worse if the conditions are not met', ar: 'غير مقدّر؛ قد يبلغ ±20 % أو أكثر إن لم تتحقق الشروط' },
    { en: 'Only when all three conditions hold', ar: 'فقط عند تحقق الشروط الثلاثة' },
  ),
  rt_geometric: m(
    { en: 'Rt from deep reading, Rxo and geometric factor', ar: 'حساب Rt من القراءة العميقة وRxo والعامل الهندسي' },
    'Ra = J·Rxo + (1 − J)·Rt   →   Rt = (Ra − J·Rxo) / (1 − J)', 'Doll/Gearhart geometric (integrated) response model',
    { en: ['J (integrated geometric factor) taken from the tool chart for the assumed invasion diameter.', 'Step-profile invasion.'], ar: ['J (العامل الهندسي المتكامل) من مخطط الأداة لقطر الاختراق المفترض.', 'اختراق بنمط درجي.'] },
    { en: 'Grows quickly as J → 1; depends on the accuracy of Rxo and J', ar: 'يزداد سريعًا عند اقتراب J من 1؛ يعتمد على دقة Rxo وJ' },
    { en: '0 ≤ J < 1', ar: '0 ≤ J < 1' },
  ),
  rt_factor: m(
    { en: 'Environmental/borehole correction by chart factor', ar: 'تصحيح بيئي/حفرة بعامل مخطط' },
    'Rc = K · Ra   (K read from the tool-specific correction chart)', 'Tool manufacturer correction chart (cited by the user)',
    { en: ['K is applicable to this tool, hole size, mud resistivity and standoff.'], ar: ['العامل K ينطبق على هذه الأداة وقطر الحفرة ومقاومية الطين والابتعاد.'] },
    { en: 'Chart-reading error, typically a few percent', ar: 'خطأ قراءة المخطط، غالبًا بضعة بالمئة' },
    { en: 'K > 0', ar: 'K > 0' },
  ),
  rw_manual: m(
    { en: 'Rw from a water sample / known value', ar: 'Rw من عينة مياه / قيمة معروفة' },
    'Rw(T) = Rw(Tref) · (Tref + 21.5) / (T + 21.5)', 'Direct measurement (user), temperature by Arps',
    { en: ['The sample represents formation water of the interval.', 'Measured resistivity and its temperature are both known.'], ar: ['العينة تمثل ماء تكوين المقطع.', 'مقاومية القياس وحرارته معروفتان.'] },
    { en: 'Depends on sampling quality (mixing, mud contamination)', ar: 'يعتمد على جودة أخذ العينة (اختلاط، تلوث بالطين)' },
    { en: 'Tref and T within Arps range', ar: 'Tref وT ضمن مدى أرپس' },
  ),
  rw_sp: m(
    { en: 'Rw from the Spontaneous Potential (SP)', ar: 'Rw من الجهد الذاتي (SP)' },
    'K = 65 + 0.24·T(°C);  Rwe = Rmfe · 10^(SSP/K);  Rw = (Rwe75 + 0.131·10^(1/log10(T°F/19.9) − 2)) / (−0.5·Rwe75 + 10^(0.0426/log10(T°F/50.8)))',
    'Schlumberger SP interpretation (Bateman & Konen 1977 fit); verify constants against your chartbook',
    { en: ['Clean thick permeable bed with a shale baseline.', 'NaCl solutions; no streaming potential or invasion effects.', 'Rmfe = 0.85·Rmf when Rmf(75°F) > 0.1 Ω·m (otherwise chart needed).'], ar: ['طبقة نفاذة نظيفة سميكة مع خط أساس للطين.', 'محاليل NaCl؛ لا جهد انسياب ولا تأثير اختراق.', 'Rmfe = 0.85·Rmf عندما Rmf(75°ف) > 0.1 Ω·م (وإلا يلزم مخطط).'] },
    { en: 'Typically ±20–50 % on Rw; poor in fresh water or when mud and formation salinity are similar', ar: 'غالبًا ±20–50 % على Rw؛ ضعيف في المياه العذبة أو عند تقارب ملوحة الطين والتكوين' },
    { en: 'SSP < 0 (Rmf > Rw); Rwe(75°F) > 0.12 Ω·m', ar: 'SSP < 0 (Rmf > Rw)؛ Rwe(75°ف) > 0.12 Ω·م' },
  ),
  rwa: m(
    { en: 'Apparent water resistivity (Rwa) and its minimum', ar: 'مقاومية المياه الظاهرية (Rwa) وحدها الأدنى' },
    'Rwa = Rt · φ^m / a   (Archie with Sw = 1);   Rw ≈ min(Rwa) in a clean wet zone', 'Archie (1942) rearranged',
    { en: ['The chosen interval is 100 % water-saturated and clean.', 'Archie parameters a, m are valid.'], ar: ['المقطع المختار مشبع بالماء 100 % ونظيف.', 'معاملات أرتشي a وm صالحة.'] },
    { en: 'Overestimates Rw if the zone contains hydrocarbons or clay', ar: 'يبالغ في Rw إن وُجدت هيدروكربونات أو طين' },
    { en: 'Vsh below the clean limit; φ > 0', ar: 'Vsh أقل من حد النظافة؛ φ > 0' },
  ),
  igr: m(
    { en: 'Gamma-ray index', ar: 'مؤشر أشعة جاما' },
    'IGR = (GR − GRclean) / (GRshale − GRclean)   (clipped to 0–1)', 'Standard',
    { en: ['GRclean and GRshale are valid baselines for this interval and tool.'], ar: ['GRclean وGRshale خطّا أساس صالحان لهذا المقطع والأداة.'] },
    { en: 'Dominated by baseline choice (±5–10 % of IGR)', ar: 'يتحكم فيه اختيار خطي الأساس (±5–10 % من IGR)' }, { en: 'GRshale > GRclean', ar: 'GRshale > GRclean' },
  ),
  vsh_linear: m({ en: 'Vshale – linear', ar: 'Vshale – خطي' }, 'Vsh = IGR', 'Standard', { en: ['Upper bound of shale volume.'], ar: ['حد أعلى لحجم الطين.'] }, { en: 'Overestimates Vsh', ar: 'يبالغ في Vsh' }, { en: '0–1', ar: '0–1' }),
  vsh_larionov_tertiary: m({ en: 'Vshale – Larionov (Tertiary)', ar: 'Vshale – لاريونوف (ثلاثي)' }, 'Vsh = 0.083 · (2^(3.7·IGR) − 1)', 'Larionov (1969)', { en: ['Tertiary / unconsolidated rocks.'], ar: ['صخور ثلاثية / غير متماسكة.'] }, { en: 'Empirical', ar: 'تجريبي' }, { en: '0–1', ar: '0–1' }),
  vsh_larionov_older: m({ en: 'Vshale – Larionov (older rocks)', ar: 'Vshale – لاريونوف (صخور أقدم)' }, 'Vsh = 0.33 · (2^(2·IGR) − 1)', 'Larionov (1969)', { en: ['Consolidated / pre-Tertiary rocks.'], ar: ['صخور متماسكة / أقدم من الثلاثي.'] }, { en: 'Empirical', ar: 'تجريبي' }, { en: '0–1', ar: '0–1' }),
  vsh_clavier: m({ en: 'Vshale – Clavier', ar: 'Vshale – كلافييه' }, 'Vsh = 1.7 − √(3.38 − (IGR + 0.7)²)', 'Clavier et al. (1971)', { en: ['Empirical curve.'], ar: ['منحنى تجريبي.'] }, { en: 'Empirical', ar: 'تجريبي' }, { en: '0–1', ar: '0–1' }),
  vsh_steiber: m({ en: 'Vshale – Steiber', ar: 'Vshale – شتايبر' }, 'Vsh = IGR / (3 − 2·IGR)', 'Steiber (1973)', { en: ['Empirical curve.'], ar: ['منحنى تجريبي.'] }, { en: 'Empirical', ar: 'تجريبي' }, { en: '0–1', ar: '0–1' }),
  vsh_sp: m({ en: 'Vshale – SP linear', ar: 'Vshale – SP خطي' }, 'Vsh = (SP − SPclean) / (SPshale − SPclean)', 'Standard', { en: ['SP baselines valid; salinity contrast adequate.'], ar: ['خطّا أساس SP صالحان؛ تباين الملوحة كافٍ.'] }, { en: 'Poor when mud/water salinity contrast is low', ar: 'ضعيف عند ضعف تباين الملوحة' }, { en: '0–1', ar: '0–1' }),
  phi_density: m({ en: 'Density porosity', ar: 'مسامية الكثافة' }, 'φD = (ρma − ρb) / (ρma − ρf)', 'Standard', { en: ['Matrix density ρma and fluid density ρf are correct for the lithology and fluid.'], ar: ['كثافة الصخر ρma وكثافة السائل ρf صحيحتان لنوع الصخر والسائل.'] }, { en: '±0.02–0.03 porosity units for ±0.05 g/cm³ error in ρma', ar: '±0.02–0.03 وحدة مسامية لكل ±0.05 جم/سم³ خطأ في ρma' }, { en: '0 ≤ φ ≤ 1 (clipped, flagged)', ar: '0 ≤ φ ≤ 1 (يُقصّ ويُعلَّم)' }),
  phi_sonic_wyllie: m({ en: 'Sonic porosity – Wyllie time average', ar: 'المسامية الصوتية – متوسط زمن ويلي' }, 'φS = (Δt − Δtma) / (Δtf − Δtma) / Cp', 'Wyllie et al. (1956)', { en: ['Consolidated, compacted, clean formations.', 'Cp = 1 when no compaction correction is wanted.'], ar: ['تكوينات متماسكة ومضغوطة ونظيفة.', 'Cp = 1 عند عدم الرغبة في تصحيح الانضغاط.'] }, { en: 'Overestimates in unconsolidated rocks', ar: 'يبالغ في الصخور غير المتماسكة' }, { en: '0 ≤ φ ≤ 1', ar: '0 ≤ φ ≤ 1' }),
  phi_sonic_rhg: m({ en: 'Sonic porosity – Raymer-Hunt-Gardner', ar: 'المسامية الصوتية – رايمر-هانت-غاردنر' }, 'φS = 0.625 · (Δt − Δtma) / Δt', 'Raymer, Hunt & Gardner (1980)', { en: ['Empirical for clean consolidated formations.'], ar: ['تجريبي للتكوينات النظيفة المتماسكة.'] }, { en: 'Empirical, typically ±0.02–0.03', ar: 'تجريبي، غالبًا ±0.02–0.03' }, { en: '0 ≤ φ ≤ 1', ar: '0 ≤ φ ≤ 1' }),
  phi_neutron: m({ en: 'Neutron porosity (as logged)', ar: 'المسامية النيوترونية (كما سُجّلت)' }, 'φ = φN', 'Tool reading', { en: ['Log is calibrated in the lithology chosen by the user.'], ar: ['السجل معايَر بنوع الصخر الذي يحدده المستخدم.'] }, { en: 'Affected by clay-bound water and gas', ar: 'يتأثر بالماء المرتبط بالطين وبالغاز' }, { en: '−0.05 … 1', ar: '−0.05 … 1' }),
  phi_neutron_density: m({ en: 'Neutron–density porosity', ar: 'مسامية النيوترون–الكثافة' }, 'φND = √((φN² + φD²) / 2)', 'Standard (liquid-filled formations)', { en: ['Liquid-filled; both logs on the same lithology matrix.', 'Gas: φN < φD (crossover) — result flagged.'], ar: ['تكوين مملوء بسائل؛ السجلان على نفس مصفوفة الصخر.', 'الغاز: φN < φD (تقاطع) — تُعلَّم النتيجة.'] }, { en: 'Reduced lithology sensitivity vs single logs', ar: 'حساسية أقل لنوع الصخر مقارنة بسجل واحد' }, { en: '0 ≤ φ ≤ 1', ar: '0 ≤ φ ≤ 1' }),
  phi_effective: m({ en: 'Effective porosity', ar: 'المسامية الفعالة' }, 'φe = φt − Vsh · φsh', 'Standard shale correction', { en: ['φsh (porosity of the shale) is supplied by the user.'], ar: ['φsh (مسامية الطين) يحددها المستخدم.'] }, { en: 'Depends on φsh and Vsh', ar: 'تعتمد على φsh وVsh' }, { en: 'φe ≥ 0', ar: 'φe ≥ 0' }),
  formation_factor: m({ en: 'Formation factor', ar: 'عامل التكوين' }, 'F = a / φ^m    (= Ro / Rw)', 'Archie (1942)', { en: ['a and m valid for this formation.'], ar: ['a وm صالحان لهذا التكوين.'] }, { en: 'Depends on a, m, φ', ar: 'يعتمد على a وm وφ' }, { en: 'φ > 0', ar: 'φ > 0' }),
  sw_archie: m({ en: 'Water saturation – Archie', ar: 'تشبع الماء – أرتشي' }, 'Sw = ( a · Rw / (φ^m · Rt) )^(1/n)', 'Archie (1942)',
    { en: ['Clean (non-clayey) formation: applied only when Vsh ≤ the clean limit.', 'Rt is true formation resistivity (not apparent).', 'a, m, n valid for this formation.'], ar: ['تكوين نظيف (غير طيني): يُطبَّق فقط عندما Vsh ≤ حد النظافة.', 'Rt هي المقاومية الحقيقية (ليست ظاهرية).', 'a وm وn صالحة لهذا التكوين.'] },
    { en: 'Sw error ≈ ½·(relative errors of Rw, Rt, φ^m) for n = 2', ar: 'خطأ Sw ≈ ½ مجموع الأخطاء النسبية لـ Rw وRt وφ^m عندما n = 2' }, { en: '0 < φ ≤ 1, Rt > 0, Rw > 0', ar: '0 < φ ≤ 1، Rt > 0، Rw > 0' }),
  sw_simandoux: m({ en: 'Water saturation – Simandoux (n = 2)', ar: 'تشبع الماء – سيماندو (n = 2)' }, '1/Rt = φ^m·Sw² / (a·Rw) + Vsh·Sw / Rsh   (solved for Sw)', 'Simandoux (1963), quadratic form',
    { en: ['Shaly sand; n = 2.', 'Rsh is the resistivity of adjacent shale.'], ar: ['رمل طيني؛ n = 2.', 'Rsh مقاومية الطين المجاور.'] },
    { en: 'Sensitive to Rsh and Vsh', ar: 'حساس لـ Rsh وVsh' }, { en: 'Rsh > 0, φ > 0', ar: 'Rsh > 0، φ > 0' }),
  sw_indonesia: m({ en: 'Water saturation – Indonesia (Poupon-Leveaux)', ar: 'تشبع الماء – إندونيسيا (بوبون-ليفو)' }, '1/√Rt = [ Vsh^(1 − Vsh/2) / √Rsh + φ^(m/2) / √(a·Rw) ] · Sw^(n/2)', 'Poupon & Leveaux (1971)',
    { en: ['Shaly sand; also usable in fresh formation water.'], ar: ['رمل طيني؛ ويصلح أيضًا مع ماء التكوين العذب.'] },
    { en: 'Sensitive to Rsh and Vsh', ar: 'حساس لـ Rsh وVsh' }, { en: 'Rsh > 0, φ > 0', ar: 'Rsh > 0، φ > 0' }),
};
