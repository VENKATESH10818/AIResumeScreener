/**
 * Candidate Portal — self-service view.
 * A candidate enters their ID to see their own score, skill gaps, and tips.
 * (In production this would use auth; for MVP it uses the candidate ID.)
 */
import { useState } from 'react'
import {
  Search, User, CheckCircle, XCircle, AlertTriangle,
  TrendingUp, Lightbulb, BookOpen, Award, Target,
} from 'lucide-react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from 'recharts'
import { getResume, listJobs, getMatches } from '../api/client'
import ScoreBar from '../components/ScoreBar'
import Spinner from '../components/Spinner'

// Learning resource suggestions per skill
const LEARNING_RESOURCES = {
  docker:         { url: 'https://docs.docker.com/get-started/', label: 'Docker Official Docs' },
  kubernetes:     { url: 'https://kubernetes.io/docs/tutorials/', label: 'Kubernetes Tutorials' },
  aws:            { url: 'https://aws.amazon.com/training/', label: 'AWS Training' },
  python:         { url: 'https://docs.python.org/3/tutorial/', label: 'Python Tutorial' },
  fastapi:        { url: 'https://fastapi.tiangolo.com/tutorial/', label: 'FastAPI Tutorial' },
  postgresql:     { url: 'https://www.postgresql.org/docs/current/tutorial.html', label: 'PostgreSQL Docs' },
  'machine learning': { url: 'https://www.coursera.org/learn/machine-learning', label: 'ML Coursera' },
  tensorflow:     { url: 'https://www.tensorflow.org/tutorials', label: 'TensorFlow Tutorials' },
  react:          { url: 'https://react.dev/learn', label: 'React Docs' },
  typescript:     { url: 'https://www.typescriptlang.org/docs/', label: 'TypeScript Docs' },
}

