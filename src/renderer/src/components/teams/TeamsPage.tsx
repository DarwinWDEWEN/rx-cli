import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pencil, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type {
  CreateTeamMemberInput,
  TeamMemberRecord,
  UpdateTeamMemberInput
} from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'
import { MemberFormDialog } from './MemberFormDialog'

function EmptyTeamState({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Users className="size-7 text-muted-foreground" />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {translate('auto.components.teams.TeamsPage.emptyTitle', 'No team members yet')}
          </h3>
          <p className="text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.teams.TeamsPage.emptyHint',
              'Create your first team member to get started.'
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          {translate('auto.components.teams.TeamsPage.addMember', 'Add member')}
        </Button>
      </div>
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

function MemberListItem({
  member,
  onEdit
}: {
  member: TeamMemberRecord
  onEdit: (member: TeamMemberRecord) => void
}): React.JSX.Element {
  // Why: truncate long prompts to keep list items compact
  const truncatedPrompt =
    member.defaultPrompt.length > 60
      ? `${member.defaultPrompt.slice(0, 60)}...`
      : member.defaultPrompt

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{member.name}</span>
          <span className="text-xs text-muted-foreground">{member.role}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs ${member.isActive ? 'text-green-600' : 'text-muted-foreground'}`}
          >
            {member.isActive
              ? translate('auto.components.teams.TeamsPage.active', 'Active')
              : translate('auto.components.teams.TeamsPage.inactive', 'Inactive')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onEdit(member)}
            aria-label={translate('auto.components.teams.TeamsPage.editMember', 'Edit member')}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{member.agentType}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{member.agentModel}</span>
      </div>
      {truncatedPrompt ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">
            {translate('auto.components.teams.TeamsPage.prompt', 'Prompt')}:
          </span>{' '}
          {truncatedPrompt}
        </p>
      ) : null}
      {member.skills.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {member.skills.slice(0, 3).map((skill) => (
            <span key={skill.skillId} className="rounded bg-secondary px-1.5 py-0.5 text-xs">
              {skill.skillName}
            </span>
          ))}
          {member.skills.length > 3 ? (
            <span className="text-xs text-muted-foreground">+{member.skills.length - 3}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function TeamsPage(): React.JSX.Element {
  const [members, setMembers] = useState<TeamMemberRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMemberRecord | null>(null)
  const mountedRef = useRef(true)

  const loadMembers = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.collaboration.team.list()
      if (mountedRef.current) {
        setMembers(result)
      }
    } catch (error) {
      console.error('Failed to load team members:', error)
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.teams.TeamsPage.loadError', 'Could not load team members')
        )
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadMembers()
    return () => {
      mountedRef.current = false
    }
  }, [loadMembers])

  const handleCreate = useCallback((): void => {
    setEditingMember(null)
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((member: TeamMemberRecord): void => {
    setEditingMember(member)
    setDialogOpen(true)
  }, [])

  const handleSubmit = useCallback(
    async (input: CreateTeamMemberInput | UpdateTeamMemberInput): Promise<void> => {
      try {
        // Why: both branches return Promise<void>, satisfying ternary type consistency
        const action =
          'id' in input
            ? window.api.collaboration.team.update(input)
            : window.api.collaboration.team.create(input)
        await action
        setDialogOpen(false)
        void loadMembers()
      } catch (error) {
        console.error('Failed to save team member:', error)
        toast.error(
          translate('auto.components.teams.TeamsPage.saveError', 'Could not save team member')
        )
      }
    },
    [loadMembers]
  )

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {translate('auto.components.teams.TeamsPage.title', 'Teams')}
        </h1>
        <Button variant="outline" size="sm" onClick={handleCreate}>
          <Plus className="size-4" />
          {translate('auto.components.teams.TeamsPage.addMember', 'Add member')}
        </Button>
      </div>

      {loading ? (
        <LoadingState />
      ) : members.length === 0 ? (
        <EmptyTeamState onCreate={handleCreate} />
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((member) => (
            <MemberListItem key={member.id} member={member} onEdit={handleEdit} />
          ))}
        </div>
      )}

      <MemberFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialMember={editingMember}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
