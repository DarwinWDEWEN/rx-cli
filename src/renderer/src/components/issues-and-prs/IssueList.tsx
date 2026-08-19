import { Loader2 } from 'lucide-react'
import type { Issue } from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        {translate('auto.components.issuesAndPRs.IssueList.noIssues', 'No issues yet')}
      </p>
    </div>
  )
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Loader2 className="size-7 animate-spin text-muted-foreground" />
    </div>
  )
}

function IssueListItem({
  issue,
  isSelected,
  onSelect
}: {
  issue: Issue
  isSelected: boolean
  onSelect: (issue: Issue) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(issue)}
      className={`flex w-full flex-col gap-1 rounded-md border p-3 text-left transition-colors ${
        isSelected ? 'border-primary bg-accent/50' : 'hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          #{issue.number} {issue.title}
        </span>
        <span
          className={`text-xs ${issue.status === 'done' ? 'text-muted-foreground' : 'text-green-600'}`}
        >
          {issue.status === 'done'
            ? translate('auto.components.issuesAndPRs.IssueList.closed', 'Closed')
            : translate('auto.components.issuesAndPRs.IssueList.open', 'Open')}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize">{issue.priority}</span>
      </div>
    </button>
  )
}

export function IssueList({
  issues,
  selectedIssue,
  loading,
  onSelect
}: {
  issues: Issue[]
  selectedIssue: Issue | null
  loading: boolean
  onSelect: (issue: Issue) => void
}): React.JSX.Element {
  if (loading) {
    return <LoadingState />
  }

  if (issues.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="scrollbar-sleek flex flex-col gap-2 overflow-y-auto">
      {issues.map((issue) => (
        <IssueListItem
          key={issue.id}
          issue={issue}
          isSelected={selectedIssue?.id === issue.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
