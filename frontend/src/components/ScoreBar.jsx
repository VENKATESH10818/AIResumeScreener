/**
 * Horizontal score bar used throughout the app.
 * pct: 0–100
 */
export default function ScoreBar({ pct, color = 'brand' }) {
  const colors = {
    brand:  'bg-brand-500',
    green:  'bg-emerald-500',
    yellow: 'bg-amber-400',
    red:    'bg-red-400',
  }
  const barColor = colors[color] ?? colors.brand

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div
          className={`${barColor} h-2.5 rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-600 w-10 text-right">
        {Math.round(pct)}%
      </span>
    </div>
  )
}
