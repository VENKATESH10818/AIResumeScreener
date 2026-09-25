/**
 * Axios API client — all calls go through the Vite proxy to http://localhost:8000
 */
import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// ── Resumes ──────────────────────────────────────────────────────────────────

export const uploadResume = (file, jobId = null) => {
  const form = new FormData()
  form.append('file', file)
  if (jobId) form.append('job_id', jobId)
  return api.post('/resumes/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const listResumes = (skip = 0, limit = 50) =>
  api.get('/resumes/', { params: { skip, limit } })

export const getResume = (id) => api.get(`/resumes/${id}`)

export const deleteResume = (id) => api.delete(`/resumes/${id}`)

// ── Jobs ─────────────────────────────────────────────────────────────────────

export const createJob = (payload) => api.post('/jobs/', payload)

export const listJobs = (skip = 0, limit = 50) =>
  api.get('/jobs/', { params: { skip, limit } })

export const getJob = (id) => api.get(`/jobs/${id}`)

// ── Matching ─────────────────────────────────────────────────────────────────

export const matchCandidates = (jobId, topK = 20) =>
  api.post('/match', { job_id: jobId, top_k: topK, use_faiss_prefilter: true })

export const getMatches = (jobId, limit = 50) =>
  api.get(`/match/${jobId}`, { params: { limit } })

export const getTopCandidates = (jobId, topK = 10) =>
  api.get(`/match/${jobId}/top`, { params: { top_k: topK } })

// ── Feedback ─────────────────────────────────────────────────────────────────

export const submitFeedback = (payload) => api.post('/reviewer/feedback', payload)

// ── System ───────────────────────────────────────────────────────────────────
// /health and /ready are on root path (no /api/v1 prefix) — use a separate instance
const rootApi = axios.create({ baseURL: '/' })
export const getHealth = () => rootApi.get('/health')
export const getReady  = () => rootApi.get('/ready')

export default api
