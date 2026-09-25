import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Upload, Trash2, FileText } from 'lucide-react'
import { listResumes, uploadResume, deleteResume } from '../api/client'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'

const FILE_TYPES = '.pdf,.docx,.doc,.png,.jpg,.jpeg'

export default function Candidates() {
  const navigate  = useNavigate()
  const fileRef   = useRef()
  const [resumes,    setResumes]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [uploading,  setUploading]  = useState(false)
  const [uploadMsg,  setUploadMsg]  = useState('')
  const [deleteId,   setDeleteId]   = useState(null)

  const load = () =>
    listResumes().then(r => setResumes(r.data)).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    setUploadMsg('')
    let ok = 0, fail = 0
    for (const file of files) {
      try {
        await uploadResume(file)
        ok++
      } catch {
        fail++
      }
    }
    setUploadMsg(`✓ ${ok} uploaded${fail ? `, ${fail} failed` : ''}`)
    if (fileRef.current) fileRef.current.value = ''
    setUploading(false)
    load()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    handleUpload({ target: { files } })
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDelete = async (id) => {
    setDeleteId(id)
    try {
      await deleteResume(id)
      setResumes(prev => prev.filter(r => r.id !== id))
    } finally {
      setDeleteId(null)
    }
  }

  if (loading) return <Spinner text="Loading candidates…" />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Candidates</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {resumes.length} resume{resumes.length !== 1 ? 's' : ''} uploaded
          </p>
        </div>
        <div className="flex items-center gap-3">
          {uploadMsg && (
            <span className="text-sm text-emerald-600 font-medium">{uploadMsg}</span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={FILE_TYPES}
            multiple
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-primary flex items-center gap-2"
          >
            <Upload size={15} />
            {uploading ? 'Uploading…' : 'Upload Resumes'}
          </button>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="border-2 border-dashed border-brand-200 rounded-2xl p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors">
        <Upload size={28} className="mx-auto text-brand-300 mb-2" />
        <p className="text-sm text-gray-500">
          Click to upload or drag &amp; drop PDF, DOCX, or image files
        </p>
        <p className="text-xs text-gray-400 mt-1">Max 10 MB per file</p>
      </div>

      {/* Candidate list */}
      {resumes.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No candidates yet"
          description="Upload resumes above to start screening candidates."
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs text-gray-400">
                <th className="px-6 py-3 font-medium">Candidate</th>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Skills Found</th>
                <th className="px-4 py-3 font-medium">Experience</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {resumes.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-6 py-3.5 cursor-pointer"
                    onClick={() => navigate(`/candidates/${r.id}`)}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-xs shrink-0">
                        {(r.name_redacted ?? `C${r.id}`)[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800">
                          {r.name_redacted ?? `Candidate ${r.id}`}
                        </p>
                        <p className="text-xs text-gray-400">ID #{r.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 cursor-pointer"
                    onClick={() => navigate(`/candidates/${r.id}`)}>
                    <div className="flex items-center gap-1.5 text-gray-500">
                      <FileText size={14} />
                      <span className="text-xs truncate max-w-[140px]">{r.original_filename}</span>
                    </div>
                    <span className="badge bg-gray-100 text-gray-500 mt-1">{r.file_type}</span>
                  </td>
                  <td className="px-4 py-3.5 cursor-pointer"
                    onClick={() => navigate(`/candidates/${r.id}`)}>
                    <span className="badge bg-brand-100 text-brand-700">
                      {r.skills?.length ?? 0} skills
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-gray-500 text-xs cursor-pointer"
                    onClick={() => navigate(`/candidates/${r.id}`)}>
                    {r.years_experience > 0 ? `${r.years_experience} yrs` : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-400 cursor-pointer"
                    onClick={() => navigate(`/candidates/${r.id}`)}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() => handleDelete(r.id)}
                      disabled={deleteId === r.id}
                      className="opacity-0 group-hover:opacity-100 btn-danger py-1 px-2 text-xs transition-opacity">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
