/** Server MCP supportati nella prima integrazione. */
export const MCP_SERVER_DEFINITIONS = [
  {
    id: 'notion',
    label: 'Notion',
    description: 'Pagine, database e ricerca nel workspace Notion.',
    secretHint: 'Token di integrazione Notion, ad esempio ntn_...',
    tokenUrl: 'https://www.notion.so/profile/integrations',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server', '--transport', 'stdio'],
    tokenEnv: 'NOTION_TOKEN',
  },
  {
    id: 'todoist',
    label: 'Todoist',
    description: 'Progetti e attività Todoist.',
    secretHint: 'API token Todoist.',
    tokenUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    command: 'npx',
    args: ['-y', '@doist/todoist-mcp'],
    tokenEnv: 'TODOIST_API_KEY',
  },
] as const;

export type McpServerId = typeof MCP_SERVER_DEFINITIONS[number]['id'];
export type McpAccountScope = 'global' | 'project';

export interface McpAccount {
  id: string;
  serverId: McpServerId;
  label: string;
  scope: McpAccountScope;
  /** Presente solo per account dedicati a un progetto. */
  projectId?: string;
  /** Nome di una variabile d'ambiente o chiave del secret store; mai il token in chiaro. */
  secretRef: string;
  defaultForServer: boolean;
  /** Indica se esiste un token risolvibile per questo account. */
  configured?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface McpRuntimeAccount {
  id: string;
  serverId: McpServerId;
  label: string;
  token: string;
  defaultForServer: boolean;
}

export interface McpRuntimeProvider {
  listAccounts(): Promise<McpRuntimeAccount[]>;
}

export interface McpSessionSettings {
  enabled: McpServerId[];
  accounts: Partial<Record<McpServerId, string>>;
}

export interface McpAccountSummary {
  id: string;
  serverId: McpServerId;
  label: string;
  scope: McpAccountScope;
  projectId?: string;
  defaultForServer: boolean;
}

export function isMcpServerId(value: unknown): value is McpServerId {
  return value === 'notion' || value === 'todoist';
}

export function mcpServerLabel(id: McpServerId): string {
  return MCP_SERVER_DEFINITIONS.find(server => server.id === id)?.label ?? id;
}
