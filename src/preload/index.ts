import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentEvent,
  Api,
  CreateCollectionInput,
  ExportInput,
  IndexEvent,
  PermissionDecision,
  SendMessageInput,
  Settings,
  StartThreadInput
} from '../shared/types'

const api: Api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
    pickMatterRoot: () => ipcRenderer.invoke('settings:pickMatterRoot')
  },
  key: {
    status: () => ipcRenderer.invoke('key:status'),
    set: (apiKey: string) => ipcRenderer.invoke('key:set', apiKey),
    clear: () => ipcRenderer.invoke('key:clear'),
    test: () => ipcRenderer.invoke('key:test')
  },
  ollama: {
    models: () => ipcRenderer.invoke('ollama:models')
  },
  matters: {
    list: () => ipcRenderer.invoke('matters:list'),
    get: (id: string) => ipcRenderer.invoke('matters:get', id),
    delete: (id: string) => ipcRenderer.invoke('matters:delete', id),
    documentDocx: (id: string) => ipcRenderer.invoke('matters:documentDocx', id)
  },
  agent: {
    start: (input: StartThreadInput) => ipcRenderer.invoke('agent:start', input),
    send: (input: SendMessageInput) => ipcRenderer.invoke('agent:send', input),
    cancel: (matterId: string) => ipcRenderer.invoke('agent:cancel', matterId),
    resolvePermission: (requestId: string, decision: PermissionDecision) =>
      ipcRenderer.send('agent:resolvePermission', requestId, decision),
    onEvent: (cb: (e: AgentEvent) => void) => {
      const listener = (_e: unknown, payload: AgentEvent): void => cb(payload)
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    }
  },
  files: {
    pick: () => ipcRenderer.invoke('files:pick'),
    reveal: (p: string) => ipcRenderer.invoke('files:reveal', p),
    estimateTokens: (paths: string[]) => ipcRenderer.invoke('files:estimateTokens', paths)
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    create: (input: CreateCollectionInput) => ipcRenderer.invoke('library:create', input),
    get: (id: string) => ipcRenderer.invoke('library:get', id),
    delete: (id: string) => ipcRenderer.invoke('library:delete', id),
    reindex: (id: string) => ipcRenderer.invoke('library:reindex', id),
    cancel: (id: string) => ipcRenderer.invoke('library:cancel', id),
    search: (id: string, query: string) => ipcRenderer.invoke('library:search', id, query),
    exportIndex: (id: string, format: 'xlsx' | 'docx') => ipcRenderer.invoke('library:export', id, format),
    pickFolders: () => ipcRenderer.invoke('library:pickFolders'),
    onEvent: (cb: (e: IndexEvent) => void) => {
      const listener = (_e: unknown, payload: IndexEvent): void => cb(payload)
      ipcRenderer.on('index:event', listener)
      return () => ipcRenderer.removeListener('index:event', listener)
    }
  },
  export: (input: ExportInput) => ipcRenderer.invoke('export', input)
}

contextBridge.exposeInMainWorld('api', api)
