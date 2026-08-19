import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, GitPullRequestArrow, Loader2, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Issue, Project, PullRequest } from '../../../../shared/team-types'
import { translate } from '@/i18n/i18n'
import { IssueDetail } from './IssueDetail'
import { IssueList } from './IssueList'
import { PRDetail } from './PRDetail'
import { PRList } from './PRList'
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

export default function IssuesAndPRsPage(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [prs, setPrs] = useState<PullRequest[]>([])
  const [selectedPr, setSelectedPr] = useState<PullRequest | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [loadingPrs, setLoadingPrs] = useState(false)
  const [activeTab, setActiveTab] = useState<ViewTab>('issues')
  const [detailTab, setDetailTab] = useState<DetailTab>('team')
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const activeWorkspace = useActiveWorkspaceSource()
  const mountedRef = useRef(true)
  // Why: track request order to discard stale responses when switching projects rapidly
  // Separate refs for issues and PRs to avoid cross-contamination
  const issueRequestIdRef = useRef(0)
  const prRequestIdRef = useRef(0)

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
    const currentRequestId = ++issueRequestIdRef.current
    setLoadingIssues(true)
    try {
      const result = await window.api.collaboration.issue.listByProject({ projectId })
      // Why: discard stale response if a newer request has been initiated
      if (!mountedRef.current || currentRequestId !== issueRequestIdRef.current) {
        return
      }
      setIssues(result)
    } catch (error) {
      console.error('Failed to load issues:', error)
      // Why: discard stale error if a newer request has been initiated
      if (!mountedRef.current || currentRequestId !== issueRequestIdRef.current) {
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
      if (mountedRef.current && currentRequestId === issueRequestIdRef.current) {
        setLoadingIssues(false)
      }
    }
  }, [])

  const loadPrs = useCallback(async (projectId: string): Promise<void> => {
    const currentRequestId = ++prRequestIdRef.current
    setLoadingPrs(true)
    try {
      const result = await window.api.collaboration.pr.listByProject({ projectId })
      if (!mountedRef.current || currentRequestId !== prRequestIdRef.current) {
        return
      }
      setPrs(result)
    } catch (error) {
      console.error('Failed to load PRs:', error)
      if (!mountedRef.current || currentRequestId !== prRequestIdRef.current) {
        return
      }
      toast.error(
        translate(
          'auto.components.issuesAndPRs.IssuesAndPRsPage.loadPrsError',
          'Could not load pull requests'
        )
      )
    } finally {
      if (mountedRef.current && currentRequestId === prRequestIdRef.current) {
        setLoadingPrs(false)
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
    setSelectedPr(null)
    if (selectedProjectId) {
      void loadIssues(selectedProjectId)
      void loadPrs(selectedProjectId)
    }
  }, [selectedProjectId, loadIssues, loadPrs])

  const handleOnboardingComplete = useCallback(
    (project: Project) => {
      // Why: refresh project list and select the newly created project
      void loadProjects()
      setSelectedProjectId(project.id)
    },
    [loadProjects]
  )

  // Why: sync updated issue back to both selectedIssue and the list
  const handleIssueUpdate = useCallback((updated: Issue) => {
    setSelectedIssue(updated)
    setIssues((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }, [])

  // Why: selecting an issue auto-switches to detail panel so user sees issue info immediately
  const handleSelectIssue = useCallback((issue: Issue) => {
    setSelectedIssue(issue)
    setDetailTab('detail')
  }, [])

  // Why: sync updated PR back to both selectedPr and the list
  const handlePRUpdate = useCallback((updated: PullRequest) => {
    setSelectedPr(updated)
    setPrs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }, [])

  // Why: selecting a PR auto-switches to detail panel so user sees PR info immediately
  const handleSelectPR = useCallback((pr: PullRequest) => {
    setSelectedPr(pr)
    setDetailTab('detail')
  }, [])

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
                <IssueList
                  issues={issues}
                  selectedIssue={selectedIssue}
                  loading={loadingIssues}
                  onSelect={handleSelectIssue}
                />
              </div>

              {/* Detail panel (right column) */}
              <div className="flex w-1/2 flex-col rounded-md border">
                {/* Detail/Team tab switcher */}
                <div className="flex gap-1 border-b p-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab('detail')}
                    aria-label={translate(
                      'auto.components.issuesAndPRs.IssuesAndPRsPage.detail',
                      'Detail'
                    )}
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
                  <IssueDetail issue={selectedIssue} onUpdate={handleIssueUpdate} />
                ) : (
                  <ProjectTeamPanel projectId={selectedProjectId!} />
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full gap-4">
              {/* PR list (left column) */}
              <div className="flex w-1/2 flex-col gap-2">
                <PRList
                  prs={prs}
                  selectedPr={selectedPr}
                  loading={loadingPrs}
                  onSelect={handleSelectPR}
                />
              </div>

              {/* Detail panel (right column) */}
              <div className="flex w-1/2 flex-col rounded-md border">
                {/* Detail/Team tab switcher */}
                <div className="flex gap-1 border-b p-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab('detail')}
                    aria-label={translate(
                      'auto.components.issuesAndPRs.IssuesAndPRsPage.detail',
                      'Detail'
                    )}
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
                  <PRDetail pr={selectedPr} onUpdate={handlePRUpdate} />
                ) : (
                  <ProjectTeamPanel projectId={selectedProjectId!} />
                )}
              </div>
            </div>
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
