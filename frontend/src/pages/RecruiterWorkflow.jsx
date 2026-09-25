/**
 * Recruiter Workflow — Kanban pipeline.
 * Stages: Applied → Screening → Interview → Offer → Rejected
 * Drag candidates between columns (or use move buttons).
 * State is local (localStorage persisted) for the MVP.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listJobs, getMatches } from '../api/client'
import Spinner from '../components/Spinner'
import { ChevronRight, ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react'

const STAGES = [
  { id: 'applied',    label: 'Applied',    color: 'bg-gray-100    text-gray-600',  dot: 'bg-gray-400'    },
  { id: 'screening',  label: 'Screening',  color: 'bg-blue-100   text-blue-700',   dot: 'bg-blue-500'    },
  { id: 'interview',  label: 'Interview',  color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500'  },
  { id: 'offer',      label: 'Offer',      color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { id: 'rejected',   label: 'Rejected',   color: 'bg-red-100    text-red-600',    dot: 'bg-red-400'     },
]

const STORAGE_KEY = 'fairmatch_pipeline'

function loadPipeline() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  catch { return {} }
}
function savePipeline(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

export default function RecruiterWorkflow() {
  const navigate = useNavigate()
  const [loading,   setLoading]   = useState(true)
  const [candidates, setCandidates] = useState([])  // [{id, name, filename, score, jobTitle}]
  const [pipeline,  setPipeline]  = useState(loadPipeline)
  const [selJob,    setSelJob]    = useState('all')
  const [jobs,      setJobs]      = useState([])

  useEffect(() => {
    async function load() {
      try {
        const jRes = await listJobs()
        setJobs(jRes.data)
        const all = []
        for (const job of jRes.data) {
          try {
            const mRes = await getMatches(job.id)
            for (const r of mRes.data.results ?? []) {
              if (!all.find(c => c.id === r.candidate_id)) {
                all.push({
                  id:       r.candidate_id,
                  name:     r.name_redacted ?? `Candidate ${r.candidate_id}`,
                  filename: r.original_filename,
                  score:    r.score,
                  jobTitle: job.title,
                  jobId:    job.id,
                  rank:     r.rank,
                })
              }
            }
          } catch { /* skip */ }
        }
        // Seed new candidates into 'applied' stage if not already placed
        setCandidates(all)
        setPipeline(prev => {
          const next = { ...prev }
          for (const c of all) {
            const alreadyPlaced = STAGES.some(s => (next[s.id] ?? []).includes(c.id))
            if (!alreadyPlaced) {
              next.applied = [...(next.applied ?? []), c.id]
            }
          }
          // savePipeline called outside updater to avoid double-run in StrictMode
          return next
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Persist pipeline to localStorage outside setState to avoid StrictMode double-run
  useEffect(() => {
    if (!loading) savePipeline(pipeline)
  }, [pipeline, loading])

  const moveCandidate = (candidateId, fromStage, direction) => {
    const fromIdx = STAGES.findIndex(s => s.id === fromStage)
    const toIdx   = fromIdx + direction
    if (toIdx < 0 || toIdx >= STAGES.length) return
    const toStage = STAGES[toIdx].id
    setPipeline(prev => ({
      ...prev,
      [fromStage]: (prev[fromStage] ?? []).filter(id => id !== candidateId),
      [toStage]:   [...(prev[toStage] ?? []), candidateId],
    }))
  }

  const resetPipeline = () => {
    // Initialise all stages as empty arrays first to prevent .length crashes
    const fresh = Object.fromEntries(STAGES.map(s => [s.id, []]))
    candidates.forEach(c => { fresh.applied.push(c.id) })
    setPipeline(fresh)
    savePipeline(fresh)
  }

  const scoreColor = (s) =>
    s >= 0.85 ? 'text-emerald-600' : s >= 0.70 ? 'text-amber-600' : 'text-red-500'

  const filteredCandidates = selJob === 'all'
    ? candidates
    : candidates.filter(c => c.jobId === Number(selJob))

  if (loading) return <Spinner text="Loading pipeline…" />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Recruiter Pipeline</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Drag candidates through your hiring stages
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select className="input w-auto text-sm"
            value={selJob} onChange={e => setSelJob(e.target.value)}>
            <option value="all">All Jobs</option>
            {jobs.map(j => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <button onClick={resetPipeline} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw size={14} /> Reset
          </button>
        </div>
      </div>

      {/* Pipeline summary row */}
      <div className="grid grid-cols-5 gap-2">
        {STAGES.map(s => {
          const ids = (pipeline[s.id] ?? []).filter(id =>
            filteredCandidates.find(c => c.id === id)
          )
          return (
            <div key={s.id} className="card py-3 text-center">
              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.color} mb-1`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </div>
              <p className="text-2xl font-bold text-gray-800">{ids.length}</p>
            </div>
          )
        })}
      </div>

      {/* Kanban board */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {STAGES.map((stage, stageIdx) => {
          const stageIds = (pipeline[stage.id] ?? [])
          const stageCands = stageIds
            .map(id => filteredCandidates.find(c => c.id === id))
            .filter(Boolean)

          return (
            <div key={stage.id} className="bg-gray-50 rounded-2xl p-3 border border-gray-200 min-h-[200px]">
              {/* Column header */}
              <div className={`flex items-center gap-2 mb-3 px-2 py-1.5 rounded-xl ${stage.color}`}>
                <span className={`w-2 h-2 rounded-full ${stage.dot}`} />
                <span className="text-xs font-bold">{stage.label}</span>
                <span className="ml-auto text-xs font-semibold">{stageCands.length}</span>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {stageCands.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-6">Empty</p>
                )}
                {stageCands.map(c => (
                  <div key={c.id}
                    className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm hover:shadow-md transition-shadow">
                    {/* Candidate info */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold shrink-0">
                          {c.name[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate">{c.name}</p>
                          <p className="text-xs text-gray-400 truncate">{c.jobTitle}</p>
                        </div>
                      </div>
                      <button onClick={() => navigate(`/candidates/${c.id}`)}
                        className="shrink-0 p-1 hover:bg-gray-100 rounded-lg transition-colors">
                        <ExternalLink size={12} className="text-gray-400" />
                      </button>
                    </div>

                    {/* Score */}
                    <div className="flex items-center justify-between mt-2">
                      <span className={`text-xs font-bold ${scoreColor(c.score)}`}>
                        {Math.round(c.score * 100)}%
                      </span>
                      <span className="text-xs text-gray-400">#{c.rank}</span>
                    </div>

                    {/* Move buttons */}
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => moveCandidate(c.id, stage.id, -1)}
                        disabled={stageIdx === 0}
                        className="flex-1 flex items-center justify-center gap-0.5 py-1 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-600">
                        <ChevronLeft size={12} /> Back
                      </button>
                      <button
                        onClick={() => moveCandidate(c.id, stage.id, 1)}
                        disabled={stageIdx === STAGES.length - 1}
                        className="flex-1 flex items-center justify-center gap-0.5 py-1 rounded-lg text-xs bg-brand-100 hover:bg-brand-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-brand-700">
                        Next <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