function getResource(skill) {
  return LEARNING_RESOURCES[skill.toLowerCase()] ?? {
    url: `https://www.google.com/search?q=learn+${encodeURIComponent(skill)}`,
    label: `Search: learn ${skill}`,
  }
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

export default function CandidatePortal() {
  const [inputId,   setInputId]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [data,      setData]      = useState(null)  // { candidate, matchData, job }

  const lookup = async () => {
    const cid = parseInt(inputId, 10)
    if (!cid) { setError('Please enter a valid Candidate ID.'); return }
    setError('')
    setLoading(true)
    setData(null)
    try {
      const [cRes, jRes] = await Promise.all([getResume(cid), listJobs()])
      const candidate = cRes.data
      let matchData = null, job = null
      for (const j of jRes.data.slice(0, 20)) {  // limit to 20 jobs max
        try {
          const mRes = await getMatches(j.id)
          const match = (mRes.data.results ?? []).find(r => r.candidate_id === cid)
          if (match) { matchData = { ...match, jobId: j.id }; job = j; break }
        } catch { /* skip */ }
      }
      setData({ candidate, matchData, job })
    } catch {
      setError('Candidate not found. Please check your ID.')
    } finally {
      setLoading(false)
    }
  }

  const exp     = data?.matchData?.explanation ?? null
  const parsed  = data?.candidate?.parsed_json ?? {}
  const skills  = parsed.skills ?? []
  const overallPct = exp ? exp.final_score * 100 : null

  const requiredSkills = exp
    ? [...new Set([...(exp.matched_skills ?? []), ...(exp.missing_required_skills ?? [])])]
    : []
  const presentSet = new Set((exp?.matched_skills ?? []).map(s => s.toLowerCase()))

  const radarData = exp ? [
    { subject: 'Semantic',    score: Math.round(exp.embedding_similarity   * 100) },
    { subject: 'Skills',      score: Math.round(exp.skill_match_ratio       * 100) },
    { subject: 'Experience',  score: Math.round(exp.experience_match_score  * 100) },
    { subject: 'Education',   score: Math.round(exp.education_bonus         * 100) },
    { subject: 'Certs',       score: Math.round(exp.education_bonus * 80)          },
  ] : []

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="w-14 h-14 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <User size={26} className="text-brand-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800">Candidate Portal</h1>
        <p className="text-gray-400 text-sm mt-1">
          Enter your Candidate ID to view your match score, skill gaps, and improvement tips.
        </p>
      </div>

      {/* Lookup */}
      <div className="card">
        <label className="label">Your Candidate ID</label>
        <div className="flex gap-3">
          <input
            className="input flex-1"
            type="number"
            placeholder="e.g. 42"
            value={inputId}
            onChange={e => setInputId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
          />
          <button onClick={lookup} disabled={loading} className="btn-primary flex items-center gap-2">
            <Search size={15} />
            {loading ? 'Looking up…' : 'View My Profile'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        <p className="text-xs text-gray-400 mt-2">
          Your ID was provided when your resume was uploaded to the system.
        </p>
      </div>

      {loading && <Spinner text="Fetching your profile…" />}

      {data && (
        <>
          {/* Identity card */}
          <div className="card flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xl shrink-0">
              {(data.candidate.name_redacted ?? 'C')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-800">
                {data.candidate.name_redacted ?? `Candidate ${inputId}`}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {parsed.years_experience > 0 ? `${parsed.years_experience} yrs experience · ` : ''}
                {parsed.job_titles?.[0] ?? ''}
              </p>
              {data.job && (
                <span className="badge bg-brand-100 text-brand-700 mt-2">
                  Applied: {data.job.title}
                </span>
              )}
            </div>
            {overallPct != null && (
              <div className="text-center shrink-0">
                <div className={`w-20 h-20 rounded-full border-4 flex items-center justify-center ${
                  overallPct >= 80 ? 'border-emerald-500' : overallPct >= 60 ? 'border-brand-500' : 'border-amber-400'
                }`}>
                  <div>
                    <p className="text-xl font-bold text-gray-800 leading-none">{Math.round(overallPct)}%</p>
                    <p className="text-xs text-gray-400">Match</p>
                  </div>
                </div>
                <p className="text-xs font-medium text-gray-500 mt-1">Rank #{data.matchData?.rank ?? '?'}</p>
              </div>
            )}
            {!data.matchData && (
              <div className="text-center text-gray-400">
                <Target size={28} className="mx-auto" />
                <p className="text-xs mt-1">No match yet</p>
              </div>
            )}
          </div>

          {exp && (
            <>
              {/* Score breakdown */}
              <div className="card">
                <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <TrendingUp size={16} className="text-brand-500" /> Your Score Breakdown
                </h3>
                <div className="space-y-3">
                  {[
                    { label: 'Semantic Similarity', pct: exp.embedding_similarity  * 100 },
                    { label: 'Skill Match',          pct: exp.skill_match_ratio     * 100 },
                    { label: 'Experience Match',     pct: exp.experience_match_score* 100 },
                    { label: 'Education Fit',        pct: exp.education_bonus       * 100 },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{s.label}</span>
                      </div>
                      <ScoreBar pct={s.pct}
                        color={s.pct >= 80 ? 'green' : s.pct >= 55 ? 'brand' : 'yellow'} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Radar */}
              <div className="card">
                <h3 className="font-semibold text-gray-800 mb-3">Competency Radar</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: '#6b7280' }} />
                    <PolarRadiusAxis angle={90} domain={[0,100]} tick={{ fontSize: 10 }} />
                    <Radar dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
                    <Tooltip formatter={v => [`${v}%`, 'Score']} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* Skill gap */}
          {requiredSkills.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800">Skill Coverage</h3>
                <span className="text-brand-700 font-bold">
                  {exp?.matched_skills?.length ?? 0} / {requiredSkills.length}
                </span>
              </div>
              <div className="bg-gray-100 rounded-full h-3 overflow-hidden mb-4">
                <div
                  className="bg-gradient-to-r from-brand-500 to-emerald-500 h-3 rounded-full"
                  style={{ width: `${((exp?.matched_skills?.length ?? 0) / requiredSkills.length) * 100}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {requiredSkills.map(s => (
                  <SkillPill key={s} name={s} present={presentSet.has(s.toLowerCase())} />
                ))}
              </div>
            </div>
          )}

          {/* All candidate skills */}
          {skills.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-3">Your Detected Skills</h3>
              <div className="flex flex-wrap gap-2">
                {skills.map(s => (
                  <span key={s} className="badge bg-purple-50 text-purple-700 border border-purple-200">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Learning recommendations */}
          {exp?.missing_required_skills?.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <BookOpen size={16} className="text-amber-500" /> Recommended Learning
              </h3>
              <div className="space-y-3">
                {exp.missing_required_skills.map(skill => {
                  const res = getResource(skill)
                  return (
                    <div key={skill} className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-100">
                      <div className="flex items-center gap-3">
                        <AlertTriangle size={15} className="text-amber-500 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-gray-800 capitalize">{skill}</p>
                          <p className="text-xs text-gray-500">Required skill — not detected in your resume</p>
                        </div>
                      </div>
                      <a href={res.url} target="_blank" rel="noopener noreferrer"
                        className="btn-primary text-xs py-1.5 shrink-0 flex items-center gap-1"
                        onClick={e => e.stopPropagation()}>
                        <Lightbulb size={12} /> Learn
                      </a>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Certifications */}
          {parsed.certifications?.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Award size={16} className="text-amber-500" /> Your Certifications
              </h3>
              <div className="flex flex-wrap gap-2">
                {parsed.certifications.map((c, i) => (
                  <span key={i} className="badge bg-amber-50 text-amber-700 border border-amber-200">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Score potential */}
          {exp && (
            <div className="card bg-gradient-to-r from-brand-50 to-purple-50 border-brand-100">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <TrendingUp size={16} className="text-brand-500" /> Your Score Potential
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Current</span><span className="font-bold">{Math.round(overallPct)}%</span>
                  </div>
                  <ScoreBar pct={overallPct} color={overallPct >= 80 ? 'green' : 'brand'} />
                </div>
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>If you close skill gaps</span>
                    <span className="font-bold text-emerald-600">
                      {Math.min(98, Math.round(overallPct + (exp.missing_required_skills?.length ?? 0) * 8))}%
                    </span>
                  </div>
                  <ScoreBar
                    pct={Math.min(98, overallPct + (exp.missing_required_skills?.length ?? 0) * 8)}
                    color="green"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3">* Estimated projection based on skill gap analysis.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
