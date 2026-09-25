import { useLocation } from 'react-router-dom'
import { Bell, CircleUserRound } from 'lucide-react'

const titles = {
  '/':           'Dashboard',
  '/jobs':       'Jobs',
  '/candidates': 'Candidates',
  '/workflow':   'Recruiter Pipeline',
  '/analytics':  'Analytics',
  '/portal':     'Candidate Portal',
}

export default function Topbar() {
  const { pathname } = useLocation()
  const title =
    pathname.startsWith('/candidates/') ? 'Candidate Profile' :
    pathname.startsWith('/jobs/')       ? 'Job Details'       :
    titles[pathname] ?? 'FairMatch AI'

  return (
    <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
      <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <Bell size={18} className="text-gray-500" />
        </button>
        <div className="flex items-center gap-2">
          <CircleUserRound size={30} className="text-brand-600" />
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-gray-700">Recruiter</p>
            <p className="text-xs text-gray-400">hr@company.com</p>
          </div>
        </div>
      </div>
    </header>
  )
}
