import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, GitPullRequestArrow, Loader2, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Issue, Project } from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'
import { ProjectOnboardingDialog } from './project-onboarding/ProjectOnboardingDialog'
import { useActiveWorkspaceSource } from './project-onboarding/use-active-workspace-source'
import { ProjectTeamPanel } from './ProjectTeamPanel'

type ViewTab = 'issues' | 'prs'
type DetailTab = 'detail' | 'team'

function EmptyProjectState({ onAddProject }: { onAddProject: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <GitPullRequestArrow className="size-7 text-muted-foreground" />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {translate(
              'auto.components.issuesAndPRs.IssuesAndPRsPage.noProjects',
              'No projects yet'
            )}
          </h3>
          <p className="text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.issuesAndPRs.IssuesAndPRsPage.noProjectsHint',
              'Register a project to start tracking issues and PRs.'
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onAddProject}>
          <Plus className="size-4" />
          {translate('auto.components.issuesAndPRs.IssuesAndPRsPage.addProject', 'Add project')}
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

function EmptyIssueState(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        {translate('auto.components.issuesAndPRs.IssuesAndPRsPage.noIssues', 'No issues yet')}
      </p>
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
            ? translate('auto.components.issuesAndPRs.IssuesAndPRsPage.closed', 'Closed')
            : translate('auto.components.issuesAndPRs.IssuesAndPRsPage.open', 'Open')}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize">{issue.priority}</span>
      </div>
    </button>
  )
}

function IssueDetailPlaceholder(): React.JSX.Element {
  // Why: detail panel structure placeholder for future IssueDetail component
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ChevronRight className="size-4" />
        <span>
          {translate(
            'auto.components.issuesAndPRs.IssuesAndPRsPage.selectIssueHint',
            'Select an issue to view details'
          )}
        </span>
      </div>
      {/* Why: placeholder for future IssueDetail content (title, description, comments, timeline) */}
      <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-8">
        <p className="text-sm text-muted-foreground">
          {translate(
            'auto.components.issuesAndPRs.IssuesAndPRsPage.detailPlaceholder',
            'Issue details coming soon'
          )}
        </p>
      </div>
    </div>
  )
}

function PRPlaceholder(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.issuesAndPRs.IssuesAndPRsPage.prsComingSoon',
          'PR list coming soon'
        )}
      </p>
    </div>
  )
}

export default function IssuesAndPRsPage(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [activeTab, setActiveTab] = useState<ViewTab>('issues')
  const [detailTab, setDetailTab] = useState<DetailTab>('team')
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const activeWorkspace = useActiveWorkspaceSource()
  const mountedRef = useRef(true)
  // Why: track request order to discard stale responses when switching projects rapidly
  const requestIdRef = useRef(0)

  const loadProjects = useCallback(async (): Promise<void> => {
    setLoadingProjects(true)
    try {
      const result = await window.api.collaboration.project.list()
      if (!mountedRef.current) {
        return
      }
      setProjects(result)
      if (result.length > 0 && !selectedProjectId) {
        setSelectedProjectId(result[0]!.id)
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
      if (!mountedRef.current) {
        return
      }
      toast.error(
        translate(
          'auto.components.issuesAndPRs.IssuesAndPRsPage.loadProjectsError',
          'Could not load projects'
        )
      )
    } finally {
      if (mountedRef.current) {
        setLoadingProjects(false)
      }
    }
  }, [selectedProjectId])

  const loadIssues = useCallback(async (projectId: string): Promise<void> => {
    // Why: increment request ID to track the latest request and discard stale responses
    const currentRequestId = ++requestIdRef.current
    setLoadingIssues(true)
    try {
      const result = await window.api.collaboration.issue.listByProject({ projectId })
      // Why: discard stale response if a newer request has been initiated
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) {
        return
      }
      setIssues(result)
    } catch (error) {
      console.error('Failed to load issues:', error)
      // Why: discard stale error if a newer request has been initiated
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) {
        return
      }
      toast.error(
        translate(
          'auto.components.issuesAndPRs.IssuesAndPRsPage.loadIssuesError',
          'Could not load issues'
        )
      )
    } finally {
      // Why: only clear loading if this request is still the latest
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setLoadingIssues(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadProjects()
    return () => {
      mountedRef.current = false
    }
  }, [loadProjects])

  useEffect(() => {
    setSelectedIssue(null)
    if (selectedProjectId) {
      void loadIssues(selectedProjectId)
    }
  }, [selectedProjectId, loadIssues])

  const handleOnboardingComplete = useCallback(
    (project: Project) => {
      // Why: refresh project list and select the newly created project
      void loadProjects()
      setSelectedProjectId(project.id)
    },
    [loadProjects]
  )

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {translate('auto.components.issuesAndPRs.IssuesAndPRsPage.title', 'Issues and PRs')}
        </h1>
      </div>

      {loadingProjects ? (
        <LoadingState />
      ) : projects.length === 0 ? (
        <EmptyProjectState onAddProject={() => setOnboardingOpen(true)} />
      ) : (
        <div className="flex h-full flex-col gap-4">
          {/* Project selector */}
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-64 rounded-md border px-2 py-1 text-sm"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          {/* Tab switcher */}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('issues')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                activeTab === 'issues'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {translate('auto.components.issuesAndPRs.IssuesAndPRsPage.issues', 'Issues')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('prs')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                activeTab === 'prs'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {translate('auto.components.issuesAndPRs.IssuesAndPRsPage.prs', 'PRs')}
            </button>
          </div>

          {/* Content area with list + detail panel */}
          {activeTab === 'issues' ? (
            <div className="flex h-full gap-4">
              {/* Issue list (left column) */}
              <div className="flex w-1/2 flex-col gap-2">
                {loadingIssues ? (
                  <LoadingState />
                ) : issues.length === 0 ? (
                  <EmptyIssueState />
                ) : (
                  <div className="scrollbar-sleek flex flex-col gap-2 overflow-y-auto">
                    {issues.map((issue) => (
                      <IssueListItem
                        key={issue.id}
                        issue={issue}
                        isSelected={selectedIssue?.id === issue.id}
                        onSelect={setSelectedIssue}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Detail panel (right column) */}
              <div className="flex w-1/2 flex-col rounded-md border">
                {/* Detail/Team tab switcher */}
                <div className="flex gap-1 border-b p-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab('detail')}
                    className={`rounded-md px-2 py-1 text-xs ${
                      detailTab === 'detail'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <ChevronRight className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('team')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                      detailTab === 'team'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Users className="size-3" />
                    {translate('auto.components.issuesAndPRs.IssuesAndPRsPage.team', 'Team')}
                  </button>
                </div>
                {detailTab === 'detail' ? (
                  <IssueDetailPlaceholder />
                ) : (
                  <ProjectTeamPanel projectId={selectedProjectId!} />
                )}
              </div>
            </div>
          ) : (
            <PRPlaceholder />
          )}
        </div>
      )}

      <ProjectOnboardingDialog
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        initialPath={activeWorkspace.path}
        initialHostId={activeWorkspace.hostId}
        initialHostType={activeWorkspace.hostType}
        onComplete={handleOnboardingComplete}
      />
    </div>
  )
}
