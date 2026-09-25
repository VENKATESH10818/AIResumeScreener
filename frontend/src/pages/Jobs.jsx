import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Plus, X } from 'lucide-react'
import { listJobs, createJob } from '../api/client'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'

const SAMPLE_JD = `We are looking for a Senior Python Engineer with 5+ years of experience.

Required:
Python, FastAPI, PostgreSQL, Docker, REST API

Nice to have:
AWS, Kubernetes, machine learning, Redis`

export default function Jobs() {
  const navigate = useNavigate()
  const [jobs,    setJobs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ title: '', jd_text: SAMPLE_JD, created_by: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    listJobs().then(r => setJobs(r.data)).finally(() => setLoading(false))
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await createJob({
        title:      form.title,
        jd_text:    form.jd_text,
        created_by: form.created_by || undefined,
      })
      const newJob = { id: res.data.job_id, title: form.title,
        created_by: form.created_by, created_at: new Date().toISOString() }
      setJobs(prev => [newJob, ...prev])
      setShowForm(false)
      setForm({ title: '', jd_text: SAMPLE_JD, created_by: '' })
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Failed to create job.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Spinner text="Loading jobs…" />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Job Descriptions</h2>
          <p className="text-sm text-gray-400 mt-0.5">{jobs.length} job{jobs.length !== 1 ? 's' : ''} posted</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Job
        </button>
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 text-lg">Create Job Description</h3>
              <button onClick={() => setShowForm(false)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="label">Job Title *</label>
                <input className="input" placeholder="e.g. Senior Python Engineer"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  required />
              </div>
              <div>
                <label className="label">Job Description *</label>
                <textarea className="input min-h-[200px] resize-y font-mono text-xs"
                  placeholder="Paste full job description…"
                  value={form.jd_text}
                  onChange={e => setForm(f => ({ ...f, jd_text: e.target.value }))}
                  required />
              </div>
              <div>
                <label className="label">Posted by</label>
                <input className="input" placeholder="hr@company.com"
                  value={form.created_by}
                  onChange={e => setForm(f => ({ ...f, created_by: e.target.value }))} />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create Job'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Job list */}
      {jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet"
          description="Create your first job description to start matching candidates."
          action={
            <button onClick={() => setShowForm(true)} className="btn-primary mt-2">
              Create Job
            </button>
          } />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {jobs.map(j => (
            <div key={j.id}
              onClick={() => navigate(`/jobs/${j.id}`)}
              className="card cursor-pointer hover:shadow-md hover:border-brand-200 transition-all group">
              <div className="flex items-start justify-between">
                <div className="bg-brand-50 rounded-xl p-2.5 group-hover:bg-brand-100 transition-colors">
                  <Briefcase size={18} className="text-brand-600" />
                </div>
                <span className="badge bg-gray-100 text-gray-500 text-xs">#{j.id}</span>
              </div>
              <h3 className="font-semibold text-gray-800 mt-3 text-base leading-snug">{j.title}</h3>
              <p className="text-xs text-gray-400 mt-1">
                {j.created_by ? `Posted by ${j.created_by}` : 'No poster'} ·{' '}
                {new Date(j.created_at).toLocaleDateString()}
              </p>
              <div className="mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-brand-600 font-medium group-hover:underline">
                  View & Match →
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
