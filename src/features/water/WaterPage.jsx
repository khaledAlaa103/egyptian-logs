import { useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import WellPicker from '../import/WellPicker.jsx';
import useWater from './useWater.js';
import SamplesTab from './SamplesTab.jsx';
import CalibrationTab from './CalibrationTab.jsx';
import EstimateTab from './EstimateTab.jsx';
import ConverterTab from './ConverterTab.jsx';

const TABS = ['samples', 'calibration', 'estimate', 'converter'];

export default function WaterPage() {
  const { t } = usePrefs();
  const [wellPk, setWellPk] = useState(null);
  const [tab, setTab] = useState('samples');
  const w = useWater(wellPk);

  return (
    <section className="page water-page">
      <div className="page-head"><h1>{t('nav.water')}</h1></div>
      <WellPicker value={wellPk} onChange={setWellPk} />
      {!wellPk && <div className="card empty"><p>{t('imp.selectWellFirst')}</p></div>}
      {wellPk && w.well && w.settings && (
        <>
          <div className="notice ok small">{t('wq.principles')}</div>
          <div className="tabs" role="tablist" style={{ marginTop: '.8rem' }}>
            {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{t(`wq.tabs.${k}`)}</button>)}
          </div>
          {tab === 'samples' && <SamplesTab w={w} />}
          {tab === 'calibration' && <CalibrationTab w={w} />}
          {tab === 'estimate' && <EstimateTab w={w} />}
          {tab === 'converter' && <ConverterTab w={w} />}
        </>
      )}
    </section>
  );
}
