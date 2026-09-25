import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Briefcase, CheckCircle, Calendar, TrendingUp, Activity } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { listResumes, listJobs, getMatches } from '../api/client'
import StatCard from '../components/StatCard'
import ScoreBar from '../components/ScoreBar'
import Spinner from '../components/Spinner'

function statusBadge(score) {
  if (score >= 0.85) return { label:'Shortlisted', cls:'badge bg-emerald-100 text-emerald-700' }
  if (score >= 0.70) return { label:'Review',      cls:'badge bg-amber-100 text-amber-700'    }
  return                    { label:'Rejected',     cls:'badge bg-red-100 text-red-600'        }
}

const PIPELINE_STAGES = ['Applied','Screening','Interview','Offer']
const PIPELINE_COLORS = ['bg-blue-500','bg-purple-500','bg-amber-500','bg-emerald-500']

export default function Dashboard() {
  const navigate = useNavigate()
  const [resumes,   setResumes]   = useState([])
  const [jobs,      setJobs]      = useState([])
  const [topList,   setTopList]   = useState([])
  const [trendData, setTrendData] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [activity,  setActivity]  = useState([])

  useEffect(() => {
    async function load() {
      try {
        const [rRes, jRes] = await Promise.all([listResumes(), listJobs()])
        const rs = rRes.data, js = jRes.data
        setResumes(rs)
        setJobs(js)

        const matchData = await Promise.all(
          js.slice(0,5).map(j => getMatches(j.id).catch(()=>({ data:{ results:[] } })))
        )

        const topListBuilt = js.slice(0,5).map((j,i) => ({
          job:     j,
          results: (matchData[i].data.results ?? []).slice(0,5),
        }))
        setTopList(topListBuilt)

        // Trend: avg score per job — only use jobs that have match data (slice to 5)
        const trend = js.slice(0, 5).map((j, i) => {
          const res = matchData[i]?.data?.results ?? []
          const avg = res.length ? res.reduce((a, r) => a + r.score, 0) / res.length : 0
          return { name: j.title.slice(0, 14), avg: Math.round(avg * 100) }
        }).filter(t => t.avg > 0)
        setTrendData(trend)

        // Activity feed: recent uploads + jobs
        const actItems = [
          ...rs.slice(0, 4).map(r => ({
            id:   `r-${r.id}`,
            time: r.created_at, type: 'resume',
            text: `Resume uploaded: ${r.name_redacted ?? r.original_filename}`,
          })),
          ...js.slice(0, 3).map(j => ({
            id:   `j-${j.id}`,
            time: j.created_at, type: 'job',
            text: `Job created: ${j.title}`,
          })),
        ]
        .sort((a, b) => new Date(b.time) - new Date(a.time))
        .slice(0, 7)
        setActivity(actItems)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <Spinner text="Loading dashboard…" />

  const allResults   = topList.flatMap(t => t.results)
  const shortlisted  = allResults.filter(r => r.score >= 0.85).length
  const interviews   = allResults.filter(r => r.score >= 0.90).length

  // Pipeline funnel from localStorage (RecruiterWorkflow)
  let pipelineCounts = [resumes.length, 0, 0, 0]
  try {
    const stored = JSON.parse(localStorage.getItem('fairmatch_pipeline') ?? '{}')
    pipelineCounts = [
      (stored.applied    ?? []).length || resumes.length,
      (stored.screening  ?? []).length,
      (stored.interview  ?? []).length,
      (stored.offer      ?? []).length,
    ]
  } catch { /* use defaults */ }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Resumes"   value={resumes.length} icon={Users}       color="brand"  />
        <StatCard label="Active Jobs"     value={jobs.length}    icon={Briefcase}   color="purple" />
        <StatCard label="Shortlisted"     value={shortlisted}    icon={CheckCircle} color="green"  />
        <StatCard label="Interview-Ready" value={interviews}     icon={Calendar}    color="amber"  />
      </div>

      {/* Pipeline summary */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Activity size={16} className="text-brand-500" /> Hiring Pipeline
          </h2>
          <button onClick={() => navigate('/workflow')}
            className="text-xs text-brand-600 hover:underline">Manage →</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage} className="text-center">
              <div className={`h-2 rounded-full ${PIPELINE_COLORS[i]} mb-2`}
                style={{ opacity: 0.3 + (pipelineCounts[i] / (resumes.length || 1)) * 0.7 }} />
              <p className="text-xl font-bold text-gray-800">{pipelineCounts[i]}</p>
              <p className="text-xs text-gray-400">{stage}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Match Quality Trend */}
        <div className="card xl:col-span-2">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-500" /> Match Quality Trend
          </h2>
          {trendData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">Run matches to see trend.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData} margin={{top:4,right:16,bottom:4,left:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{fontSize:10}} />
                <YAxis domain={[0,100]} tick={{fontSize:10}} unit="%" />
                <Tooltip formatter={v=>[`${v}%`,'Avg Score']} />
                <Line type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={2.5}
                  dot={{fill:'#3b82f6',r:4}} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Activity feed */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Recent Activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {activity.map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                    a.type === 'resume' ? 'bg-brand-500' : 'bg-purple-500'
                  }`} />
                  <div>
                    <p className="text-xs text-gray-700">{a.text}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(a.time).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent Jobs */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Recent Jobs</h2>
            <button onClick={() => navigate('/jobs')}
              className="text-xs text-brand-600 hover:underline">View all</button>
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No jobs yet.</p>
          ) : (
            <div className="space-y-2">
              {jobs.slice(0,5).map(j => {
                const entry = topList.find(t => t.job.id === j.id)
                return (
                  <div key={j.id} onClick={() => navigate(`/jobs/${j.id}`)}
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors border border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{j.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(j.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="badge bg-brand-100 text-brand-700">
                      {entry?.results?.length ?? 0} candidates
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Top Candidates */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Top Candidates</h2>
            <button onClick={() => navigate('/candidates')}
              className="text-xs text-brand-600 hover:underline">View all</button>
          </div>
          {allResults.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Run a match to see top candidates.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="pb-2 font-medium">Candidate</th>
                  <th className="pb-2 font-medium">Score</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {allResults
                  .map(r => ({ ...r, jobTitle: topList.find(t=>t.results.includes(r))?.job?.title }))
                  .sort((a,b) => b.score-a.score)
                  .slice(0,6)
                  .map((r,i) => {
                    const { label, cls } = statusBadge(r.score)
                    const medals = ['🥇','🥈','🥉']
                    return (
                      <tr key={r.candidate_id}
                        onClick={() => navigate(`/candidates/${r.candidate_id}`)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <span>{medals[i] ?? ''}</span>
                            <p className="font-medium text-gray-800 text-xs">
                              {r.name_redacted ?? `Candidate ${r.candidate_id}`}
                            </p>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 w-28">
                          <ScoreBar pct={r.score*100} />
                        </td>
                        <td className="py-2.5">
                          <span className={cls}>{label}</span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
