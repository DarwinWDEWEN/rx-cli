import type { UISlice } from '@/store/slices/ui'

// Why: these views are content pages that participate in back/forward history — controls must be visible so navigation is reachable.
export function shouldShowWorktreeHistoryControls(activeView: UISlice['activeView']): boolean {
  return (
    activeView === 'terminal' ||
    activeView === 'tasks' ||
    activeView === 'automations' ||
    activeView === 'issues-and-prs' ||
    activeView === 'teams'
  )
}
