import { randomBytes } from 'node:crypto'
import { getCollaborationDb, type CollaborationDatabase } from './collaboration-database'
import type {
  CreateTeamMemberInput,
  DeleteConstraintResult,
  TeamMemberRecord,
  UpdateTeamMemberInput
} from '../../../shared/team-types'

// Why: list/array/record columns are stored as JSON text — SQLite has no native
// array type, and these are always consumed as whole values, never queried element-wise.
function serializeStrings(values: string[] | undefined): string {
  return JSON.stringify(values ?? [])
}

function deserializeStrings(text: string): string[] {
  if (!text) {
    return []
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function serializeRecord(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {})
}

function deserializeRecord(text: string): Record<string, unknown> {
  if (!text) {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

type TeamMemberRow = {
  id: string
  name: string
  role: string
  avatar_url: string | null
  personality: string
  responsibilities: string
  capabilities: string
  agent_type: string
  agent_model: string
  agent_config: string
  skills: string
  default_prompt: string
  is_active: number
  host_type: string
  workspace_access: string
  custom_model_package_dir: string | null
  identity: string | null
  created_at: string
  updated_at: string
}

function rowToRecord(row: TeamMemberRow): TeamMemberRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url ?? undefined,
    personality: row.personality,
    responsibilities: deserializeStrings(row.responsibilities),
    capabilities: deserializeStrings(row.capabilities),
    agentType: row.agent_type as TeamMemberRecord['agentType'],
    agentModel: row.agent_model,
    agentConfig: deserializeRecord(row.agent_config),
    skills: deserializeSkills(row.skills),
    defaultPrompt: row.default_prompt,
    isActive: row.is_active === 1,
    hostType: row.host_type,
    workspaceAccess: deserializeStrings(row.workspace_access),
    customModelPackageDir: row.custom_model_package_dir ?? undefined,
    identity: row.identity ?? undefined,
    // Why: aggregate counters are derived from child tables, not stored on the row.
    totalTasks: 0,
    activeProjects: 0,
    activeWorktrees: 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function deserializeSkills(text: string): TeamMemberRecord['skills'] {
  if (!text) {
    return []
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function newId(): string {
  // Why: short, URL-safe, collision-resistant local IDs (no UUID ceremony).
  return `tm_${randomBytes(8).toString('hex')}`
}

export type TeamStore = {
  create: (input: CreateTeamMemberInput) => TeamMemberRecord
  get: (id: string) => TeamMemberRecord | undefined
  list: () => TeamMemberRecord[]
  update: (input: UpdateTeamMemberInput) => TeamMemberRecord
  delete: (id: string) => void
  canDelete: (id: string) => DeleteConstraintResult
}

function prepareStatements(db: CollaborationDatabase) {
  return {
    insert: db.prepare(`
      INSERT INTO team_members (
        id, name, role, avatar_url, personality, responsibilities, capabilities,
        agent_type, agent_model, agent_config, skills, default_prompt, is_active,
        host_type, workspace_access, custom_model_package_dir, identity,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE team_members
      SET name = ?, role = ?, avatar_url = ?, personality = ?, responsibilities = ?,
          capabilities = ?, agent_type = ?, agent_model = ?, agent_config = ?,
          skills = ?, default_prompt = ?, is_active = ?, host_type = ?,
          workspace_access = ?, custom_model_package_dir = ?, identity = ?,
          updated_at = ?
      WHERE id = ?
    `),
    selectById: db.prepare(`SELECT * FROM team_members WHERE id = ?`),
    selectAll: db.prepare(`SELECT * FROM team_members ORDER BY created_at ASC`),
    delete: db.prepare(`DELETE FROM team_members WHERE id = ?`),
    countProjects: db.prepare(`SELECT COUNT(*) AS c FROM project_team_members WHERE member_id = ?`),
    countIssues: db.prepare(`SELECT COUNT(*) AS c FROM issues WHERE owner_id = ?`),
    // Why: FK issue_worktrees.member_id -> team_members is ON DELETE RESTRICT,
    // so ANY worktree (active or closed) blocks deletion. Count all, not just active.
    countWorktrees: db.prepare(`SELECT COUNT(*) AS c FROM issue_worktrees WHERE member_id = ?`),
    countPrs: db.prepare(`SELECT COUNT(*) AS c FROM pull_requests WHERE author_id = ?`)
  }
}

// Why: null = explicit clear, undefined = leave untouched. The store layer must
// honor this distinction so optional fields can be reset after first being set.
type MaybeClear<T> = T | null | undefined

function resolveField<T>(input: MaybeClear<T>, existing: T): T | null {
  if (input === undefined) {
    return existing as T | null
  }
  return input // null clears; value sets
}

function resolveString(input: MaybeClear<string>, existing: string): string {
  if (input === undefined) {
    return existing
  }
  return input ?? ''
}

export function createTeamStore(): TeamStore {
  const db = getCollaborationDb()
  const stmts = prepareStatements(db)

  function canDelete(id: string): DeleteConstraintResult {
    // Why: FK issue_worktrees.member_id -> team_members is ON DELETE RESTRICT,
    // so ANY worktree (active or closed) blocks team_members deletion. Soft gates
    // (project membership / issue owner / PR author) prevent orphaning.
    // Comments are NOT gated — they're history.
    const reasons: string[] = []
    const worktreeCount = (stmts.countWorktrees.get(id) as { c: number }).c
    if (worktreeCount > 0) {
      reasons.push(`仍有 ${worktreeCount} 个 worktree（含已关闭）`)
    }
    const projectCount = (stmts.countProjects.get(id) as { c: number }).c
    if (projectCount > 0) {
      reasons.push(`仍参与 ${projectCount} 个项目`)
    }
    const issueCount = (stmts.countIssues.get(id) as { c: number }).c
    if (issueCount > 0) {
      reasons.push(`仍是 ${issueCount} 个 Issue 的负责人`)
    }
    const prCount = (stmts.countPrs.get(id) as { c: number }).c
    if (prCount > 0) {
      reasons.push(`仍是 ${prCount} 个 PR 的作者`)
    }

    return reasons.length === 0 ? { canDelete: true } : { canDelete: false, reasons }
  }

  return {
    create(input) {
      // Why: defensive defaults so Store works even when called without Zod
      // (e.g., direct invocation from tests or future non-IPC callers).
      const name = input.name
      const role = input.role
      const avatarUrl = input.avatarUrl ?? undefined
      const personality = input.personality ?? ''
      const responsibilities = serializeStrings(input.responsibilities)
      const capabilities = serializeStrings(input.capabilities)
      const agentType = input.agentType
      const agentModel = input.agentModel
      const agentConfig = serializeRecord(input.agentConfig)
      const skills = JSON.stringify(input.skills ?? [])
      const defaultPrompt = input.defaultPrompt ?? ''
      const isActive = input.isActive ?? true
      const hostType = input.hostType ?? 'local'
      const workspaceAccess = serializeStrings(input.workspaceAccess)
      const customModelPackageDir = input.customModelPackageDir ?? undefined
      const identity = input.identity ?? undefined

      const now = new Date().toISOString()
      const id = newId()
      stmts.insert.run(
        id,
        name,
        role,
        avatarUrl ?? null,
        personality,
        responsibilities,
        capabilities,
        agentType,
        agentModel,
        agentConfig,
        skills,
        defaultPrompt,
        isActive ? 1 : 0,
        hostType,
        workspaceAccess,
        customModelPackageDir ?? null,
        identity ?? null,
        now,
        now
      )
      // Why: explicit return object — NOT `...input` — to guarantee all fields have
      // normalized values even when the caller omits optional fields. This keeps
      // TeamMemberRecord's type contract intact for direct (non-IPC) callers.
      return {
        id,
        name,
        role,
        avatarUrl,
        personality,
        responsibilities: deserializeStrings(responsibilities),
        capabilities: deserializeStrings(capabilities),
        agentType: agentType as TeamMemberRecord['agentType'],
        agentModel,
        agentConfig: deserializeRecord(agentConfig),
        skills: JSON.parse(skills) as TeamMemberRecord['skills'],
        defaultPrompt,
        isActive,
        hostType,
        workspaceAccess: deserializeStrings(workspaceAccess),
        customModelPackageDir,
        identity,
        // Why: aggregate counters are derived from child tables, not stored on the row.
        totalTasks: 0,
        activeProjects: 0,
        activeWorktrees: 0,
        createdAt: now,
        updatedAt: now
      }
    },

    get(id) {
      const row = stmts.selectById.get(id) as TeamMemberRow | undefined
      return row ? rowToRecord(row) : undefined
    },

    list() {
      const rows = stmts.selectAll.all() as TeamMemberRow[]
      return rows.map(rowToRecord)
    },

    update(input) {
      const existing = stmts.selectById.get(input.id) as TeamMemberRow | undefined
      if (!existing) {
        throw new Error(`Team member not found: ${input.id}`)
      }
      const now = new Date().toISOString()
      stmts.update.run(
        resolveString(input.name, existing.name),
        resolveString(input.role, existing.role),
        resolveField(input.avatarUrl, existing.avatar_url),
        resolveString(input.personality, existing.personality),
        input.responsibilities === undefined
          ? existing.responsibilities
          : serializeStrings(input.responsibilities),
        input.capabilities === undefined
          ? existing.capabilities
          : serializeStrings(input.capabilities),
        input.agentType ?? existing.agent_type,
        resolveString(input.agentModel, existing.agent_model),
        input.agentConfig === undefined
          ? existing.agent_config
          : serializeRecord(input.agentConfig),
        input.skills === undefined ? existing.skills : JSON.stringify(input.skills),
        resolveString(input.defaultPrompt, existing.default_prompt),
        input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
        input.hostType ?? existing.host_type,
        input.workspaceAccess === undefined
          ? existing.workspace_access
          : serializeStrings(input.workspaceAccess),
        resolveField(input.customModelPackageDir, existing.custom_model_package_dir),
        resolveField(input.identity, existing.identity),
        now,
        input.id
      )
      const updated = stmts.selectById.get(input.id) as TeamMemberRow
      return rowToRecord(updated)
    },

    delete(id) {
      // Why: enforce canDelete() as a hard application-layer constraint before the
      // DB sees the DELETE. The RESTRICT FK on business entities is the backstop.
      const check = canDelete(id)
      if (!check.canDelete) {
        throw new Error(`Cannot delete team member: ${check.reasons.join('; ')}`)
      }
      stmts.delete.run(id)
    },

    canDelete
  }
}

let storeInstance: TeamStore | null = null

export function getTeamStore(): TeamStore {
  if (!storeInstance) {
    storeInstance = createTeamStore()
  }
  return storeInstance
}

export function __resetTeamStoreForTests(): void {
  storeInstance = null
}
