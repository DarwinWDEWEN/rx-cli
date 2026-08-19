import { useCallback, useEffect, useState } from 'react'
import { Crown, Loader2, UserMinus, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { TeamMemberRecord } from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'

type ProjectTeamMemberDisplay = TeamMemberRecord & {
  roleInProject: 'owner' | 'member'
}

function EmptyTeamState(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.issuesAndPRs.ProjectTeamPanel.noMembers',
          'No team members in this project'
        )}
      </p>
    </div>
  )
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center p-4">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  )
}

function MemberRow({
  member,
  onRemove,
  onChangeOwner
}: {
  member: ProjectTeamMemberDisplay
  onRemove: (member: ProjectTeamMemberDisplay) => void
  onChangeOwner: (member: ProjectTeamMemberDisplay) => void
}): React.JSX.Element {
  const isOwner = member.roleInProject === 'owner'

  return (
    <div className="flex items-center justify-between rounded-md border p-2">
      <div className="flex items-center gap-2">
        {isOwner && <Crown className="size-4 text-amber-500" />}
        <div className="flex flex-col">
          <span className="text-sm font-medium">{member.name}</span>
          <span className="text-xs text-muted-foreground">
            {isOwner
              ? translate('auto.components.issuesAndPRs.ProjectTeamPanel.owner', 'Owner')
              : translate('auto.components.issuesAndPRs.ProjectTeamPanel.member', 'Member')}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isOwner && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onChangeOwner(member)}
            aria-label={translate(
              'auto.components.issuesAndPRs.ProjectTeamPanel.makeOwner',
              'Make owner'
            )}
          >
            <Crown className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => onRemove(member)}
          aria-label={translate('auto.components.issuesAndPRs.ProjectTeamPanel.remove', 'Remove')}
        >
          <UserMinus className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function ProjectTeamPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const [members, setMembers] = useState<ProjectTeamMemberDisplay[]>([])
  const [allTeamMembers, setAllTeamMembers] = useState<TeamMemberRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')

  const loadTeamData = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [projectMembers, teamMembers] = await Promise.all([
        window.api.collaboration.project.listMembers({ projectId }),
        window.api.collaboration.team.list()
      ])

      // Why: enrich project members with full team member details
      const enriched = projectMembers.map((pm): ProjectTeamMemberDisplay => {
        const teamMember = teamMembers.find((tm) => tm.id === pm.memberId)
        return {
          ...(teamMember ?? {
            id: pm.memberId,
            name: pm.memberId,
            role: '',
            agentType: 'claude',
            agentModel: '',
            personality: '',
            responsibilities: [],
            capabilities: [],
            agentConfig: {},
            skills: [],
            defaultPrompt: '',
            isActive: true,
            hostType: 'local',
            workspaceAccess: [],
            totalTasks: 0,
            activeProjects: 0,
            activeWorktrees: 0,
            createdAt: '',
            updatedAt: ''
          }),
          roleInProject: pm.roleInProject as 'owner' | 'member'
        }
      })
      setMembers(enriched)
      setAllTeamMembers(teamMembers)
    } catch (error) {
      console.error('Failed to load team data:', error)
      toast.error(
        translate(
          'auto.components.issuesAndPRs.ProjectTeamPanel.loadError',
          'Could not load project team'
        )
      )
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadTeamData()
  }, [loadTeamData])

  const handleInvite = useCallback(async (): Promise<void> => {
    if (!selectedMemberId) {
      return
    }
    try {
      await window.api.collaboration.project.inviteMember({
        projectId,
        memberId: selectedMemberId,
        roleInProject: 'member'
      })
      toast.success(
        translate('auto.components.issuesAndPRs.ProjectTeamPanel.invited', 'Member invited')
      )
      setInviteDialogOpen(false)
      setSelectedMemberId('')
      await loadTeamData()
    } catch (error) {
      console.error('Failed to invite member:', error)
      const message = error instanceof Error ? error.message : 'Could not invite member'
      toast.error(message)
    }
  }, [projectId, selectedMemberId, loadTeamData])

  const handleRemove = useCallback(
    async (member: ProjectTeamMemberDisplay): Promise<void> => {
      try {
        await window.api.collaboration.project.removeMember({
          projectId,
          memberId: member.id
        })
        toast.success(
          translate('auto.components.issuesAndPRs.ProjectTeamPanel.removed', 'Member removed')
        )
        await loadTeamData()
      } catch (error) {
        console.error('Failed to remove member:', error)
        const message = error instanceof Error ? error.message : 'Could not remove member'
        toast.error(message)
      }
    },
    [projectId, loadTeamData]
  )

  const handleChangeOwner = useCallback(
    async (member: ProjectTeamMemberDisplay): Promise<void> => {
      try {
        await window.api.collaboration.project.changeOwner({
          projectId,
          newOwnerMemberId: member.id
        })
        toast.success(
          translate('auto.components.issuesAndPRs.ProjectTeamPanel.ownerChanged', 'Owner changed')
        )
        await loadTeamData()
      } catch (error) {
        console.error('Failed to change owner:', error)
        const message = error instanceof Error ? error.message : 'Could not change owner'
        toast.error(message)
      }
    },
    [projectId, loadTeamData]
  )

  // Why: filter out members already in the project
  const candidateMembers = allTeamMembers.filter((tm) => !members.some((m) => m.id === tm.id))

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-4" />
          <h2 className="text-sm font-semibold">
            {translate('auto.components.issuesAndPRs.ProjectTeamPanel.title', 'Project Team')}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setInviteDialogOpen(true)}
          disabled={candidateMembers.length === 0}
        >
          <UserPlus className="size-3.5" />
          {translate('auto.components.issuesAndPRs.ProjectTeamPanel.invite', 'Invite')}
        </Button>
      </div>

      {loading ? (
        <LoadingState />
      ) : members.length === 0 ? (
        <EmptyTeamState />
      ) : (
        <div className="scrollbar-sleek flex flex-col gap-2 overflow-y-auto">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              onRemove={handleRemove}
              onChangeOwner={handleChangeOwner}
            />
          ))}
        </div>
      )}

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.issuesAndPRs.ProjectTeamPanel.inviteTitle',
                'Invite Member'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.issuesAndPRs.ProjectTeamPanel.inviteDescription',
                'Select a team member to invite to this project.'
              )}
            </DialogDescription>
          </DialogHeader>
          <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
            <SelectTrigger>
              <SelectValue
                placeholder={translate(
                  'auto.components.issuesAndPRs.ProjectTeamPanel.selectMember',
                  'Select a member'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {candidateMembers.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              {translate('auto.components.issuesAndPRs.ProjectTeamPanel.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void handleInvite()} disabled={!selectedMemberId}>
              {translate('auto.components.issuesAndPRs.ProjectTeamPanel.invite', 'Invite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
