import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  CreateTeamMemberInput,
  TeamMemberRecord,
  UpdateTeamMemberInput
} from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'

// Why: agent types supported by the collaboration system
const AGENT_TYPES = ['codex', 'claude', 'gemini', 'opencode'] as const
const AGENT_MODELS: Record<string, string[]> = {
  codex: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
  claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  opencode: ['opencode-default']
}

export function MemberFormDialog({
  open,
  onOpenChange,
  initialMember,
  onSubmit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMember: TeamMemberRecord | null
  onSubmit: (input: CreateTeamMemberInput | UpdateTeamMemberInput) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [agentType, setAgentType] = useState<string>('codex')
  const [agentModel, setAgentModel] = useState<string>('claude-sonnet-4-20250514')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [skills, setSkills] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Why: reset form when dialog opens with a new member (or no member for create)
  useEffect(() => {
    if (open) {
      setName(initialMember?.name ?? '')
      setRole(initialMember?.role ?? '')
      setAgentType(initialMember?.agentType ?? 'codex')
      setAgentModel(initialMember?.agentModel ?? 'claude-sonnet-4-20250514')
      setDefaultPrompt(initialMember?.defaultPrompt ?? '')
      setSkills(initialMember?.skills?.map((s) => s.skillName).join(', ') ?? '')
      setIsActive(initialMember?.isActive ?? true)
    }
  }, [open, initialMember])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!name.trim() || !role.trim()) {
      return
    }

    // Why: convert comma-separated string input to SkillBinding[] format
    const skillBindings = skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((skillName, idx) => ({
        skillId: `skill-${idx}`,
        skillName,
        enabled: true
      }))

    if (initialMember) {
      onSubmit({
        id: initialMember.id,
        name: name.trim(),
        role: role.trim(),
        agentType,
        agentModel,
        defaultPrompt: defaultPrompt.trim(),
        skills: skillBindings,
        isActive
      })
    } else {
      onSubmit({
        name: name.trim(),
        role: role.trim(),
        agentType,
        agentModel,
        defaultPrompt: defaultPrompt.trim(),
        skills: skillBindings,
        isActive
      })
    }
  }

  const isEditing = initialMember !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? translate('auto.components.teams.TeamsPage.editMember', 'Edit member')
              : translate('auto.components.teams.TeamsPage.createMember', 'Create member')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-name">
              {translate('auto.components.teams.TeamsPage.name', 'Name')}
            </Label>
            <Input
              id="member-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={translate(
                'auto.components.teams.TeamsPage.namePlaceholder',
                'Member name'
              )}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-role">
              {translate('auto.components.teams.TeamsPage.role', 'Role')}
            </Label>
            <Input
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={translate(
                'auto.components.teams.TeamsPage.rolePlaceholder',
                'e.g. Developer, Reviewer'
              )}
              required
            />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>{translate('auto.components.teams.TeamsPage.agentType', 'Agent')}</Label>
              <Select value={agentType} onValueChange={setAgentType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>{translate('auto.components.teams.TeamsPage.model', 'Model')}</Label>
              <Select value={agentModel} onValueChange={setAgentModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(AGENT_MODELS[agentType] ?? []).map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-prompt">
              {translate('auto.components.teams.TeamsPage.defaultPrompt', 'Default prompt')}
            </Label>
            <Textarea
              id="member-prompt"
              value={defaultPrompt}
              onChange={(e) => setDefaultPrompt(e.target.value)}
              placeholder={translate(
                'auto.components.teams.TeamsPage.promptPlaceholder',
                'Optional default prompt for this member...'
              )}
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-skills">
              {translate('auto.components.teams.TeamsPage.skills', 'Skills')}
            </Label>
            <Input
              id="member-skills"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder={translate(
                'auto.components.teams.TeamsPage.skillsPlaceholder',
                'Comma-separated: react, typescript, testing'
              )}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="member-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="member-active">
              {translate('auto.components.teams.TeamsPage.isActive', 'Active')}
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {translate('auto.components.teams.TeamsPage.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || !role.trim()}>
              {isEditing
                ? translate('auto.components.teams.TeamsPage.save', 'Save')
                : translate('auto.components.teams.TeamsPage.create', 'Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
