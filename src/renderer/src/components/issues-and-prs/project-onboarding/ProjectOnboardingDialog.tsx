import { useCallback, useState } from 'react'
import { FolderOpen, GitBranch, GitPullRequestArrow } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Project } from '../../../../../shared/team-types'
import { translate } from '@/i18n/i18n'
import { deriveProjectHost } from './derive-project-host'

type OnboardingStep = 'source' | 'confirm' | 'git' | 'done'

export type ProjectOnboardingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPath?: string | null
  initialHostId?: string | null
  initialHostType?: string | null
  onComplete?: (project: Project) => void
}

// Why: default name from path basename using Node path semantics.
// Uses the same basename extraction as the rest of the app.
function defaultNameFromPath(path: string | null | undefined): string {
  if (!path) {
    return 'My Project'
  }
  // Why: extract basename manually to avoid importing Node path in renderer.
  // Handles both '/' and '\' separators for cross-platform compatibility.
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.at(-1) ?? 'My Project'
}

export function ProjectOnboardingDialog({
  open,
  onOpenChange,
  initialPath,
  initialHostId,
  initialHostType,
  onComplete
}: ProjectOnboardingDialogProps): React.JSX.Element {
  const [step, setStep] = useState<OnboardingStep>('source')
  const [repoPath, setRepoPath] = useState(initialPath ?? '')
  const [name, setName] = useState(defaultNameFromPath(initialPath))
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [isRegistering, setIsRegistering] = useState(false)
  const [createdProject, setCreatedProject] = useState<Project | null>(null)

  // Why: derive host from initialPath's executionHostId if provided
  const { hostId, hostType } = deriveProjectHost(
    initialHostType === 'local' ? 'local' : initialHostId
  )

  const handleClose = useCallback(() => {
    onOpenChange(false)
    // Why: reset state when dialog closes
    setStep('source')
    setRepoPath(initialPath ?? '')
    setName(defaultNameFromPath(initialPath))
    setDefaultBranch('main')
    setCreatedProject(null)
  }, [onOpenChange, initialPath])

  const handleSourceNext = useCallback(() => {
    if (!repoPath.trim()) {
      toast.error(
        translate(
          'auto.components.issuesAndPRs.projectOnboarding.pathRequired',
          'Please select a folder'
        )
      )
      return
    }
    setName(defaultNameFromPath(repoPath))
    setStep('confirm')
  }, [repoPath])

  const handleConfirmBack = useCallback(() => {
    setStep('source')
  }, [])

  const handlePickFolder = useCallback(async () => {
    // Why: use Electron's file picker via preload API
    if (window.api.repos.pickFolder) {
      const picked = await window.api.repos.pickFolder()
      if (picked) {
        setRepoPath(picked)
        setName(defaultNameFromPath(picked))
      }
    }
  }, [])

  const handleRegister = useCallback(async () => {
    if (!repoPath.trim() || !name.trim()) {
      toast.error(
        translate(
          'auto.components.issuesAndPRs.projectOnboarding.nameRequired',
          'Project name is required'
        )
      )
      return
    }

    setIsRegistering(true)
    try {
      // Why: register with strict contract — NO gitInitialized field
      const project = await window.api.collaboration.project.register({
        name: name.trim(),
        hostId,
        hostType,
        repoPath: repoPath.trim(),
        defaultBranch: defaultBranch.trim() || 'main'
      })

      setCreatedProject(project)

      // Why: probe git state after successful registration
      const probe = await window.api.collaboration.git.probeGit({ path: repoPath.trim() })

      if (!probe.isGitRepo) {
        setStep('git')
      } else {
        // Why: already a git repo, mark as initialized and complete
        await window.api.collaboration.project.markGitInitialized({
          id: project.id,
          initialized: true
        })
        setStep('done')
        onComplete?.(project)
      }
    } catch (error) {
      console.error('Failed to register project:', error)
      toast.error(
        translate(
          'auto.components.issuesAndPRs.projectOnboarding.registerError',
          'Failed to register project'
        )
      )
    } finally {
      setIsRegistering(false)
    }
  }, [repoPath, name, hostId, hostType, defaultBranch, onComplete])

  const handleInitGit = useCallback(async () => {
    if (!createdProject) {
      return
    }
    try {
      await window.api.collaboration.git.initGitRepo({ path: repoPath.trim() })
      await window.api.collaboration.project.markGitInitialized({
        id: createdProject.id,
        initialized: true
      })
      setStep('done')
      onComplete?.(createdProject)
    } catch (error) {
      console.error('Failed to init git:', error)
      toast.error(
        translate(
          'auto.components.issuesAndPRs.projectOnboarding.initGitError',
          'Failed to initialize git repository'
        )
      )
    }
  }, [createdProject, repoPath, onComplete])

  const handleSkipGit = useCallback(async () => {
    if (!createdProject) {
      return
    }
    // Why: user chose not to init git — mark as not initialized
    await window.api.collaboration.project.markGitInitialized({
      id: createdProject.id,
      initialized: false
    })
    setStep('done')
    onComplete?.(createdProject)
  }, [createdProject, onComplete])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.issuesAndPRs.projectOnboarding.title', 'Add Project')}
          </DialogTitle>
        </DialogHeader>

        {step === 'source' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>
                {translate(
                  'auto.components.issuesAndPRs.projectOnboarding.folder',
                  'Project folder'
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/path/to/project"
                />
                <Button variant="outline" size="icon" onClick={handlePickFolder}>
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSourceNext} disabled={!repoPath.trim()}>
                {translate('auto.components.issuesAndPRs.projectOnboarding.next', 'Next')}
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>
                {translate(
                  'auto.components.issuesAndPRs.projectOnboarding.projectName',
                  'Project name'
                )}
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                {translate(
                  'auto.components.issuesAndPRs.projectOnboarding.defaultBranch',
                  'Default branch'
                )}
              </Label>
              <Input
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <GitBranch className="size-3.5" />
              <span>{repoPath}</span>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={handleConfirmBack}>
                {translate('auto.components.issuesAndPRs.projectOnboarding.back', 'Back')}
              </Button>
              <Button onClick={handleRegister} disabled={isRegistering || !name.trim()}>
                {isRegistering
                  ? translate(
                      'auto.components.issuesAndPRs.projectOnboarding.registering',
                      'Registering...'
                    )
                  : translate(
                      'auto.components.issuesAndPRs.projectOnboarding.register',
                      'Register'
                    )}
              </Button>
            </div>
          </div>
        )}

        {step === 'git' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <GitPullRequestArrow className="size-8 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm">
                  {translate(
                    'auto.components.issuesAndPRs.projectOnboarding.notGitRepo',
                    'This folder is not a git repository.'
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.issuesAndPRs.projectOnboarding.initGitPrompt',
                    'Would you like to initialize git here?'
                  )}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleSkipGit}>
                {translate('auto.components.issuesAndPRs.projectOnboarding.skip', 'Skip')}
              </Button>
              <Button onClick={handleInitGit}>
                {translate(
                  'auto.components.issuesAndPRs.projectOnboarding.initGit',
                  'Initialize git'
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <GitPullRequestArrow className="size-8 text-green-600" />
              <p className="text-sm">
                {translate(
                  'auto.components.issuesAndPRs.projectOnboarding.complete',
                  'Project registered successfully!'
                )}
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleClose}>
                {translate('auto.components.issuesAndPRs.projectOnboarding.done', 'Done')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
