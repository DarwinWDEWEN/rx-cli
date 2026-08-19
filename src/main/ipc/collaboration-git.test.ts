import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: instead of mocking electron, we create a fake ipcMain and directly invoke
// the registration functions to test the same code path without Electron dependency.
const fakeIpcMain = {
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle(channel: string, handler: (...args: unknown[]) => unknown) {
    this.handlers.set(channel, handler)
  }
}

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => ':memory:') },
  ipcMain: fakeIpcMain
}))

// Why: mock git-probe to avoid actual git execution
const probeGitMock = vi.fn()
const initGitRepoMock = vi.fn()
vi.mock('../runtime/collaboration/git-probe', () => ({
  probeGit: (...args: unknown[]) => probeGitMock(...args),
  initGitRepo: (...args: unknown[]) => initGitRepoMock(...args)
}))

// Import and register the git handlers
const gitHandlers = await import('./collaboration-git')
gitHandlers.registerCollaborationGitHandlers()

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = fakeIpcMain.handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`)
  }
  // Why: wrap in Promise to convert sync throws into rejections for rejects.toThrow()
  return new Promise((resolve, reject) => {
    try {
      const result = handler({} as Electron.IpcMainInvokeEvent, ...args)
      resolve(result)
    } catch (error) {
      reject(error)
    }
  })
}

describe('collaboration-git IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collaboration:probeGit: calls probeGit with path', async () => {
    probeGitMock.mockReturnValue({ isGitRepo: true })

    const result = await invoke('collaboration:probeGit', { path: '/some/path' })

    expect(result).toEqual({ isGitRepo: true })
    expect(probeGitMock).toHaveBeenCalledWith('/some/path')
  })

  it('collaboration:initGitRepo: calls initGitRepo with path', async () => {
    initGitRepoMock.mockReturnValue({ initialized: true })

    const result = await invoke('collaboration:initGitRepo', { path: '/some/path' })

    expect(result).toEqual({ initialized: true })
    expect(initGitRepoMock).toHaveBeenCalledWith('/some/path')
  })

  it('collaboration:probeGit: throws when path is missing', async () => {
    await expect(invoke('collaboration:probeGit', {})).rejects.toThrow()
  })

  it('collaboration:initGitRepo: throws when path is empty', async () => {
    await expect(invoke('collaboration:initGitRepo', { path: '' })).rejects.toThrow()
  })
})
