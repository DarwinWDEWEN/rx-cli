import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const COLLABORATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['issue', 'comment'],
    summary: 'Add a comment to a collaboration issue',
    usage: 'orca issue comment <issueId> --member <memberId> --body <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'issueId', 'member', 'body'],
    positionalArgs: ['issueId'],
    examples: [
      'orca issue comment iss_abc123 --member tm_def456 --body "Implementation is ready for review."',
      'orca issue comment iss_abc123 --member tm_def456 --body "LGTM" --json'
    ]
  },
  {
    path: ['issue', 'update'],
    summary: 'Update a collaboration issue',
    usage:
      'orca issue update <issueId> --member <memberId> [--status open|done] [--title <title>] [--description <description>] [--priority low|medium|high|urgent] [--workline-state <state>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'issueId',
      'member',
      'status',
      'title',
      'description',
      'priority',
      'workline-state'
    ],
    positionalArgs: ['issueId'],
    examples: [
      'orca issue update iss_abc123 --member tm_def456 --status done',
      'orca issue update iss_abc123 --member tm_def456 --title "New title" --priority high --json'
    ]
  },
  {
    path: ['issue', 'get'],
    summary: 'Get a collaboration issue by ID',
    usage: 'orca issue get <issueId> [--json]',
    aliases: [['issue', 'show']],
    allowedFlags: [...GLOBAL_FLAGS, 'issueId'],
    positionalArgs: ['issueId'],
    examples: ['orca issue get iss_abc123', 'orca issue get iss_abc123 --json']
  },
  {
    path: ['issue', 'list'],
    summary: 'List collaboration issues',
    usage: 'orca issue list [--project <projectId>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project'],
    examples: ['orca issue list', 'orca issue list --project proj_abc123', 'orca issue list --json']
  }
]
