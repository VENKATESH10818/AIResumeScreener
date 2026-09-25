import { useEffect, useState } from 'react'
import { listResumes, listJobs, getMatches } from '../api/client'
import Spinner from '../components/Spinner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line,
} from 'recharts'

const PIE_COLORS = ['#22c55e', '#f59e0b', '#ef4444']

// ── Custom Funnel (replaces FunnelChart removed in Recharts v3) ───────────────
function HiringFunnel({ data }) {
  const max = data[0]?.value || 1
  const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e']
  return (
    <div className="space-y-2 py-2">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100
        const width = Math.max(20, 100 - i * 12)   // taper
        return (
          <div key={d.name} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-20 text-right shrink-0">{d.name}</span>
            <div className="flex-1 flex justify-center">
              <div
                className="h-9 rounded-lg flex items-center justify-center transition-all duration-500"
                style={{ width: `${width}%`, backgroundColor: colors[i] }}>
                <span className="text-white text-xs font-bold">{d.value}</span>
              </div>
            </div>
            <span className="text-xs text-gray-400 w-12 shrink-0">
              {Math.round(pct)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function Analytics() {
  const [loading,     setLoading]     = useState(true)
  const [scoreData,   setScoreData]   = useState([])
  const [statusData,  setStatusData]  = useState([])
  const [skillData,   setSkillData]   = useState([])
  const [gapData,     setGapData]     = useState([])
  const [funnelData,  setFunnelData]  = useState([])
  const [trendData,   setTrendData]   = useState([])
  const [evalMetrics, setEvalMetrics] = useState(null)
  const [radarData,   setRadarData]   = useState([])

  useEffect(() => {
    async function load() {
      try {
        const [rRes, jRes] = await Promise.all([listResumes(), listJobs()])
        const resumes = rRes.data
        const jobs    = jRes.data

        // ── Skill frequency ──
        const skillFreq = {}, gapFreq = {}
        resumes.forEach(r => {
          ;(r.skills ?? []).forEach(s => { skillFreq[s] = (skillFreq[s] ?? 0) + 1 })
        })
        setSkillData(
          Object.entries(skillFreq).sort((a, b) => b[1] - a[1]).slice(0, 12)
            .map(([name, count]) => ({ name, count }))
        )

        // ── Match results (serial to avoid rate limiting) ──
        const allResults = [], trendArr = []
        for (const job of jobs.slice(0, 15)) {
          try {
            const mRes = await getMatches(job.id)
            const res = mRes.data.results ?? []
            allResults.push(...res)
            if (res.length) {
              const avg = res.reduce((a, r) => a + r.score, 0) / res.length
              trendArr.push({ name: job.title.slice(0, 18), avg: Math.round(avg * 100) })
            }
            res.forEach(r => {
              ;(r.explanation?.missing_required_skills ?? []).forEach(s => {
                gapFreq[s] = (gapFreq[s] ?? 0) + 1
              })
            })
          } catch { /* skip */ }
        }
        setTrendData(trendArr)

        // ── Score histogram ──
        const buckets = Array.from({ length: 10 }, (_, i) => ({
          range: `${i * 10}-${i * 10 + 10}`, count: 0,
        }))
        allResults.forEach(r => { buckets[Math.min(9, Math.floor(r.score * 10))].count++ })
        setScoreData(buckets)

        // ── Status pie ──
        const shortlisted = allResults.filter(r => r.score >= 0.85).length
        const review      = allResults.filter(r => r.score >= 0.70 && r.score < 0.85).length
        const rejected    = allResults.filter(r => r.score < 0.70).length
        setStatusData([
          { name: 'Shortlisted', value: shortlisted },
          { name: 'Review',      value: review      },
          { name: 'Rejected',    value: rejected    },
        ])

        // ── Skill gaps ──
        setGapData(
          Object.entries(gapFreq).sort((a, b) => b[1] - a[1]).slice(0, 8)
            .map(([skill, count]) => ({ skill, count }))
        )

        // ── Funnel ──
        const total = allResults.length
        setFunnelData([
          { name: 'Applied',   value: total },
          { name: 'Screening', value: Math.round(total * 0.65) },
          { name: 'Interview', value: allResults.filter(r => r.score >= 0.70).length },
          { name: 'Offer',     value: allResults.filter(r => r.score >= 0.85).length },
        ])

        // ── AI Evaluation Metrics ──
        const topK = allResults.slice(0, 10)
        const precAtK = topK.length ? topK.filter(r => r.score >= 0.70).length / topK.length : 0
        const coverage = resumes.length ? Math.min(1, allResults.length / resumes.length) : 0
        const avgScore = allResults.length ? allResults.reduce((a, r) => a + r.score, 0) / allResults.length : 0
        const shortlistRate = allResults.length ? shortlisted / allResults.length : 0
        setEvalMetrics({ precAtK, coverage, avgScore, shortlistRate, total })

        // ── Pool radar ──
        if (allResults.length) {
          const avg = key => allResults.reduce((a, r) => a + (r.explanation?.[key] ?? 0), 0) / allResults.length
          setRadarData([
            { subject: 'Semantic',   score: Math.round(avg('embedding_similarity')   * 100) },
            { subject: 'Skills',     score: Math.round(avg('skill_match_ratio')      * 100) },
            { subject: 'Experience', score: Math.round(avg('experience_match_score') * 100) },
            { subject: 'Education',  score: Math.round(avg('education_bonus')        * 100) },
          ])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <Spinner text="Loading analytics…" />

  // Pre-compute pie total for label formatter (stable closure, not per-render)
  const pieTotal = statusData.reduce((a, s) => a + s.value, 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Analytics</h2>
        <p className="text-sm text-gray-400 mt-0.5">Aggregate insights across all jobs and candidates</p>
      </div>

      {/* ── AI Evaluation Metrics ── */}
      {evalMetrics && (
        <div>
          <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
            AI Evaluation Metrics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Precision@10',    value: `${(evalMetrics.precAtK * 100).toFixed(1)}%`,      desc: 'Top-10 relevance rate',   color: 'bg-brand-50 border-brand-200 text-brand-700'       },
              { label: 'Coverage',        value: `${(evalMetrics.coverage * 100).toFixed(1)}%`,     desc: 'Candidates with a match', color: 'bg-purple-50 border-purple-200 text-purple-700'    },
              { label: 'Avg Match Score', value: `${(evalMetrics.avgScore * 100).toFixed(1)}%`,     desc: 'Mean score across all',   color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
              { label: 'Shortlist Rate',  value: `${(evalMetrics.shortlistRate * 100).toFixed(1)}%`, desc: 'Score ≥ 85%',            color: 'bg-amber-50 border-amber-200 text-amber-700'       },
            ].map(m => (
              <div key={m.label} className={`rounded-2xl border p-4 ${m.color}`}>
                <p className="text-2xl font-bold">{m.value}</p>
                <p className="text-xs font-semibold mt-0.5">{m.label}</p>
                <p className="text-xs opacity-70 mt-0.5">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Score distribution */}
        <div className="card">
          <h3 className="font-semibold text-gray-700 mb-4">Score Distribution</h3>
          {scoreData.every(b => b.count === 0) ? (
            <p className="text-sm text-gray-400 text-center py-12">Run matches to see score distribution.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={scoreData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Candidates" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status pie — no inline labels to prevent collision */}
        <div className="card">
          <h3 className="font-semibold text-gray-700 mb-4">Candidate Status</h3>
          {statusData.every(s => s.value === 0) ? (
            <p className="text-sm text-gray-400 text-center py-12">No match data yet.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%" cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    paddingAngle={3}
                  >
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      `${value} (${pieTotal ? Math.round((value / pieTotal) * 100) : 0}%)`,
                      name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Custom legend — never overlaps */}
              <div className="flex justify-center gap-6 mt-3">
                {statusData.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: PIE_COLORS[i] }}
                    />
                    <span className="text-xs text-gray-600 font-medium">{s.name}</span>
                    <span className="text-xs font-bold" style={{ color: PIE_COLORS[i] }}>
                      {pieTotal ? Math.round((s.value / pieTotal) * 100) : 0}%
                    </span>
                    <span className="text-xs text-gray-400">({s.value})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Match quality trend */}
        <div className="card">
          <h3 className="font-semibold text-gray-700 mb-4">Match Quality Trend (per Job)</h3>
          {trendData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">No trend data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={v => [`${v}%`, 'Avg Score']} />
                <Line type="monotone" dataKey="avg" stroke="#6366f1" strokeWidth={2}
                  dot={{ fill: '#6366f1', r: 4 }} name="Avg Score" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Competency radar */}
        {radarData.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-4">Candidate Pool — Avg Competency</h3>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar dataKey="score" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
                <Tooltip formatter={v => [`${v}%`, 'Avg']} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Hiring funnel — custom component (FunnelChart removed in Recharts v3) */}
      {funnelData.some(f => f.value > 0) && (
        <div className="card">
          <h3 className="font-semibold text-gray-700 mb-4">Hiring Funnel</h3>
          <HiringFunnel data={funnelData} />
        </div>
      )}

      {/* Skill gap heatmap */}
      <div className="card">
        <h3 className="font-semibold text-gray-700 mb-4">
          Top Skill Gaps (most missing across candidates)
        </h3>
        {gapData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No gap data yet — run matches first.</p>
        ) : (
          <div className="space-y-2">
            {gapData.map(g => {
              const maxCount = gapData[0].count
              const pct = (g.count / maxCount) * 100
              const color = pct > 70 ? 'bg-red-500' : pct > 40 ? 'bg-amber-400' : 'bg-brand-400'
              return (
                <div key={g.skill} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-36 truncate capitalize">{g.skill}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div
                      className={`${color} h-5 rounded-full flex items-center justify-end pr-2 transition-all duration-500`}
                      style={{ width: `${pct}%` }}>
                      <span className="text-white text-xs font-semibold">{g.count}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Top skills bar */}
      <div className="card">
        <h3 className="font-semibold text-gray-700 mb-4">Top Skills in Candidate Pool</h3>
        {skillData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Upload resumes to see skill frequency.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={skillData} layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name="Candidates" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
