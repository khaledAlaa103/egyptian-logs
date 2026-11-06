import { useEffect, useRef, useState } from 'react';
import { COL, formatCell } from '../../results/columns.js';

const STATUS_CLASS = { measured: 'st-measured', corrected: 'st-corrected', calculated: 'st-calculated', estimated: 'st-estimated', user: 'st-user' };

/**
 * Spreadsheet-like grid. The page owns data and validation; the grid owns navigation/editing UI.
 * onCommit(rowId, colId, text) -> Promise<{ok}|{error}> ; onPaste(matrix, r0, c0) ; onActive(rowId, colId)
 */
export default function ResultsGrid({
  rows, cols, units, label, statusTitle, sort, onSort, filters, onFilter, selected, onSelect, onCommit, onPaste, onActive, canEdit, errorText,
}) {
  const [active, setActive] = useState({ r: 0, c: 1 });
  const [anchor, setAnchor] = useState(null);
  const [edit, setEdit] = useState(null); // {r,c,text,error}
  const box = useRef(null);
  const editRef = useRef(null);
  const committing = useRef(false); // a commit is in flight: ignore re-entrant commits (Enter followed by blur)
  editRef.current = edit;
  // Focus the editor in the commit phase (not a later effect) so fast typing after the first key is not lost.
  const focusEditor = (el) => { if (el && document.activeElement !== el) { el.focus(); if (el.setSelectionRange && el.type !== 'number') { const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* not selectable */ } } } };
  useEffect(() => { // keep the active cell inside the table when data/columns change
    setActive((a) => ({ r: Math.min(a.r, Math.max(0, rows.length - 1)), c: Math.min(a.c, Math.max(0, cols.length - 1)) }));
  }, [rows.length, cols.length]);
  useEffect(() => { const row = rows[active.r]; if (row && cols[active.c]) onActive?.(row.id, cols[active.c]); }, [active.r, active.c, rows, cols]);  

  const editable = (r, c) => rows[r] && cols[c] && canEdit(cols[c]);
  const textOf = (r, c) => { const col = cols[c]; const cell = rows[r].cells[col]; return formatCell(col, cell.v, units[COL[col].group]); };
  const move = (dr, dc, extend) => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, active.r + dr)), c: Math.max(0, Math.min(cols.length - 1, active.c + dc)) };
    if (extend) setAnchor((a) => a || active); else setAnchor(null);
    setActive(next);
  };

  const startEdit = (r, c, initial) => {
    if (!editable(r, c)) return;
    setEdit({ r, c, text: initial ?? textOf(r, c), error: null });
  };

  const commit = async (moveAfter) => {
    const cur = editRef.current; // latest state, not the closure of the render that created this handler
    if (!cur || committing.current) return;
    committing.current = true;
    let res;
    try { res = await onCommit(rows[cur.r]?.id, cols[cur.c], cur.text); } finally { committing.current = false; }
    if (res?.error) { setEdit((e) => (e ? { ...e, error: res.error } : e)); return false; }
    setEdit(null);
    if (moveAfter) move(moveAfter === 'right' ? 0 : 1, moveAfter === 'right' ? 1 : 0);
    box.current?.focus();
    return true;
  };

  const range = () => {
    const a = anchor || active;
    return { r0: Math.min(a.r, active.r), r1: Math.max(a.r, active.r), c0: Math.min(a.c, active.c), c1: Math.max(a.c, active.c) };
  };
  const inRange = (r, c) => { const g = range(); return r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1; };

  // Keyboard/clipboard handling applies to the grid itself, never to inputs inside it (filters, cell editor).
  const fromInput = (e) => !!e.target.closest?.('input, select, textarea');
  const onKeyDown = (e) => {
    if (edit || fromInput(e)) return;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); move(1, 0, e.shiftKey); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0, e.shiftKey); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1, e.shiftKey); }
    else if (k === 'ArrowRight') { e.preventDefault(); move(0, 1, e.shiftKey); }
    else if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(active.r, active.c); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); const g = range(); for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) if (editable(r, c)) onCommit(rows[r].id, cols[c], ''); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { startEdit(active.r, active.c, k); e.preventDefault(); }
  };

  const onCopy = (e) => {
    if (edit || fromInput(e)) return;
    const g = range();
    const lines = [];
    for (let r = g.r0; r <= g.r1; r++) { const cells = []; for (let c = g.c0; c <= g.c1; c++) cells.push(textOf(r, c)); lines.push(cells.join('\t')); }
    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
  };
  const onPasteEvt = (e) => {
    if (edit || fromInput(e)) return;
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    const matrix = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1).map((l) => l.split('\t'));
    onPaste(matrix, active.r, active.c);
  };

  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="grid-box" ref={box} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPasteEvt}>
      <table className="sheet" role="grid" aria-label={label('title')}>
        <thead>
          <tr>
            <th className="rowsel"><input type="checkbox" checked={allSel} aria-label={label('selectAll')} onChange={(e) => onSelect(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
            {cols.map((c) => (
              <th key={c} style={{ minWidth: COL[c].width }} onClick={() => onSort(c)} className={`sortable${sort.col === c ? ' sorted' : ''}`} aria-sort={sort.col === c ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                {label(c)}{COL[c].group && units[COL[c].group] ? <small> ({label(`unit:${units[COL[c].group]}`)})</small> : null}
                {sort.col === c && <span aria-hidden="true"> {sort.dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
          <tr className="filters">
            <th />
            {cols.map((c) => (
              <th key={c}><input value={filters[c] || ''} aria-label={`${label('filter')} ${label(c)}`} placeholder={COL[c].type === 'number' ? '>10, 2..8' : ''} onChange={(e) => onFilter(c, e.target.value)} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.id} className={selected.has(row.id) ? 'is-sel' : ''}>
              <td className="rowsel"><input type="checkbox" checked={selected.has(row.id)} aria-label={`${label('select')} ${r + 1}`}
                onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(row.id); else n.delete(row.id); onSelect(n); }} /></td>
              {cols.map((c, ci) => {
                const cell = row.cells[c];
                const isActive = active.r === r && active.c === ci;
                const editing = edit && edit.r === r && edit.c === ci;
                const def = COL[c];
                const cls = ['cell', def.type === 'number' ? 'num' : '', STATUS_CLASS[cell.status] || '', cell.overridden ? 'overridden' : '', isActive ? 'active' : '', inRange(r, ci) && anchor ? 'inrange' : '', canEdit(c) ? '' : 'ro'].filter(Boolean).join(' ');
                return (
                  <td key={c} className={cls} title={cell.status && statusTitle ? statusTitle(cell) : undefined}
                    onMouseDown={(e) => { if (e.target.closest?.('input, select')) return; if (e.shiftKey) setAnchor((a) => a || active); else setAnchor(null); setActive({ r, c: ci }); box.current?.focus({ preventScroll: true }); if (edit && !(edit.r === r && edit.c === ci)) commit(); }}
                    onDoubleClick={() => startEdit(r, ci)}>
                    {editing ? (
                      def.type === 'enum' ? (
                        <select ref={focusEditor} value={edit.text} aria-label={`${label(c)} ${r + 1}`}
                          onChange={async (e) => { const t = e.target.value; setEdit({ ...edit, text: t }); const res = await onCommit(row.id, c, t); if (!res?.error) { setEdit(null); box.current?.focus(); } }}
                          onBlur={() => setEdit(null)} onKeyDown={(e) => { if (e.key === 'Escape') { setEdit(null); box.current?.focus(); } }}>
                          {def.allowEmpty && <option value="" />}
                          {def.options.map((o) => <option key={o} value={o}>{label(`opt:${c}:${o}`)}</option>)}
                        </select>
                      ) : (
                        <input ref={focusEditor} className={edit.error ? 'bad' : ''} dir={def.type === 'number' ? 'ltr' : undefined} value={edit.text} aria-label={`${label(c)} ${r + 1}`} aria-invalid={!!edit.error}
                          title={edit.error ? errorText(edit.error) : ''}
                          onChange={(e) => setEdit({ ...edit, text: e.target.value, error: null })}
                          onBlur={(e) => { if (e.relatedTarget !== box.current) commit(); }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
                            else if (e.key === 'Tab') { e.preventDefault(); commit('right'); }
                            else if (e.key === 'Escape') { setEdit(null); box.current?.focus(); }
                          }} />
                      )
                    ) : (
                      <span>{def.type === 'enum' ? (cell.v === '' ? '' : label(`opt:${c}:${cell.v}`)) : formatCell(c, cell.v, units[def.group])}{cell.overridden ? <sup title="manual">✎</sup> : null}</span>
                    )}
                    {editing && edit.error && <div className="cell-err" role="alert">{errorText(edit.error)}</div>}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="muted pad">{label('noRows')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
