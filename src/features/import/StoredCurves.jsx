import { useLiveQuery } from 'dexie-react-hooks';
import { listWellCurves, deleteCurve } from '../../db/curves.js';
import { getLog, logName } from '../../registry/logRegistry.js';
import { unitLabel } from '../../engine/units/units.js';
import { usePrefs } from '../../app/PrefsContext.jsx';

const f = (n) => Number(n.toPrecision(6)).toString();

/** Lists curves already stored for the well, with their source (traceability). */
export default function StoredCurves({ wellPk, custom }) {
  const { t, lang } = usePrefs();
  const list = useLiveQuery(() => listWellCurves(wellPk), [wellPk], []);
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h2>{t('imp.stored')}</h2>
      {list.length === 0 ? <p className="muted">{t('imp.storedEmpty')}</p> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('imp.curve')}</th><th>{t('imp.source')}</th><th className="num">{t('imp.points')}</th>
              <th>{t('imp.depthRange')}</th><th>{t('imp.unitStored')}</th><th /></tr></thead>
            <tbody>
              {list.map((r) => {
                const d = getLog(r.curveId, custom);
                return (
                  <tr key={r.id}>
                    <td data-label={t('imp.curve')}><strong>{d?.abbr || r.curveId}</strong> {d && logName(d, lang)}</td>
                    <td data-label={t('imp.source')}>{t(`imp.sources.${r.source}`)}{r.meta?.fileName ? ` · ${r.meta.fileName}` : ''}</td>
                    <td className="num" data-label={t('imp.points')}>{r.depth.length}</td>
                    <td data-label={t('imp.depthRange')} dir="ltr">{f(r.depth[0])} – {f(r.depth[r.depth.length - 1])} m</td>
                    <td data-label={t('imp.unitStored')}>{unitLabel(r.unit)}</td>
                    <td className="row-actions">
                      <button className="btn sm danger" onClick={() => window.confirm(t('imp.confirmDeleteCurve')) && deleteCurve(wellPk, r.curveId)}>
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
