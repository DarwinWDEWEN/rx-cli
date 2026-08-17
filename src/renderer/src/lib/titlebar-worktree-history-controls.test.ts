import { describe, expect, it } from 'vitest'
import { shouldShowWorktreeHistoryControls } from './titlebar-worktree-history-controls'

describe('shouldShowWorktreeHistoryControls', () => {
  it('shows controls on content pages that participate in back/forward history', () => {
    expect(shouldShowWorktreeHistoryControls('terminal')).toBe(true)
    expect(shouldShowWorktreeHistoryControls('tasks')).toBe(true)
    expect(shouldShowWorktreeHistoryControls('automations')).toBe(true)
    expect(shouldShowWorktreeHistoryControls('issues-and-prs')).toBe(true)
    expect(shouldShowWorktreeHistoryControls('teams')).toBe(true)
  })

  it('hides controls on full-page views outside the history stack', () => {
    expect(shouldShowWorktreeHistoryControls('settings')).toBe(false)
    expect(shouldShowWorktreeHistoryControls('activity')).toBe(false)
    expect(shouldShowWorktreeHistoryControls('space')).toBe(false)
    expect(shouldShowWorktreeHistoryControls('skills')).toBe(false)
  })
})
