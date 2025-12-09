/**
 * GitLab Handler - Interaction avec GitLab API
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface GitLabHandlerConfig {
  enabled: boolean;
  token: string; // Personal Access Token
  api_url?: string | undefined; // https://gitlab.com/api/v4 par défaut
  default_project?: string | undefined; // project_id ou "namespace/project"
}

export interface GitLabActionConfig extends HandlerConfig {
  action: 'create_issue' | 'comment_issue' | 'create_file' | 'update_file' | 'trigger_pipeline' | 'create_release';
  // Project (ID numérique ou "namespace/project")
  project?: string | undefined;
  // Pour les issues
  title?: string | undefined;
  description?: string | undefined;
  labels?: string | undefined; // Séparés par virgule
  assignee_ids?: number[] | undefined;
  issue_iid?: number | undefined;
  // Pour les fichiers
  file_path?: string | undefined;
  content?: string | undefined;
  commit_message?: string | undefined;
  branch?: string | undefined;
  // Pour trigger_pipeline
  ref?: string | undefined;
  variables?: Array<{ key: string; value: string }> | undefined;
  // Pour create_release
  tag_name?: string | undefined;
  name?: string | undefined;
}

interface GitLabIssueResponse {
  id: number;
  iid: number;
  web_url: string;
  title: string;
}

interface GitLabNoteResponse {
  id: number;
  body: string;
}

interface GitLabFileResponse {
  file_path: string;
  branch: string;
}

interface GitLabPipelineResponse {
  id: number;
  web_url: string;
  status: string;
}

interface GitLabReleaseResponse {
  tag_name: string;
  name: string;
  description: string;
  _links: {
    self: string;
  };
}

export class GitLabHandler implements Handler {
  readonly name = 'GitLab Handler';
  readonly type = 'gitlab';

  private config: GitLabHandlerConfig;
  private apiUrl: string;

  constructor(config: GitLabHandlerConfig) {
    this.config = config;
    this.apiUrl = (config.api_url || 'https://gitlab.com/api/v4').replace(/\/$/, '');
  }

  async initialize(): Promise<void> {
    // Vérifier que le token fonctionne
    const response = await fetch(`${this.apiUrl}/user`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`GitLab authentication failed: ${response.status}`);
    }

    const user = (await response.json()) as { username: string };
    console.log(`[GitLab] Authentifié en tant que ${user.username}`);
  }

  private getHeaders(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.config.token,
      'Content-Type': 'application/json',
    };
  }

  private encodeProject(project: string): string {
    // GitLab API nécessite l'encodage URL du path du projet
    return encodeURIComponent(project);
  }

  private getProject(params: GitLabActionConfig): string {
    const project = params.project || this.config.default_project;
    if (!project) {
      throw new Error('Project non spécifié');
    }
    return this.encodeProject(project);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as GitLabActionConfig;
    const event = context.event as {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      content: string;
    };
    const transformedContent = (context.transformedContent as string) || event.content;

    try {
      switch (params.action) {
        case 'create_issue':
          return this.createIssue(params, transformedContent);
        case 'comment_issue':
          return this.commentIssue(params, transformedContent);
        case 'create_file':
          return this.createFile(params, transformedContent, event);
        case 'update_file':
          return this.updateFile(params, transformedContent, event);
        case 'trigger_pipeline':
          return this.triggerPipeline(params);
        case 'create_release':
          return this.createRelease(params, transformedContent);
        default:
          return { success: false, error: `Action inconnue: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async createIssue(
    params: GitLabActionConfig,
    content: string
  ): Promise<HandlerResult> {
    const project = this.getProject(params);

    const issueData: {
      title: string;
      description?: string;
      labels?: string;
      assignee_ids?: number[];
    } = {
      title: params.title || content.substring(0, 100),
    };

    if (params.description) {
      issueData.description = params.description;
    } else if (params.title) {
      issueData.description = content;
    }

    if (params.labels) {
      issueData.labels = params.labels;
    }

    if (params.assignee_ids && params.assignee_ids.length > 0) {
      issueData.assignee_ids = params.assignee_ids;
    }

    const response = await fetch(`${this.apiUrl}/projects/${project}/issues`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(issueData),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create issue: ${error}`);
    }

    const data = (await response.json()) as GitLabIssueResponse;
    console.log(`[GitLab] Issue créée: ${data.web_url}`);

    return {
      success: true,
      data: {
        action: 'create_issue',
        issue_id: data.id,
        issue_iid: data.iid,
        url: data.web_url,
        title: data.title,
      },
    };
  }

  private async commentIssue(
    params: GitLabActionConfig,
    content: string
  ): Promise<HandlerResult> {
    const project = this.getProject(params);
    if (!params.issue_iid) {
      return { success: false, error: 'issue_iid requis' };
    }

    const response = await fetch(
      `${this.apiUrl}/projects/${project}/issues/${params.issue_iid}/notes`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ body: params.description || content }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to comment issue: ${error}`);
    }

    const data = (await response.json()) as GitLabNoteResponse;
    console.log(`[GitLab] Commentaire ajouté à l'issue #${params.issue_iid}`);

    return {
      success: true,
      data: {
        action: 'comment_issue',
        note_id: data.id,
        issue_iid: params.issue_iid,
      },
    };
  }

  private async createFile(
    params: GitLabActionConfig,
    content: string,
    event: { id: string; pubkey: string; created_at: number }
  ): Promise<HandlerResult> {
    const project = this.getProject(params);

    const filePath = this.resolvePath(
      params.file_path || `events/${event.id}.json`,
      event
    );
    const fileContent = params.content || content;
    const commitMessage = params.commit_message || `Add ${filePath}`;
    const branch = params.branch || 'main';

    const response = await fetch(
      `${this.apiUrl}/projects/${project}/repository/files/${encodeURIComponent(filePath)}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          branch,
          content: fileContent,
          commit_message: commitMessage,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create file: ${error}`);
    }

    const data = (await response.json()) as GitLabFileResponse;
    console.log(`[GitLab] Fichier créé: ${data.file_path}`);

    return {
      success: true,
      data: {
        action: 'create_file',
        file_path: data.file_path,
        branch: data.branch,
      },
    };
  }

  private async updateFile(
    params: GitLabActionConfig,
    content: string,
    event: { id: string; pubkey: string; created_at: number }
  ): Promise<HandlerResult> {
    const project = this.getProject(params);

    if (!params.file_path) {
      return { success: false, error: 'file_path requis pour update_file' };
    }

    const filePath = this.resolvePath(params.file_path, event);
    const fileContent = params.content || content;
    const commitMessage = params.commit_message || `Update ${filePath}`;
    const branch = params.branch || 'main';

    const response = await fetch(
      `${this.apiUrl}/projects/${project}/repository/files/${encodeURIComponent(filePath)}`,
      {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({
          branch,
          content: fileContent,
          commit_message: commitMessage,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update file: ${error}`);
    }

    const data = (await response.json()) as GitLabFileResponse;
    console.log(`[GitLab] Fichier mis à jour: ${data.file_path}`);

    return {
      success: true,
      data: {
        action: 'update_file',
        file_path: data.file_path,
        branch: data.branch,
      },
    };
  }

  private async triggerPipeline(params: GitLabActionConfig): Promise<HandlerResult> {
    const project = this.getProject(params);

    const requestBody: {
      ref: string;
      variables?: Array<{ key: string; value: string }>;
    } = {
      ref: params.ref || 'main',
    };

    if (params.variables && params.variables.length > 0) {
      requestBody.variables = params.variables;
    }

    const response = await fetch(`${this.apiUrl}/projects/${project}/pipeline`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to trigger pipeline: ${error}`);
    }

    const data = (await response.json()) as GitLabPipelineResponse;
    console.log(`[GitLab] Pipeline déclenché: ${data.web_url}`);

    return {
      success: true,
      data: {
        action: 'trigger_pipeline',
        pipeline_id: data.id,
        status: data.status,
        url: data.web_url,
      },
    };
  }

  private async createRelease(
    params: GitLabActionConfig,
    content: string
  ): Promise<HandlerResult> {
    const project = this.getProject(params);

    if (!params.tag_name) {
      return { success: false, error: 'tag_name requis' };
    }

    const requestBody: {
      tag_name: string;
      name?: string;
      description?: string;
    } = {
      tag_name: params.tag_name,
    };

    if (params.name) {
      requestBody.name = params.name;
    }

    if (params.description) {
      requestBody.description = params.description;
    } else {
      requestBody.description = content;
    }

    const response = await fetch(`${this.apiUrl}/projects/${project}/releases`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create release: ${error}`);
    }

    const data = (await response.json()) as GitLabReleaseResponse;
    console.log(`[GitLab] Release créée: ${data.tag_name}`);

    return {
      success: true,
      data: {
        action: 'create_release',
        tag_name: data.tag_name,
        name: data.name,
        url: data._links.self,
      },
    };
  }

  private resolvePath(
    template: string,
    event: { id: string; pubkey: string; created_at: number }
  ): string {
    const now = new Date(event.created_at * 1000);
    return template
      .replace(/\{event_id\}/g, event.id.substring(0, 8))
      .replace(/\{pubkey\}/g, event.pubkey.substring(0, 8))
      .replace(/\{timestamp\}/g, String(event.created_at))
      .replace(/\{date\}/g, now.toISOString().split('T')[0]!)
      .replace(/\{datetime\}/g, now.toISOString().replace(/[:.]/g, '-'));
  }

  async shutdown(): Promise<void> {
    console.log('[GitLab] Handler arrêté');
  }
}
