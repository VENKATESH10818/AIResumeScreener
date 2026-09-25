export default function StatCard({ label, value, icon: Icon, color = 'brand', delta }) {
  const colors = {
    brand:  { bg: 'bg-brand-50',   icon: 'text-brand-600',   ring: 'bg-brand-100'  },
    green:  { bg: 'bg-emerald-50', icon: 'text-emerald-600', ring: 'bg-emerald-100' },
    amber:  { bg: 'bg-amber-50',   icon: 'text-amber-600',   ring: 'bg-amber-100'  },
    purple: { bg: 'bg-purple-50',  icon: 'text-purple-600',  ring: 'bg-purple-100' },
  }
  const c = colors[color] ?? colors.brand

  return (
    <div className="card flex items-center gap-4">
      <div className={`${c.ring} rounded-2xl p-3`}>
        <Icon size={22} className={c.icon} />
      </div>
      <div className="flex-1">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-800">{value ?? '—'}</p>
        {delta != null && (
          <p className="text-xs text-emerald-600 font-medium mt-0.5">{delta}</p>
        )}
      </div>
    </div>
  )
}
