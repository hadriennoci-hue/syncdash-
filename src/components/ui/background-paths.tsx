type PathSpec = {
  d: string
  opacity: number
  width: number
}

const PATHS: PathSpec[] = [
  { d: 'M-360 -170 C-300 -140 -80 40 160 170 C400 300 610 520 700 860', opacity: 0.12, width: 1.1 },
  { d: 'M-300 -210 C-210 -170 10 30 240 170 C500 320 650 560 720 900', opacity: 0.1, width: 1.0 },
  { d: 'M-250 -250 C-150 -180 60 10 320 170 C560 320 700 600 760 940', opacity: 0.09, width: 0.95 },
  { d: 'M-430 -120 C-360 -100 -130 80 100 210 C330 340 560 590 700 940', opacity: 0.08, width: 0.9 },
  { d: 'M-460 -70 C-370 -30 -170 130 60 260 C280 380 500 640 650 980', opacity: 0.07, width: 0.85 },
  { d: 'M-480 -10 C-390 20 -200 180 20 320 C230 450 440 700 610 1040', opacity: 0.06, width: 0.8 },
]

export function BackgroundPaths() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg className="h-full w-full" viewBox="0 0 720 1040" fill="none" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wizhard-bg-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#35A7FF" />
            <stop offset="100%" stopColor="#35F2A1" />
          </linearGradient>
        </defs>
        {PATHS.map((path, idx) => (
          <path
            key={idx}
            d={path.d}
            stroke="url(#wizhard-bg-stroke)"
            strokeWidth={path.width}
            strokeOpacity={path.opacity}
            fill="none"
          />
        ))}
      </svg>
    </div>
  )
}
