import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, XCircle, AlertTriangle, Award,
  Briefcase, GraduationCap, Clock, TrendingUp, Brain,
  Target, Lightbulb, Shield,
} from 'lucide-react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { getResume, listJobs, getMatches, submitFeedback } from '../api/client'
import Spinner from '../components/Spinner'
import ScoreBar from '../components/ScoreBar'

// ── helpers ───────────────────────────────────────────────────────────────────

function barColor(pct) {
  if (pct >= 80) return 'green'
  if (pct >= 55) return 'brand'
  return 'yellow'
}

function confidenceLabel(score) {
  if (score >= 0.88) return { text: 'Very High Confidence',  color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' }
  if (score >= 0.72) return { text: 'High Confidence',       color: 'text-brand-600',   bg: 'bg-brand-50 border-brand-200'   }
  if (score >= 0.55) return { text: 'Moderate Confidence',   color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200'   }
  return                    { text: 'Low Confidence',         color: 'text-red-500',     bg: 'bg-red-50 border-red-200'       }
}

function SkillPill({ name, present }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
      present
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        : 'bg-red-50 text-red-500 border border-red-200'
    }`}>
      {present ? <CheckCircle size={11} /> : <XCircle size={11} />}
      {name}
    </span>
  )
}

// SHAP-style contribution bar
function ContributionBar({ label, contribution, weight, pct, color }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <div className="w-36 text-xs text-gray-600 shrink-0">{label}</div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all duration-700 ${
                color === 'green'  ? 'bg-emerald-500' :
                color === 'yellow' ? 'bg-amber-400'   :
                color === 'red'    ? 'bg-red-400'      : 'bg-brand-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-gray-600 w-10 text-right">{Math.round(pct)}%</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          Weight {Math.round(weight * 100)}% · contributes {(contribution * 100).toFixed(1)} pts
        </p>
      </div>
    </div>
  )
}

// Reasoning narrative generator
function buildNarrative(exp, name) {
  if (!exp) return ''
  const parts = []
  const cName = name ?? 'This candidate'

  if (exp.embedding_similarity >= 0.75)
    parts.push(`${cName} shows strong semantic alignment with the job description`)
  else if (exp.embedding_similarity >= 0.5)
    parts.push(`${cName} has moderate relevance to the job description`)
  else
    parts.push(`${cName}'s background has limited overlap with this role`)

  if (exp.matched_skills?.length >= 5)
    parts.push(`demonstrating proficiency in ${exp.matched_skills.length} relevant skills including ${exp.matched_skills.slice(0,3).join(', ')}`)
  else if (exp.matched_skills?.length > 0)
    parts.push(`with ${exp.matched_skills.length} matching skill${exp.matched_skills.length > 1 ? 's' : ''}`)

  if (exp.candidate_years_exp >= exp.required_years_exp && exp.required_years_exp > 0)
    parts.push(`and meets the experience requirement (${exp.candidate_years_exp} of ${exp.required_years_exp} years required)`)
  else if (exp.required_years_exp > 0)
    parts.push(`but is short on experience (${exp.candidate_years_exp} vs ${exp.required_years_exp} years required)`)

  if (exp.missing_required_skills?.length > 0)
    parts.push(`Key gaps: ${exp.missing_required_skills.join(', ')}`)

  return parts.join('. ') + '.'
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CandidateProfile() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [candidate,   setCandidate]   = useState(null)
  const [matchData,   setMatchData]   = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [fbLabel,     setFbLabel]     = useState('')
  const [fbSent,      setFbSent]      = useState(false)
  const [activeTab,   setActiveTab]   = useState('overview')

  useEffect(() => {
    async function load() {
      try {
        const numericId = Number(id)
        if (!numericId || isNaN(numericId)) return
        const [cRes, jRes] = await Promise.all([getResume(numericId), listJobs()])
        setCandidate(cRes.data)
        for (const job of jRes.data) {
          try {
            const mRes = await getMatches(job.id)
            const match = (mRes.data.results ?? []).find(r => r.candidate_id === numericId)
            if (match) {
              setMatchData({ ...match, jobTitle: job.title, jobId: job.id })
              setSelectedJob(job)
              break
            }
          } catch { /* skip */ }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const handleFeedback = async (label) => {
    if (!matchData) return
    setFbLabel(label)
    try {
      await submitFeedback({ resume_id: Number(id), job_id: matchData.jobId, label, reviewer_id: 'recruiter' })
      setFbSent(true)
    } catch { /* non-fatal */ }
  }

  if (loading) return <Spinner text="Loading profile…" />
  if (!candidate) return <p className="text-center text-gray-400 py-20">Candidate not found.</p>

  const parsed  = candidate.parsed_json ?? {}
  const skills  = parsed.skills ?? []
  const exp     = matchData?.explanation ?? null
  const overallPct = exp ? exp.final_score * 100 : null
  const conf = exp ? confidenceLabel(exp.final_score) : null

  // SHAP-style contributions — weights match backend scoring.py DEFAULT_WEIGHTS
  const contributions = exp ? [
    { label: 'Semantic Similarity', weight: 0.50, raw: exp.embedding_similarity,  pct: exp.embedding_similarity  * 100, color: barColor(exp.embedding_similarity  * 100) },
    { label: 'Skill Match',         weight: 0.30, raw: exp.skill_match_ratio,      pct: exp.skill_match_ratio      * 100, color: barColor(exp.skill_match_ratio      * 100) },
    { label: 'Experience Match',    weight: 0.15, raw: exp.experience_match_score, pct: exp.experience_match_score * 100, color: barColor(exp.experience_match_score * 100) },
    { label: 'Education',           weight: 0.05, raw: exp.education_bonus,        pct: exp.education_bonus        * 100, color: barColor(exp.education_bonus        * 100) },
  ] : []

  // Radar data
  const radarData = contributions.map(c => ({
    subject: c.label.split(' ')[0],
    score:   Math.round(c.pct),
    fullMark: 100,
  }))

  // Skill gap
  const requiredSkills = exp
    ? [...new Set([...(exp.matched_skills ?? []), ...(exp.missing_required_skills ?? [])])]
    : []
  const presentSet = new Set((exp?.matched_skills ?? []).map(s => s.toLowerCase()))

  // Improvement tips
  const tips = []
  if (exp?.missing_required_skills?.length > 0)
    tips.push({ icon: Target, color: 'text-red-500',    text: `Learn missing required skills: ${exp.missing_required_skills.slice(0,3).join(', ')}` })
  if (exp?.candidate_years_exp < exp?.required_years_exp)
    tips.push({ icon: Clock,  color: 'text-amber-500',  text: `Gain more hands-on experience — ${exp.required_years_exp - exp.candidate_years_exp} more year(s) needed` })
  if (exp?.education_bonus < 0.5)
    tips.push({ icon: GraduationCap, color: 'text-brand-500', text: 'Add certifications or relevant coursework to boost education score' })
  if (tips.length === 0)
    tips.push({ icon: CheckCircle, color: 'text-emerald-500', text: 'Strong overall profile — no major improvement areas identified' })

  const tabs = ['overview', 'explainability', 'skill-gap', 'improvement']

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back */}
      <button onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={15} /> Back
      </button>

      {/* ── Hero ── */}
      <div className="card flex flex-col sm:flex-row items-start sm:items-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-2xl shrink-0">
          {(candidate.name_redacted ?? `C${id}`)[0].toUpperCase()}
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-800">
            {candidate.name_redacted ?? `Candidate ${id}`}
          </h2>
          <p className="text-gray-400 text-sm mt-0.5">{candidate.original_filename}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="badge bg-gray-100 text-gray-600">
              <Clock size={11} className="mr-1" />
              {parsed.years_experience > 0 ? `${parsed.years_experience} yrs exp.` : 'Experience unknown'}
            </span>
            {parsed.job_titles?.[0] && (
              <span className="badge bg-gray-100 text-gray-600">
                <Briefcase size={11} className="mr-1" />{parsed.job_titles[0].slice(0,40)}
              </span>
            )}
            {parsed.education?.[0] && (
              <span className="badge bg-gray-100 text-gray-600">
                <GraduationCap size={11} className="mr-1" />{parsed.education[0].slice(0,40)}
              </span>
            )}
          </div>
          {/* Confidence badge */}
          {conf && (
            <div className={`inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-semibold border ${conf.bg} ${conf.color}`}>
              <Shield size={12} /> {conf.text}
            </div>
          )}
        </div>
        {overallPct != null && (
          <div className="text-center shrink-0">
            <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center ${
              overallPct >= 80 ? 'border-emerald-500' : overallPct >= 60 ? 'border-brand-500' : 'border-amber-400'
            }`}>
              <div>
                <p className="text-2xl font-bold text-gray-800 leading-none">{Math.round(overallPct)}%</p>
                <p className="text-xs text-gray-400">Match</p>
              </div>
            </div>
            {selectedJob && (
              <p className="text-xs text-gray-400 mt-1 max-w-[100px] truncate">{selectedJob.title}</p>
            )}
            <p className="text-xs font-medium text-gray-500 mt-0.5">Rank #{matchData?.rank ?? '?'}</p>
          </div>
        )}
      </div>

      {/* ── Reasoning narrative ── */}
      {exp && (
        <div className="card bg-gradient-to-r from-brand-50 to-purple-50 border-brand-100">
          <div className="flex items-start gap-3">
            <Brain size={18} className="text-brand-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-brand-800 mb-1">AI Reasoning Summary</p>
              <p className="text-sm text-gray-700 leading-relaxed">
                {buildNarrative(exp, candidate.name_redacted)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              activeTab === t ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Score breakdown */}
          {exp && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-brand-500" /> Score Breakdown
              </h3>
              <div className="space-y-1">
                {contributions.map(c => (
                  <ContributionBar key={c.label}
                    label={c.label} weight={c.weight}
                    contribution={c.raw * c.weight} pct={c.pct} color={c.color} />
                ))}
              </div>
              {exp.hard_filter_applied && (
                <div className="mt-3 flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg p-3 text-xs">
                  <AlertTriangle size={14} />
                  Penalty: {Math.round(exp.hard_filter_penalty * 100)}% reduction for missing required skills
                </div>
              )}
            </div>
          )}

          {/* Skills */}
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4">Skills ({skills.length})</h3>
            {skills.length === 0 ? (
              <p className="text-sm text-gray-400">No skills detected.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {skills.map(s => (
                  <SkillPill key={s} name={s}
                    present={exp ? presentSet.has(s.toLowerCase()) : true} />
                ))}
              </div>
            )}
          </div>

          {/* Education & Certifications */}
          {(parsed.education?.length > 0 || parsed.certifications?.length > 0) && (
            <div className="card lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
              {parsed.education?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <GraduationCap size={16} className="text-brand-500" /> Education
                  </h3>
                  <ul className="space-y-2">
                    {parsed.education.map((e, i) => (
                      <li key={i} className="text-sm text-gray-600 flex gap-2">
                        <span className="text-brand-400">•</span>{e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {parsed.certifications?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Award size={16} className="text-amber-500" /> Certifications
                  </h3>
                  <ul className="space-y-2">
                    {parsed.certifications.map((c, i) => (
                      <li key={i} className="text-sm text-gray-600 flex gap-2">
                        <span className="text-amber-400">•</span>{c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Explainability ── */}
      {activeTab === 'explainability' && exp && (
        <div className="space-y-6">
          {/* Radar chart */}
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Brain size={16} className="text-brand-500" /> Competency Radar
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <PolarRadiusAxis angle={90} domain={[0,100]} tick={{ fontSize: 10 }} />
                <Radar name="Score" dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
                <Tooltip formatter={(v) => [`${v}%`, 'Score']} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Strengths vs Gaps */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="card">
              <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-3">✓ Strengths</p>
              <ul className="space-y-2.5">
                {exp.matched_skills?.length > 0 && (
                  <li className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                    {exp.matched_skills.length} matching skills: <span className="font-medium">{exp.matched_skills.slice(0,4).join(', ')}{exp.matched_skills.length > 4 ? ` +${exp.matched_skills.length-4}` : ''}</span>
                  </li>
                )}
                {exp.experience_match_score >= 0.8 && (
                  <li className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                    {exp.candidate_years_exp} years of relevant experience
                  </li>
                )}
                {exp.embedding_similarity >= 0.7 && (
                  <li className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                    Strong semantic alignment with job description ({Math.round(exp.embedding_similarity*100)}%)
                  </li>
                )}
                {exp.education_bonus >= 0.8 && (
                  <li className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                    Education matches job requirements
                  </li>
                )}
              </ul>
            </div>
            <div className="card">
              <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-3">✗ Gaps</p>
              {(exp.missing_required_skills?.length === 0 && exp.missing_skills?.length === 0) ? (
                <p className="text-sm text-gray-400">No significant gaps.</p>
              ) : (
                <ul className="space-y-2.5">
                  {exp.missing_required_skills?.map(s => (
                    <li key={s} className="flex items-start gap-2 text-sm text-gray-700">
                      <XCircle size={15} className="text-red-400 mt-0.5 shrink-0" />
                      <span><strong>{s}</strong> <span className="text-red-400 text-xs">(required)</span></span>
                    </li>
                  ))}
                  {exp.missing_skills?.filter(s => !(exp.missing_required_skills ?? []).map(r => r.toLowerCase()).includes(s.toLowerCase())).slice(0,4).map(s => (
                    <li key={s} className="flex items-start gap-2 text-sm text-gray-700">
                      <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
                      {s} <span className="text-gray-400 text-xs">(desired)</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Score weight table */}
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4">Score Composition (SHAP-style)</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 text-left">
                  <th className="pb-2 font-medium">Factor</th>
                  <th className="pb-2 font-medium">Weight</th>
                  <th className="pb-2 font-medium">Raw Score</th>
                  <th className="pb-2 font-medium">Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contributions.map(c => (
                  <tr key={c.label}>
                    <td className="py-2 font-medium text-gray-700">{c.label}</td>
                    <td className="py-2 text-gray-500">{Math.round(c.weight*100)}%</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-100 rounded-full h-1.5">
                          <div className="bg-brand-500 h-1.5 rounded-full" style={{ width: `${c.pct}%` }} />
                        </div>
                        <span className="text-gray-600">{Math.round(c.pct)}%</span>
                      </div>
                    </td>
                    <td className="py-2 font-semibold text-gray-800">
                      +{(c.raw * c.weight * 100).toFixed(1)} pts
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="py-2 font-bold text-gray-800" colSpan={3}>Final Score</td>
                  <td className="py-2 font-bold text-brand-700 text-base">{Math.round(overallPct)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Skill Gap ── */}
      {activeTab === 'skill-gap' && (
        <div className="space-y-6">
          {requiredSkills.length > 0 ? (
            <>
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-800">Skill Coverage</h3>
                  <span className="text-2xl font-bold text-brand-600">
                    {exp?.matched_skills?.length ?? 0} / {requiredSkills.length}
                  </span>
                </div>
                {/* Coverage bar */}
                <div className="bg-gray-100 rounded-full h-4 overflow-hidden mb-4">
                  <div
                    className="bg-gradient-to-r from-brand-500 to-emerald-500 h-4 rounded-full transition-all duration-700"
                    style={{ width: `${((exp?.matched_skills?.length ?? 0) / requiredSkills.length) * 100}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {requiredSkills.map(s => (
                    <SkillPill key={s} name={s} present={presentSet.has(s.toLowerCase())} />
                  ))}
                </div>
              </div>

              {exp?.missing_required_skills?.length > 0 && (
                <div className="card border-amber-200 bg-amber-50">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-800 mb-1">Skill Gap Identified</p>
                      <p className="text-sm text-amber-700">
                        <strong>{exp.missing_required_skills.join(' and ')}</strong>{' '}
                        {exp.missing_required_skills.length === 1 ? 'is a' : 'are'} critical missing skill{exp.missing_required_skills.length > 1 ? 's' : ''} for this role.
                        Closing {exp.missing_required_skills.length === 1 ? 'this gap' : 'these gaps'} could raise the match score by an estimated{' '}
                        <strong>{Math.min(25, exp.missing_required_skills.length * 8)}–{Math.min(35, exp.missing_required_skills.length * 12)}%</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* All candidate skills not in JD */}
              {skills.filter(s => !requiredSkills.map(r => r.toLowerCase()).includes(s.toLowerCase())).length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-800 mb-3">Additional Skills (not in JD)</h3>
                  <p className="text-xs text-gray-400 mb-3">These may be valuable for other roles.</p>
                  <div className="flex flex-wrap gap-2">
                    {skills.filter(s => !requiredSkills.map(r => r.toLowerCase()).includes(s.toLowerCase())).map(s => (
                      <span key={s} className="badge bg-purple-50 text-purple-700 border border-purple-200">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card text-center py-12 text-gray-400">
              <Target size={32} className="mx-auto mb-3 text-gray-300" />
              <p>Run a match first to see skill gap analysis.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Improvement ── */}
      {activeTab === 'improvement' && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Lightbulb size={16} className="text-amber-500" /> Improvement Recommendations
            </h3>
            <div className="space-y-4">
              {tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <tip.icon size={18} className={`${tip.color} shrink-0 mt-0.5`} />
                  <p className="text-sm text-gray-700">{tip.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Score potential */}
          {exp && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-4">Score Potential</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Current Score</span>
                    <span className="font-semibold">{Math.round(overallPct)}%</span>
                  </div>
                  <ScoreBar pct={overallPct} color={barColor(overallPct)} />
                </div>
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Potential Score (if gaps closed)</span>
                    <span className="font-semibold text-emerald-600">
                      {Math.min(98, Math.round(overallPct + (exp.missing_required_skills?.length ?? 0) * 8))}%
                    </span>
                  </div>
                  <ScoreBar pct={Math.min(98, overallPct + (exp.missing_required_skills?.length ?? 0) * 8)} color="green" />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-4">
                * Potential score is an estimate based on closing identified skill gaps.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Recruiter Decision ── */}
      {matchData && !fbSent && (
        <div className="card">
          <h3 className="font-semibold text-gray-800 mb-3">Recruiter Decision</h3>
          <p className="text-sm text-gray-500 mb-4">
            Record your decision for <strong>{matchData.jobTitle}</strong>:
          </p>
          <div className="flex gap-3 flex-wrap">
            {[
              { label: '✓ Accept', value: 'accept', cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
              { label: '? Maybe',  value: 'maybe',  cls: 'bg-amber-400 hover:bg-amber-500 text-white'    },
              { label: '✗ Reject', value: 'reject', cls: 'bg-red-500 hover:bg-red-600 text-white'        },
            ].map(btn => (
              <button key={btn.value} onClick={() => handleFeedback(btn.value)}
                disabled={!!fbLabel}
                className={`font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 ${btn.cls}`}>
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {fbSent && (
        <div className="card bg-emerald-50 border-emerald-200">
          <p className="text-emerald-700 font-medium text-sm">
            ✓ Decision recorded: <strong className="capitalize">{fbLabel}</strong>
          </p>
        </div>
      )}
    </div>
  )
}
