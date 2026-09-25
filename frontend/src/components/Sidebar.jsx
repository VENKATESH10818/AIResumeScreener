import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Briefcase, Users, BarChart3,
  Bot, KanbanSquare, UserCircle2,
} from 'lucide-react'

const nav = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard'        },
  { to: '/jobs',      icon: Briefcase,       label: 'Jobs'             },
  { to: '/candidates',icon: Users,           label: 'Candidates'       },
  { to: '/workflow',  icon: KanbanSquare,    label: 'Pipeline'         },
  { to: '/analytics', icon: BarChart3,       label: 'Analytics'        },
  { to: '/portal',    icon: UserCircle2,     label: 'Candidate Portal' },
]

export default function Sidebar() {
  return (
    <aside className="w-64 bg-brand-900 flex flex-col shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-brand-700">
        <div className="bg-brand-500 rounded-xl p-2">
          <Bot className="text-white" size={22} />
        </div>
        <div>
          <p className="text-white font-bold text-base leading-tight">FairMatch AI</p>
          <p className="text-brand-100 text-xs opacity-70">Resume Screener</p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-brand-100 hover:bg-brand-700 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-6 py-4 border-t border-brand-700">
        <p className="text-brand-100 text-xs opacity-50">v0.2.0 · Local MVP</p>
      </div>
    </aside>
  )
}
