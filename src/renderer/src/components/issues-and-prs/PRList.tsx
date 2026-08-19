import { GitMerge, GitPullRequest, Loader2 } from 'lucide-react'
import type { PullRequest, PullRequestStatus } from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        {translate('auto.components.issuesAndPRs.PRList.noPRs', 'No pull requests yet')}
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

// Why: status badge uses design tokens via color-mix for light/dark consistency (C8 fix)
function StatusBadge({ status }: { status: PullRequestStatus }): React.JSX.Element {
  const style =
    status === 'merged'
      ? {
          background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
          color: 'var(--primary)'
        }
      : status === 'closed'
        ? {
            background: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
            color: 'var(--destructive)'
          }
        : {
            background: 'color-mix(in srgb, var(--success, #22c55e) 12%, transparent)',
            color: 'var(--success, #22c55e)'
          }

  return (
    <span className="rounded px-1.5 py-0.5 text-xs capitalize" style={style}>
      {status}
    </span>
  )
}

function PRListItem({
  pr,
  isSelected,
  onSelect
}: {
  pr: PullRequest
  isSelected: boolean
  onSelect: (pr: PullRequest) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(pr)}
      className={`flex w-full flex-col gap-1 rounded-md border p-3 text-left transition-colors ${
        isSelected ? 'border-primary bg-accent/50' : 'hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm font-medium">
          {pr.status === 'merged' ? (
            <GitMerge className="size-3.5" />
          ) : (
            <GitPullRequest className="size-3.5" />
          )}
          #{pr.number} {pr.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <StatusBadge status={pr.status} />
        <span>
          {pr.sourceBranch} → {pr.targetBranch}
        </span>
      </div>
    </button>
  )
}

export function PRList({
  prs,
  selectedPr,
  loading,
  onSelect
}: {
  prs: PullRequest[]
  selectedPr: PullRequest | null
  loading: boolean
  onSelect: (pr: PullRequest) => void
}): React.JSX.Element {
  if (loading) {
    return <LoadingState />
  }

  if (prs.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="scrollbar-sleek flex flex-col gap-2 overflow-y-auto">
      {prs.map((pr) => (
        <PRListItem key={pr.id} pr={pr} isSelected={selectedPr?.id === pr.id} onSelect={onSelect} />
      ))}
    </div>
  )
}
