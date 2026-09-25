import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, RefreshCw } from 'lucide-react'
import { getJob, matchCandidates, getMatches } from '../api/client'
import Spinner from '../components/Spinner'
import ScoreBar from '../components/ScoreBar'

function statusBadge(score) {
  if (score >= 0.85) return { label: 'Shortlisted', cls: 'badge bg-emerald-100 text-emerald-700' }
  if (score >= 0.70) return { label: 'Review',      cls: 'badge bg-amber-100 text-amber-700'    }
  return                    { label: 'Rejected',     cls: 'badge bg-red-100 text-red-600'        }
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job,     setJob]     = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [jRes, mRes] = await Promise.all([getJob(id), getMatches(id)])
        setJob(jRes.data)
        setResults(mRes.data.results ?? [])
      } catch {
        setError('Failed to load job.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const runMatch = async () => {
    setRunning(true)
    setError('')
    try {
      const res = await matchCandidates(Number(id), 20)
      setResults(res.data.results ?? [])
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Match failed.')
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <Spinner text="Loading job…" />

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/jobs')}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800">{job?.title}</h2>
          <p className="text-sm text-gray-400">
            {job?.created_by ? `Posted by ${job.created_by} · ` : ''}
            {job ? new Date(job.created_at).toLocaleDateString() : ''}
          </p>
        </div>
        <button onClick={runMatch} disabled={running}
          className="btn-primary flex items-center gap-2">
          {running ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? 'Matching…' : results.length ? 'Re-run Match' : 'Run Match'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">{error}</div>
      )}

      {/* Required skills */}
      {job?.required_skills_json?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-700 mb-3 text-sm">Required Skills</h3>
          <div className="flex flex-wrap gap-2">
            {job.required_skills_json.map(s => (
              <span key={s} className="badge bg-brand-100 text-brand-700">{s}</span>
            ))}
          </div>
          {job.desired_skills_json?.length > 0 && (
            <>
              <h3 className="font-semibold text-gray-700 mt-4 mb-3 text-sm">Nice to Have</h3>
              <div className="flex flex-wrap gap-2">
                {job.desired_skills_json.map(s => (
                  <span key={s} className="badge bg-gray-100 text-gray-600">{s}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Results table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">
            Ranked Candidates
            {results.length > 0 && (
              <span className="ml-2 badge bg-gray-100 text-gray-500">{results.length}</span>
            )}
          </h3>
        </div>

        {results.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No results yet. Click "Run Match" to rank candidates.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="pb-3 font-medium w-10">#</th>
                  <th className="pb-3 font-medium">Candidate</th>
                  <th className="pb-3 font-medium w-48">Score</th>
                  <th className="pb-3 font-medium">Skills</th>
                  <th className="pb-3 font-medium">Experience</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {results.map(r => {
                  const exp = r.explanation ?? {}
                  const { label, cls } = statusBadge(r.score)
                  const medals = ['🥇','🥈','🥉']
                  return (
                    <tr key={r.candidate_id}
                      onClick={() => navigate(`/candidates/${r.candidate_id}`)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors">
                      <td className="py-3 text-gray-400 font-medium">
                        {medals[r.rank - 1] ?? r.rank}
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-800">
                          {r.name_redacted ?? `Candidate ${r.candidate_id}`}
                        </p>
                        <p className="text-xs text-gray-400">{r.original_filename}</p>
                      </td>
                      <td className="py-3 pr-6">
                        <ScoreBar pct={r.score * 100} />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-xs text-gray-500">
                          <span className="text-emerald-600 font-medium">
                            {exp.matched_skills?.length ?? 0} matched
                          </span>
                          {' · '}
                          <span className="text-red-400">
                            {exp.missing_required_skills?.length ?? 0} missing
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-gray-500">
                        {exp.candidate_years_exp ?? 0} yrs
                      </td>
                      <td className="py-3">
                        <span className={cls}>{label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
