import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Clock, GitMerge, GitPullRequest, User } from 'lucide-react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  PullRequest,
  PullRequestStatus,
  TeamMemberRecord
} from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'

const STATUS_ORDER: PullRequestStatus[] = ['open', 'merged', 'closed']

function formatDate(isoString: string): string {
  if (!isoString) {
    return ''
  }
  return new Date(isoString).toLocaleDateString()
}

// Why: use design tokens via color-mix so light/dark mode stay aligned (STYLEGUIDE §Color mixing)
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

function EmptyDetail(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.issuesAndPRs.PRDetail.selectPrompt',
          'Select a pull request to view details'
        )}
      </p>
    </div>
  )
}

export function PRDetail({
  pr,
  onUpdate
}: {
  pr: PullRequest | null
  onUpdate: (pr: PullRequest) => void
}): React.JSX.Element {
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [reviewerNames, setReviewerNames] = useState<Map<string, string>>(new Map())
  const [updating, setUpdating] = useState(false)

  // Why: resolve author and reviewer display names from team list when PR changes
  useEffect(() => {
    let cancelled = false
    setAuthorName(null)
    setReviewerNames(new Map())

    const memberIds = [pr?.authorId, ...(pr?.reviewers ?? [])].filter(Boolean) as string[]
    if (memberIds.length === 0) {
      return
    }

    void window.api.collaboration.team
      .list()
      .then((members: TeamMemberRecord[]) => {
        if (cancelled) {
          return
        }
        const nameMap = new Map<string, string>()
        for (const member of members) {
          nameMap.set(member.id, member.name)
        }
        setAuthorName(pr?.authorId ? (nameMap.get(pr.authorId) ?? null) : null)
        setReviewerNames(nameMap)
      })
      .catch(() => {
        if (!cancelled) {
          setAuthorName(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [pr?.authorId, pr?.reviewers])

  const handleStatusChange = useCallback(
    async (status: PullRequestStatus) => {
      if (!pr || updating) {
        return
      }
      setUpdating(true)
      try {
        const updated = await window.api.collaboration.pr.update({
          id: pr.id,
          status
        })
        onUpdate(updated)
      } catch (error) {
        console.error('Failed to update PR status:', error)
        toast.error(
          translate(
            'auto.components.issuesAndPRs.PRDetail.updateError',
            'Could not update pull request'
          )
        )
      } finally {
        setUpdating(false)
      }
    },
    [pr, updating, onUpdate]
  )

  if (!pr) {
    return <EmptyDetail />
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header: #number + title + status badge */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {pr.status === 'merged' ? (
            <GitMerge className="size-4 text-primary" />
          ) : (
            <GitPullRequest className="size-4" />
          )}
          <span className="text-sm text-muted-foreground">#{pr.number}</span>
          <h2 className="text-sm font-semibold">{pr.title}</h2>
        </div>
        <StatusBadge status={pr.status} />
      </div>

      {/* Branch info */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{pr.sourceBranch}</span>
        <ArrowRight className="size-3" />
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{pr.targetBranch}</span>
      </div>

      {/* Meta info: author + timestamps */}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <User className="size-3" />
          <span>
            {authorName ??
              translate('auto.components.issuesAndPRs.PRDetail.unknownAuthor', 'Unknown member')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          <span>
            {translate('auto.components.issuesAndPRs.PRDetail.created', 'Created')}:{' '}
            {formatDate(pr.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          <span>
            {translate('auto.components.issuesAndPRs.PRDetail.updated', 'Updated')}:{' '}
            {formatDate(pr.updatedAt)}
          </span>
        </div>
      </div>

      {/* Status selector */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="pr-status-select">
          {translate('auto.components.issuesAndPRs.PRDetail.status', 'Status')}
        </label>
        <Select
          value={pr.status}
          onValueChange={(v) => void handleStatusChange(v as PullRequestStatus)}
        >
          <SelectTrigger id="pr-status-select" className="w-32" disabled={updating}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                <span className="capitalize">{s}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reviewers & Approvals */}
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          {translate('auto.components.issuesAndPRs.PRDetail.reviewers', 'Reviewers')}:
        </span>
        {pr.reviewers.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {pr.reviewers.map((id) => (
              <span key={id} className="rounded bg-muted px-1.5 py-0.5">
                {reviewerNames.get(id) ??
                  translate('auto.components.issuesAndPRs.PRDetail.unknownMember', 'Unknown')}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">
            {translate('auto.components.issuesAndPRs.PRDetail.noReviewers', 'No reviewers')}
          </span>
        )}
      </div>

      {pr.approvals.length > 0 && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {translate('auto.components.issuesAndPRs.PRDetail.approvals', 'Approvals')}:
          </span>
          <div className="flex flex-wrap gap-1">
            {pr.approvals.map((id) => (
              <span key={id} className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                ✓ {reviewerNames.get(id) ?? id.slice(0, 8)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">
          {translate('auto.components.issuesAndPRs.PRDetail.description', 'Description')}
        </label>
        {pr.description ? (
          <p className="whitespace-pre-wrap text-sm">{pr.description}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            {translate(
              'auto.components.issuesAndPRs.PRDetail.noDescription',
              'No description provided'
            )}
          </p>
        )}
      </div>

      {/* Placeholder slot for future comments/worktree */}
      <div className="mt-auto border-t pt-3">
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.issuesAndPRs.PRDetail.commentsPlaceholder',
            'Comments coming soon'
          )}
        </p>
      </div>
    </div>
  )
}
