import { useCallback, useEffect, useState } from 'react'
import { Clock, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  Issue,
  IssuePriority,
  IssueStatus,
  TeamMemberRecord
} from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'

const PRIORITY_ORDER: IssuePriority[] = ['low', 'medium', 'high', 'urgent']

function formatDate(isoString: string): string {
  if (!isoString) {
    return ''
  }
  return new Date(isoString).toLocaleDateString()
}

// Why: use design tokens via color-mix so light/dark mode stay aligned (STYLEGUIDE §Color mixing)
function PriorityBadge({ priority }: { priority: IssuePriority }): React.JSX.Element {
  const style =
    priority === 'urgent'
      ? {
          background: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
          color: 'var(--destructive)'
        }
      : priority === 'high'
        ? {
            background: 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)',
            color: 'var(--warning, #f59e0b)'
          }
        : {
            background: 'var(--muted)',
            color: 'var(--muted-foreground)'
          }

  return (
    <span className="rounded px-1.5 py-0.5 text-xs capitalize" style={style}>
      {priority}
    </span>
  )
}

function StatusToggle({
  status,
  disabled,
  onChange
}: {
  status: IssueStatus
  disabled: boolean
  onChange: (status: IssueStatus) => void
}): React.JSX.Element {
  const isOpen = status === 'open'
  return (
    <Button
      variant={isOpen ? 'default' : 'outline'}
      size="sm"
      disabled={disabled}
      onClick={() => onChange(isOpen ? 'done' : 'open')}
    >
      {isOpen
        ? translate('auto.components.issuesAndPRs.IssueDetail.open', 'Open')
        : translate('auto.components.issuesAndPRs.IssueDetail.closed', 'Closed')}
    </Button>
  )
}

function EmptyDetail(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.issuesAndPRs.IssueDetail.selectPrompt',
          'Select an issue to view details'
        )}
      </p>
    </div>
  )
}

export function IssueDetail({
  issue,
  onUpdate
}: {
  issue: Issue | null
  onUpdate: (issue: Issue) => void
}): React.JSX.Element {
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  // Why: resolve owner display name from team list when issue changes
  useEffect(() => {
    let cancelled = false
    setOwnerName(null)

    if (!issue?.ownerId) {
      return
    }

    void window.api.collaboration.team
      .list()
      .then((members: TeamMemberRecord[]) => {
        if (cancelled) {
          return
        }
        const owner = members.find((m) => m.id === issue.ownerId)
        setOwnerName(owner?.name ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setOwnerName(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [issue?.ownerId])

  const handleStatusChange = useCallback(
    async (status: IssueStatus) => {
      if (!issue || updating) {
        return
      }
      setUpdating(true)
      try {
        const updated = await window.api.collaboration.issue.update({
          id: issue.id,
          status
        })
        onUpdate(updated)
      } catch (error) {
        console.error('Failed to update issue status:', error)
        toast.error(
          translate(
            'auto.components.issuesAndPRs.IssueDetail.updateError',
            'Could not update issue'
          )
        )
      } finally {
        setUpdating(false)
      }
    },
    [issue, updating, onUpdate]
  )

  const handlePriorityChange = useCallback(
    async (priority: IssuePriority) => {
      if (!issue || updating) {
        return
      }
      setUpdating(true)
      try {
        const updated = await window.api.collaboration.issue.update({
          id: issue.id,
          priority
        })
        onUpdate(updated)
      } catch (error) {
        console.error('Failed to update issue priority:', error)
        toast.error(
          translate(
            'auto.components.issuesAndPRs.IssueDetail.updateError',
            'Could not update issue'
          )
        )
      } finally {
        setUpdating(false)
      }
    },
    [issue, updating, onUpdate]
  )

  if (!issue) {
    return <EmptyDetail />
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header: #number + title + badges */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">#{issue.number}</span>
          <h2 className="text-sm font-semibold">{issue.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusToggle status={issue.status} disabled={updating} onChange={handleStatusChange} />
          <PriorityBadge priority={issue.priority} />
        </div>
      </div>

      {/* Meta info: owner + timestamps */}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <User className="size-3" />
          <span>
            {ownerName ??
              translate('auto.components.issuesAndPRs.IssueDetail.unassigned', 'Unassigned')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          <span>
            {translate('auto.components.issuesAndPRs.IssueDetail.created', 'Created')}:{' '}
            {formatDate(issue.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          <span>
            {translate('auto.components.issuesAndPRs.IssueDetail.updated', 'Updated')}:{' '}
            {formatDate(issue.updatedAt)}
          </span>
        </div>
      </div>

      {/* Priority selector */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="priority-select">
          {translate('auto.components.issuesAndPRs.IssueDetail.priority', 'Priority')}
        </label>
        <Select
          value={issue.priority}
          onValueChange={(v) => void handlePriorityChange(v as IssuePriority)}
        >
          <SelectTrigger id="priority-select" className="w-32" disabled={updating}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_ORDER.map((p) => (
              <SelectItem key={p} value={p}>
                <span className="capitalize">{p}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">
          {translate('auto.components.issuesAndPRs.IssueDetail.description', 'Description')}
        </label>
        {issue.description ? (
          <p className="whitespace-pre-wrap text-sm">{issue.description}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            {translate(
              'auto.components.issuesAndPRs.IssueDetail.noDescription',
              'No description provided'
            )}
          </p>
        )}
      </div>

      {/* Placeholder slots for future C9/D6 */}
      <div className="mt-auto border-t pt-3">
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.issuesAndPRs.IssueDetail.commentsPlaceholder',
            'Comments coming soon'
          )}
        </p>
      </div>
    </div>
  )
}
