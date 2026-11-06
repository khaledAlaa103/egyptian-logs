import { STATUS_CODE, SECTION_IDS } from './model.js';

const CODE_CLASS = { M: 'st-measured', C: 'st-corrected', K: 'st-calculated', E: 'st-estimated', U: 'st-user' };

function Cell({ c }) {
  if (c && typeof c === 'object') return <>{c.t}<sup className={`stc ${CODE_CLASS[STATUS_CODE[c.s]]}`}>{STATUS_CODE[c.s]}</sup></>;
  return <>{c}</>;
}

function Block({ b, figures }) {
  switch (b.type) {
    case 'cover':
      return (
        <div className="r-cover" data-keep>
          <div className="r-mark">WL</div>
          <h1>{b.title}</h1>
          <h2>{b.subtitle}</h2>
          <dl>
            {b.project && <><dt>●</dt><dd>{b.project}</dd></>}
            {b.company && <><dt>●</dt><dd>{b.company}</dd></>}
            {b.date && <><dt>●</dt><dd dir="ltr">{b.date}</dd></>}
            {b.preparedBy && <><dt>●</dt><dd>{b.preparedBy}</dd></>}
            {b.reviewedBy && <><dt>●</dt><dd>{b.reviewedBy}</dd></>}
          </dl>
        </div>
      );
    case 'legend':
      return (
        <div className="r-legend" data-keep>
          <strong>{b.title}</strong>
          <div>{b.items.map((i) => <span key={i.code} className="r-leg"><sup className={`stc ${CODE_CLASS[i.code]}`}>{i.code}</sup> {i.label}</span>)}</div>
          <small>{b.note}</small>
        </div>
      );
    case 'kv':
      return (
        <table className="r-kv"><tbody>{b.rows.map(([k, v]) => <tr key={k} data-keep><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
      );
    case 'table':
      return (
        <div className={`r-tablewrap${b.dense ? ' dense' : ''}`}>
          {b.caption && <div className="r-caption" data-keep data-heading>{b.caption}</div>}
          <table className="r-table">
            <thead><tr data-keep>{b.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i} data-keep>{r.map((c, j) => <td key={j}><Cell c={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case 'p': return <p className="r-p" data-keep>{b.text}</p>;
    case 'list': return <ul className="r-list">{b.items.map((t, i) => <li key={i} data-keep>{t}</li>)}</ul>;
    case 'notice': return <p className={`r-notice ${b.kind}`} data-keep>{b.text}</p>;
    case 'author': return <div className="r-author" data-keep><strong>{b.title}</strong><p>{b.text}</p></div>;
    case 'methods':
      return (
        <div className="r-methods">{b.items.map((m) => (
          <div className="r-method" key={m.id} data-keep>
            <strong>{m.name}</strong>
            <div dir="ltr" className="r-eq">{m.equation}</div>
            <small>{m.source} — {m.validity}</small>
          </div>
        ))}</div>
      );
    case 'figure': {
      const f = figures?.[b.fig];
      const list = Array.isArray(f) ? f : f ? [{ dataUrl: f }] : [];
      if (!list.length) return null;
      return (
        <figure className="r-fig" data-keep>
          {list.map((x, i) => <img key={i} src={x.dataUrl} alt={b.caption} />)}
          <figcaption>{b.caption}</figcaption>
        </figure>
      );
    }
    default: return null;
  }
}

/** Renders the report model. `figures` = { log, images:[{dataUrl}], scatter } (data URLs). */
export default function ReportDocument({ model, figures }) {
  const firstAfterCover = model.sections.find((x) => x.id !== 'cover')?.id;
  return (
    <div className="rdoc" dir={model.dir} lang={model.lang}>
      {model.sections.map((s) => (
        <section className="r-sec" key={s.id} data-section={s.id}>
          {s.id !== 'cover' && <h2 className="r-h" data-keep data-heading {...(s.id === firstAfterCover ? { 'data-pagebreak': '' } : {})}>{SECTION_IDS.indexOf(s.id) + 1}. {s.title}</h2>}
          {s.blocks.map((b, i) => <Block key={i} b={b} figures={figures} />)}
        </section>
      ))}
    </div>
  );
}
