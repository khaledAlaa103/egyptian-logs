// Bilingual documentation of the water-quality methods (equation, source, assumptions, uncertainty,
// validity). Shown in the UI next to each result and reused by the PDF report.
const m = (name, equation, source, assumptions, uncertainty, validity) => ({ name, equation, source, assumptions, uncertainty, validity });

export const WATER_INFO = {
  rw_to_ec: m(
    { en: 'Water resistivity ↔ electrical conductivity', ar: 'مقاومية الماء ↔ الموصلية الكهربائية' },
    'EC [mS/m] = 1000 / Rw [Ω·m]     (1 mS/m = 10 µS/cm)', 'Definition (conductivity = 1 / resistivity)',
    { en: ['Both values refer to the same temperature.'], ar: ['القيمتان عند نفس درجة الحرارة.'] },
    { en: 'None beyond the uncertainty of Rw', ar: 'لا شيء يتجاوز عدم يقين Rw' }, { en: 'Rw > 0', ar: 'Rw > 0' },
  ),
  ec_normalize_alpha: m(
    { en: 'EC normalisation to 25 °C – linear coefficient', ar: 'تطبيع EC إلى 25 °م – معامل خطي' },
    'EC25 = EC(T) / (1 + α · (T − 25))', 'Standard practice; α is chosen/recorded by the user (typically ≈ 0.019–0.021 /°C for natural waters)',
    { en: ['A single constant α describes the water over the temperature range.'], ar: ['معامل α ثابت واحد يصف الماء عبر مدى الحرارة.'] },
    { en: 'A ±0.002 /°C error in α gives ≈ ±2 % at 10 °C from 25 °C', ar: 'خطأ ±0.002 في α يعطي ≈ ±2 % عند 10 °م عن 25 °م' }, { en: 'Roughly 0–50 °C', ar: 'تقريبًا 0–50 °م' },
  ),
  ec_normalize_arps: m(
    { en: 'EC normalisation to 25 °C – Arps (NaCl)', ar: 'تطبيع EC إلى 25 °م – أرپس (NaCl)' },
    'R25 = R(T) · (T + 21.5) / (25 + 21.5);  EC25 = 1 / R25', 'Arps (1953)',
    { en: ['Solution behaves like sodium chloride.'], ar: ['المحلول يسلك سلوك كلوريد الصوديوم.'] },
    { en: '≈ ±3–5 % for NaCl brines', ar: '≈ ±3–5 % لمحاليل NaCl' }, { en: 'About −5 to 150 °C', ar: 'من −5 إلى 150 °م تقريبًا' },
  ),
  tds_factor: m(
    { en: 'TDS from EC25 – proportional factor', ar: 'TDS من EC25 – معامل تناسب' },
    'TDS [mg/L] = k · EC25 [µS/cm]', 'Local calibration (least squares through the origin) or a cited published factor',
    { en: ['The ionic composition of the water is similar to that of the calibration samples.', 'EC25 is within the calibration range.'], ar: ['التركيب الأيوني للماء مشابه لعينات المعايرة.', 'EC25 ضمن مدى المعايرة.'] },
    { en: 'Relative RMSE of the calibration (shown with the result); not valid across different water types', ar: 'جذر متوسط مربع الخطأ النسبي للمعايرة (يظهر مع النتيجة)؛ غير صالح بين أنواع مياه مختلفة' },
    { en: 'Within the EC range of the calibration samples', ar: 'ضمن مدى EC لعينات المعايرة' },
  ),
  tds_linear: m(
    { en: 'TDS from EC25 – linear calibration', ar: 'TDS من EC25 – معايرة خطية' },
    'TDS = a + b · EC25', 'Local calibration (ordinary least squares)',
    { en: ['Same water family as the calibration samples.'], ar: ['نفس عائلة المياه كعينات المعايرة.'] },
    { en: 'Relative RMSE of the calibration', ar: 'جذر متوسط مربع الخطأ النسبي للمعايرة' }, { en: 'Within the calibration EC range', ar: 'ضمن مدى EC للمعايرة' },
  ),
  tds_power: m(
    { en: 'TDS from EC25 – power-law calibration', ar: 'TDS من EC25 – معايرة قانون القوة' },
    'TDS = c · EC25^d   (fitted on ln–ln)', 'Local calibration (log–log least squares)',
    { en: ['Same water family as the calibration samples.'], ar: ['نفس عائلة المياه كعينات المعايرة.'] },
    { en: 'Relative RMSE of the calibration', ar: 'جذر متوسط مربع الخطأ النسبي للمعايرة' }, { en: 'Within the calibration EC range', ar: 'ضمن مدى EC للمعايرة' },
  ),
  nacl_equiv: m(
    { en: 'NaCl-equivalent salinity from Rw (empirical chart fit)', ar: 'الملوحة المكافئة لـ NaCl من Rw (ملاءمة مخطط تجريبية)' },
    'Rw75 = Rw at 75 °F (Arps);  C [ppm NaCl] = 10^((3.562 − log10(Rw75 − 0.0123)) / 0.955)', 'Empirical fit of the Schlumberger NaCl resistivity–salinity chart; verify against your chartbook',
    { en: ['The water is a NaCl solution: the result is an equivalent, NOT the TDS of a natural water.'], ar: ['الماء محلول NaCl: النتيجة مكافئ وليست TDS لماء طبيعي.'] },
    { en: 'Typically ±10–20 % for NaCl brines; larger for natural waters with other ions', ar: 'غالبًا ±10–20 % لمحاليل NaCl؛ أكبر للمياه الطبيعية ذات الأيونات الأخرى' },
    { en: 'Rw75 > 0.0123 Ω·m; best between about 0.03 and 20 Ω·m', ar: 'Rw75 > 0.0123 Ω·م؛ الأفضل بين نحو 0.03 و20 Ω·م' },
  ),
  class_winslow: m(
    { en: 'Salinity class (informational)', ar: 'صنف الملوحة (للعلم)' },
    'fresh < 1,000 < slightly saline ≤ 3,000 < moderately saline ≤ 10,000 < very saline ≤ 35,000 < brine   [mg/L TDS]', 'Winslow & Kister (1956), as used by the USGS',
    { en: ['Classification by TDS only; not a drinking-water or irrigation suitability statement.'], ar: ['تصنيف بالـ TDS فقط؛ وليس حكمًا على صلاحية الشرب أو الري.'] },
    { en: 'Inherits the uncertainty of TDS', ar: 'يرث عدم يقين TDS' }, { en: 'TDS > 0', ar: 'TDS > 0' },
  ),
};
