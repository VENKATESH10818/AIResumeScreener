/**
 * Axios API client
 * In local dev (empty VITE_API_BASE_URL): proxies through Vite to backend
 * In production: points to VITE_API_BASE_URL (e.g. Render backend URL)
 */
import axios from 'axios'

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const API_BASE_URL = rawBaseUrl.replace(/\/+$/, '')

const api = axios.create({
  baseURL: API_BASE_URL ? `${API_BASE_URL}/api/v1` : '/api/v1',
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
const rootApi = axios.create({ baseURL: API_BASE_URL || '/' })
export const getHealth = () => rootApi.get('/health')
export const getReady  = () => rootApi.get('/ready')

export default api
