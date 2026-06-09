import { useState, useEffect, useCallback } from 'react'
import TokenSetup from './components/TokenSetup.jsx'
import FilterBar from './components/FilterBar.jsx'
import RoleTable from './components/RoleTable.jsx'

const DIGEST_URL =
  'https://raw.githubusercontent.com/raelmiller/exec-search/main/data/digest.json'
const APPS_PATH = 'data/applications.json'
const REPO = 'raelmiller/exec-search'
const STATUSES = ['Watching', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Closed']

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('gh_pat') || '')
  const [showTokenSetup, setShowTokenSetup] = useState(false)
  const [digest, setDigest] = useState([])
  const [applications, setApplications] = useState({})
  const [appsSha, setAppsSha] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ tiers: [], statuses: [], query: '', newOnly: false, hideArchived: true })

  useEffect(() => {
    fetch(DIGEST_URL)
      .then(r => r.json())
      .then(d => setDigest(d.matches || []))
      .catch(() => setError('Could not load digest.json — run the monitor workflow first.'))
      .finally(() => setLoading(false))
  }, [])

  const loadApplications = useCallback(async (pat) => {
    if (!pat) return
    try {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${APPS_PATH}`,
        { headers: ghHeaders(pat) }
      )
      if (r.status === 404) return
      if (!r.ok) throw new Error(`GitHub API ${r.status}`)
      const json = await r.json()
      setAppsSha(json.sha)
      setApplications(JSON.parse(atob(json.content.replace(/\n/g, ''))))
    } catch (e) {
      console.error('load applications:', e)
    }
  }, [])

  useEffect(() => {
    loadApplications(token)
  }, [token, loadApplications])

  const saveApplications = useCallback(async (next) => {
    if (!token) { setShowTokenSetup(true); return }
    setSaving(true)
    try {
      const body = {
        message: 'chore: update application statuses',
        content: btoa(JSON.stringify(next, null, 2)),
        ...(appsSha ? { sha: appsSha } : {}),
      }
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${APPS_PATH}`,
        { method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(body) }
      )
      if (!r.ok) throw new Error(`GitHub API ${r.status}`)
      const json = await r.json()
      setAppsSha(json.content.sha)
      setApplications(next)
    } catch (e) {
      setError(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }, [token, appsSha])

  function handleStatusChange(id, status) {
    const next = { ...applications, [id]: { ...applications[id], status } }
    saveApplications(next)
  }

  function handleNoteChange(id, notes) {
    setApplications(prev => ({ ...prev, [id]: { ...prev[id], notes } }))
  }

  function handleNoteBlur(id) {
    saveApplications(applications)
  }

  function handleTokenSave(pat) {
    localStorage.setItem('gh_pat', pat)
    setToken(pat)
    setShowTokenSetup(false)
    loadApplications(pat)
  }

  const ARCHIVED = new Set(['Rejected', 'Closed'])
  const filtered = digest.filter(job => {
    const appStatus = applications[job.id]?.status || 'Watching'
    if (filters.hideArchived && ARCHIVED.has(appStatus)) return false
    if (filters.tiers.length && !filters.tiers.includes(job.role_tier)) return false
    if (filters.statuses.length && !filters.statuses.includes(appStatus)) return false
    if (filters.newOnly && !job.is_new) return false
    if (filters.query) {
      const q = filters.query.toLowerCase()
      if (!job.title.toLowerCase().includes(q) && !job.company.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="app">
      <header className="header">
        <h1>Role Monitor</h1>
        <button className="token-btn" onClick={() => setShowTokenSetup(true)}>
          {token ? '🔑 PAT set' : '🔓 Set PAT'}
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}
      {saving && <div className="banner saving">Saving…</div>}

      {showTokenSetup && (
        <TokenSetup
          current={token}
          onSave={handleTokenSave}
          onClose={() => setShowTokenSetup(false)}
        />
      )}

      <FilterBar
        tiers={[...new Set(digest.map(j => j.role_tier))].sort()}
        statuses={STATUSES}
        filters={filters}
        onChange={setFilters}
        total={digest.length}
        shown={filtered.length}
      />

      {loading ? (
        <p className="loading">Loading…</p>
      ) : (
        <RoleTable
          jobs={filtered}
          applications={applications}
          statuses={STATUSES}
          onStatusChange={handleStatusChange}
          onNoteChange={handleNoteChange}
          onNoteBlur={handleNoteBlur}
        />
      )}
    </div>
  )
}
