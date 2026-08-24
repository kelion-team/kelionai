import React from 'react'
import { CircleHelp, Eye, FileText, Globe2, Lightbulb, Monitor, Search, type LucideIcon } from 'lucide-react'

const cai: Record<string, LucideIcon> = {
  google: Search,
  vedere: Eye,
  afisare: Monitor,
  memorie: FileText,
  browser: Globe2,
  cod: Lightbulb,
  diverse: CircleHelp,
}

export default function ManualIcon({ k, size = 22 }: { k: string; size?: number }): React.JSX.Element {
  const Icon = cai[k] ?? CircleHelp
  return <Icon className="manual-icon" size={size} strokeWidth={1.7} aria-hidden="true" />
}
