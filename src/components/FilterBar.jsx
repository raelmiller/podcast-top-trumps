export default function FilterBar({ tiers, statuses, filters, onChange, total, shown }) {
  function set(key, val) {
    onChange(prev => ({ ...prev, [key]: val }))
  }

  return (
    <div className="filter-bar">
      <input
        type="text"
        placeholder="Search title or company…"
        value={filters.query}
        onChange={e => set('query', e.target.value)}
      />
      <select
        multiple
        value={filters.tiers}
        onChange={e => set('tiers', [...e.target.selectedOptions].map(o => o.value))}
        style={{ height: 'auto', minWidth: 120 }}
        title="Ctrl/Cmd+click to select multiple"
      >
        {tiers.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select
        multiple
        value={filters.statuses}
        onChange={e => set('statuses', [...e.target.selectedOptions].map(o => o.value))}
        style={{ height: 'auto', minWidth: 120 }}
        title="Ctrl/Cmd+click to select multiple"
      >
        {statuses.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <label className="new-filter">
        <input type="checkbox" checked={filters.newOnly || false} onChange={e => set('newOnly', e.target.checked)} />
        {' '}New only
      </label>
      <label className="new-filter">
        <input type="checkbox" checked={filters.hideArchived !== false} onChange={e => set('hideArchived', e.target.checked)} />
        {' '}Hide closed/rejected
      </label>
      <span className="count">{shown} / {total} roles</span>
    </div>
  )
}
