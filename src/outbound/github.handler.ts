/**
 * GitHub Handler - Interaction avec GitHub API
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface GitHubHandlerConfig {
  enabled: boolean;
  token: string; // Personal Access Token
  api_url?: string | undefined; // Pour GitHub Enterprise
  default_owner?: string | undefined;
  default_repo?: string | undefined;
}

export interface GitHubActionConfig extends HandlerConfig {
  action: 'create_issue' | 'comment_issue' | 'create_file' | 'update_file' | 'trigger_workflow' | 'create_release';
  // Repository (peut être "owner/repo" ou séparé)
  repo?: string | undefined;
  owner?: string | undefined;
  // Pour les issues
  title?: string | undefined;
  body?: string | undefined;
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  issue_number?: number | undefined;
  // Pour les fichiers
  path?: string | undefined;
  content?: string | undefined;
  message?: string | undefined;
  branch?: string | undefined;
  sha?: string | undefined; // Pour update_file
  // Pour trigger_workflow
  workflow_id?: string | undefined;
  ref?: string | undefined;
  inputs?: Record<string, string> | undefined;
  // Pour create_release
  tag_name?: string | undefined;
  name?: string | undefined;
  draft?: boolean | undefined;
  prerelease?: boolean | undefined;
}

interface GitHubIssueResponse {
  id: number;
  number: number;
  html_url: string;
  title: string;
}

interface GitHubCommentResponse {
  id: number;
  html_url: string;
}

interface GitHubFileResponse {
  content: {
    path: string;
    sha: string;
    html_url: string;
  };
  commit: {
    sha: string;
    html_url: string;
  };
}

interface GitHubReleaseResponse {
  id: number;
  tag_name: string;
  html_url: string;
}

export class GitHubHandler implements Handler {
  readonly name = 'GitHub Handler';
  readonly type = 'github';

  private config: GitHubHandlerConfig;
  private apiUrl: string;

  constructor(config: GitHubHandlerConfig) {
    this.config = config;
    this.apiUrl = (config.api_url || 'https://api.github.com').replace(/\/$/, '');
  }

  async initialize(): Promise<void> {
    // Vérifier que le token fonctionne
    const response = await fetch(`${this.apiUrl}/user`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`GitHub authentication failed: ${response.status}`);
    }

    const user = (await response.json()) as { login: string };
    console.log(`[GitHub] Authentifié en tant que ${user.login}`);
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  private parseRepo(params: GitHubActionConfig): { owner: string; repo: string } {
    if (params.repo?.includes('/')) {
      const [owner, repo] = params.repo.split('/');
      return { owner: owner!, repo: repo! };
    }
    return {
      owner: params.owner || this.config.default_owner || '',
      repo: params.repo || this.config.default_repo || '',
    };
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as GitHubActionConfig;
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
        case 'trigger_workflow':
          return this.triggerWorkflow(params);
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
    params: GitHubActionConfig,
    content: string
  ): Promise<HandlerResult> {
    const { owner, repo } = this.parseRepo(params);
    if (!owner || !repo) {
      return { success: false, error: 'Repository non spécifié (owner/repo)' };
    }

    const issueData: {
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
    } = {
      title: params.title || content.substring(0, 100),
    };

    if (params.body) {
      issueData.body = params.body;
    } else if (params.title) {
      issueData.body = content;
    }

    if (params.labels && params.labels.length > 0) {
      issueData.labels = params.labels;
    }

    if (params.assignees && params.assignees.length > 0) {
      issueData.assignees = params.assignees;
    }

    const response = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(issueData),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create issue: ${error}`);
    }

    const data = (await response.json()) as GitHubIssueResponse;
    console.log(`[GitHub] Issue créée: ${data.html_url}`);

    return {
      success: true,
      data: {
        action: 'create_issue',
        issue_id: data.id,
        issue_number: data.number,
        url: data.html_url,
        title: data.title,
      },
    };
  }

  private async commentIssue(
    params: GitHubActionConfig,
    content: string
  ): Promise<HandlerResult> {
    const { owner, repo } = this.parseRepo(params);
    if (!owner || !repo) {
      return { success: false, error: 'Repository non spécifié' };
    }
    if (!params.issue_number) {
      return { success: false, error: 'issue_number requis' };
    }

    const response = await fetch(
      `${this.apiUrl}/repos/${owner}/${repo}/issues/${params.issue_number}/comments`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ body: params.body || content }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to comment issue: ${error}`);
    }

    const data = (await response.json()) as GitHubCommentResponse;
    console.log(`[GitHub] Commentaire ajouté: ${data.html_url}`);

    return {
      success: true,
      data: {
        action: 'comment_issue',
        comment_id: data.id,
        issue_number: params.issue_number,
        url: data.html_url,
      },
    };
  }

  private async createFile(
    params: GitHubActionConfig,
    content: string,
    event: { id: string; pubkey: string; created_at: number }
  ): Promise<HandlerResult> {
    const { owner, repo } = this.parseRepo(params);
    if (!owner || !repo) {
      return { success: false, error: 'Repository non spécifié' };
    }

    const path = this.resolvePath(params.path || `events/${event.id}.json`, event);
    const fileContent = params.content || content;
    const message = params.message || `Add ${path}`;

    const requestBody: {
      message: string;
      content: string;
      branch?: string;
    } = {
      message,
      content: Buffer.from(fileContent).toString('base64'),
    };

    if (params.branch) {
      requestBody.branch = params.branch;
    }

    const response = await fetch(
      `${this.apiUrl}/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create file: ${error}`);
    }

    const data = (await response.json()) as GitHubFileResponse;
    console.log(`[GitHub] Fichier créé: ${data.content.html_url}`);

    return {
      success: true,
      data: {
        action: 'create_file',
        path: data.content.path,
        sha: data.content.sha,
        commit_sha: data.commit.sha,
        url: data.content.html_url,
      },
    };
  }

  private async updateFile(
    params: GitHubActionConfig,
    content: string,
    event: { id: string; pubkey: string; created_at: number }
  ): Promise<HandlerResult> {
    const { owner, repo } = this.parseRepo(params);
    if (!owner || !repo) {
      return { success: false, error: 'Repository non spécifié' };
    }
    if (!params.path) {
      return { success: false, error: 'path requis pour update_file' };
    }

    const path = this.resolvePath(params.path, event);

    // Récupérer le SHA actuel si non fourni
    let sha = params.sha;
    if (!sha) {
      const getResponse = await fetch(
        `${this.apiUrl}/repos/${owner}/${repo}/contents/${path}${params.branch ? `?ref=${params.branch}` : ''}`,
        { headers: this.getHeaders() }
      );
      if (getResponse.ok) {
        const fileData = (await getResponse.json()) as { sha: string };
        sha = fileData.sha;
      }
    }

    if (!sha) {
      return { success: false, error: 'Fichier non trouvé ou sha non fourni' };
    }

    const fileContent = params.content || content;
    const message = params.message || `Update ${path}`;

    const requestBody: {
      message: string;
      content: string;
      sha: string;
      branch?: string;
    } = {
      message,
      content: Buffer.from(fileContent).toString('base64'),
      sha,
    };

    if (params.branch) {
      requestBody.branch = params.branch;
    }

    const response = await fetch(
      `${this.apiUrl}/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update file: ${error}`);
    }

    const data = (await response.json()) as GitHubFileResponse;
    console.log(`[GitHub] Fichier mis à jour: ${data.content.html_url}`);

    return {
      success: true,
      data: {
        action: 'update_file',
        path: data.content.path,
        sha: data.content.sha,
        commit_sha: data.commit.sha,
        url: data.content.html_url,
      },
    };
  }

  private async triggerWorkflow(params: GitHubActionConfig): Promise<HandlerResult> {
    const { owner, repo } = this.parseRepo(params);
    if (!owner || !repo) {
      return { success: false, error: 'Repository non spécifié' };
    }
    if (!params.workflow_id) {
      return { success: false, error: 'workflow_id requis' };
    }

    const requestBody: {
      ref: string;
      inputs?: Record<string, string>;
    } = {
      ref: params.ref || 'main',
    };

    if (params.inputs) {
      requestBody.inputs = params.inputs;
    }

    const response = await fetch(
      `${this.apiUrl}/repos/${owner}/${repo}/actions/workflows/${params.workflow_id}/dispatches`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to trigger workflow: ${error}`);
    }

    console.log(`[GitHub] Workflow ${params.workflow_id} déclenché`);

    return {
      success: true,
      data: {
        action: 'trigger_workflow',
        workflow_id: params.workflow_id,
        ref: requestBody.ref,
      },
    };
  }

  private async createRelease(
    params: GitHubActionConfig,
    content: string
  ): Promise<HandlerResult> {
    const { owner, repo } = this.parseRepo(params);
    if (!owner || !repo) {
      return { success: false, error: 'Repository non spécifié' };
    }
    if (!params.tag_name) {
      return { success: false, error: 'tag_name requis' };
    }

    const requestBody: {
      tag_name: string;
      name?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
    } = {
      tag_name: params.tag_name,
    };

    if (params.name) {
      requestBody.name = params.name;
    }

    if (params.body) {
      requestBody.body = params.body;
    } else {
      requestBody.body = content;
    }

    if (params.draft !== undefined) {
      requestBody.draft = params.draft;
    }

    if (params.prerelease !== undefined) {
      requestBody.prerelease = params.prerelease;
    }

    const response = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create release: ${error}`);
    }

    const data = (await response.json()) as GitHubReleaseResponse;
    console.log(`[GitHub] Release créée: ${data.html_url}`);

    return {
      success: true,
      data: {
        action: 'create_release',
        release_id: data.id,
        tag_name: data.tag_name,
        url: data.html_url,
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
    console.log('[GitHub] Handler arrêté');
  }
}
