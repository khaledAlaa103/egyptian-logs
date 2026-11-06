import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { getCustomCurves } from '../../db/curves.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import WellPicker from './WellPicker.jsx';
import ManualEntry from './ManualEntry.jsx';
import TableImportWizard from './TableImportWizard.jsx';
import CustomCurveModal from './CustomCurveModal.jsx';
import StoredCurves from './StoredCurves.jsx';

const TABS = ['manual', 'excel', 'csv', 'image'];

export default function ImportPage() {
  const { t } = usePrefs();
  const [tab, setTab] = useState('manual');
  const [wellPk, setWellPk] = useState(null);
  const [showCustom, setShowCustom] = useState(false);
  const well = useLiveQuery(() => (wellPk ? db.wells.get(wellPk) : undefined), [wellPk]);
  const custom = useLiveQuery(() => getCustomCurves(), [], []);

  return (
    <section className="page">
      <div className="page-head">
        <h1>{t('nav.import')}</h1>
        <button className="btn" onClick={() => setShowCustom(true)}>+ {t('imp.customCurve')}</button>
      </div>
      <WellPicker value={wellPk} onChange={setWellPk} />

      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {t(`imp.tabs.${k}`)}
          </button>
        ))}
      </div>

      <div className="card">
        {tab === 'manual' && <ManualEntry well={well} custom={custom} />}
        {(tab === 'excel' || tab === 'csv') && (
          wellPk && well ? <TableImportWizard key={`${tab}-${wellPk}`} kind={tab} well={well} custom={custom} />
            : <p className="muted">{t('imp.selectWellFirst')}</p>
        )}
        {tab === 'image' && (
          <div className="empty"><span className="badge">{t('common.phase')} 5</span><p>{t('imp.imageLater')}</p></div>
        )}
      </div>

      {well && <StoredCurves wellPk={well.id} custom={custom} />}
      {showCustom && <CustomCurveModal onClose={() => setShowCustom(false)} />}
    </section>
  );
}
