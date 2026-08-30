const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8090';

async function safeFetch(endpoint: string, options: RequestInit = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  try {
    return await fetch(url, options);
  } catch (err) {
    if (url.includes('localhost')) {
      const fallbackUrl = url.replace('localhost', '127.0.0.1');
      return await fetch(fallbackUrl, options);
    } else if (url.includes('127.0.0.1')) {
      const fallbackUrl = url.replace('127.0.0.1', 'localhost');
      return await fetch(fallbackUrl, options);
    }
    throw err;
  }
}

function getAuthHeaders(token?: string) {
  const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null);
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
  };
}

export async function loginUser(payload: { email: string; password: string }) {
  try {
    const res = await safeFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Login failed');
    }
    return await res.json();
  } catch (err: any) {
    console.error('Login error:', err);
    throw err;
  }
}

export async function registerUser(payload: { email: string; password: string; full_name?: string; role?: string }) {
  try {
    const res = await safeFetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Registration failed');
    }
    return await res.json();
  } catch (err: any) {
    console.error('Register error:', err);
    throw err;
  }
}


export async function fetchCurrentUser(token?: string) {
  try {
    const res = await safeFetch('/api/v1/auth/me', {
      headers: getAuthHeaders(token),
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Fetch current user error:', err);
    return null;
  }
}

export async function forgotPassword(email: string) {
  try {
    const res = await safeFetch('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!res.ok) throw new Error('Failed to request password reset');
    return await res.json();
  } catch (err: any) {
    console.error('Forgot password error:', err);
    throw err;
  }
}

export async function resetPassword(payload: { email: string; reset_token: string; new_password: string }) {
  try {
    const res = await safeFetch('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Password reset failed');
    }
    return await res.json();
  } catch (err: any) {
    console.error('Reset password error:', err);
    throw err;
  }
}

export async function updateGitHubToken(github_token: string) {
  try {
    const res = await safeFetch('/api/v1/auth/github-token', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ github_token })
    });
    if (!res.ok) throw new Error('Failed to update GitHub token');
    return await res.json();
  } catch (err: any) {
    console.error('Update GitHub token error:', err);
    throw err;
  }
}

export async function disconnectGitHubToken() {
  try {
    const res = await safeFetch('/api/v1/auth/github-token', {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to disconnect GitHub token');
    return await res.json();
  } catch (err: any) {
    console.error('Disconnect GitHub token error:', err);
    throw err;
  }
}

export async function fetchIncidents() {
  try {
    const res = await safeFetch('/api/v1/incidents/', {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

/**
 * Resolve a connected repository's numeric ID by its full name (owner/repo) or short name.
 * Returns null if not found — the backend will then try to resolve by service_name itself.
 */
export async function fetchRepositoryIdByName(repoName: string): Promise<number | null> {
  try {
    const res = await safeFetch('/api/v1/repositories/', {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const repos: Array<{ id: number; name: string; owner: string }> = await res.json();
    const lower = repoName.toLowerCase();
    const match = repos.find((r) => {
      const full = `${r.owner}/${r.name}`.toLowerCase();
      return full === lower || r.name.toLowerCase() === lower;
    });
    return match ? match.id : null;
  } catch {
    return null;
  }
}

export async function fetchRepositoryBranches(repoId: number): Promise<string[]> {
  try {
    const res = await safeFetch(`/api/v1/repositories/${repoId}/branches`, {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if (!res.ok) return ['main', 'master'];
    return await res.json();
  } catch (err) {
    console.error('Error fetching repository branches:', err);
    return ['main', 'master'];
  }
}

export async function fetchIncidentLogs(incidentId: string) {
  try {
    const res = await safeFetch(`/api/v1/incidents/${incidentId}/logs`, {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Error fetching incident logs:', err);
    return null;
  }
}

export async function createIncident(payload: { title: string; description?: string; severity: string; service_name: string; repository_id?: number; branch?: string }) {
  try {
    let repoId = payload.repository_id;
    if (!repoId && payload.service_name) {
      repoId = (await fetchRepositoryIdByName(payload.service_name)) ?? undefined;
    }

    const res = await safeFetch('/api/v1/incidents/', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        title: payload.title,
        description: payload.description || 'Reported from Command Center',
        severity: payload.severity.toUpperCase(),
        service_name: payload.service_name,
        branch: payload.branch || 'main',
        ...(repoId !== undefined && repoId !== null ? { repository_id: repoId } : {}),
        deployment_id: 'deploy-live',
        commit_sha: null
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Create Incident API error response:', errText);
      throw new Error(`API Error ${res.status}: ${errText}`);
    }
    return await res.json();
  } catch (err) {
    console.error('Error creating incident:', err);
    return null;
  }
}

export async function fetchRepositories() {
  try {
    const res = await safeFetch('/api/v1/repositories/', {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function deleteIncident(incidentId: string): Promise<boolean> {
  try {
    const res = await safeFetch(`/api/v1/incidents/${incidentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return res.ok || res.status === 204;
  } catch (err) {
    console.error('Error deleting incident:', err);
    return false;
  }
}

export async function reinvestigateIncident(incidentId: string, branch: string = 'main') {
  try {
    const res = await safeFetch(`/api/v1/incidents/${incidentId}/reinvestigate?branch=${encodeURIComponent(branch)}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('API Error');
    return await res.json();
  } catch (err) {
    console.error('Error reinvestigating incident:', err);
    return null;
  }
}

export async function connectRepository(payload: { name: string; owner?: string; language?: string }) {
  try {
    let owner = payload.owner || 'acme';
    let repoName = payload.name;
    if (payload.name.includes('/')) {
      const parts = payload.name.split('/');
      owner = parts[0];
      repoName = parts[1];
    }
    const res = await safeFetch('/api/v1/repositories/', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: repoName,
        owner: owner,
        github_url: `https://github.com/${owner}/${repoName}`,
        default_branch: 'main',
        language: payload.language || 'TypeScript'
      })
    });
    if (!res.ok) throw new Error('API Error');
    return await res.json();
  } catch (err) {
    console.error('Error connecting repository:', err);
    return null;
  }
}

export async function fetchAgentRuns() {
  try {
    const res = await safeFetch('/api/v1/agent-runs/', {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('API Error');
    return await res.json();
  } catch (err) {
    console.error('Error fetching agent runs:', err);
    return null;
  }
}

export async function approveFix(fixId: string, decision: 'APPROVED' | 'REJECTED') {
  try {
    const res = await safeFetch(`/api/v1/fixes/${fixId}/approve`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ decision, comments: 'Approved from Command Center UI' })
    });
    if (!res.ok) throw new Error('API Error');
    return await res.json();
  } catch (err) {
    console.error('Error approving fix:', err);
    return null;
  }
}

// ── Terminal API ───────────────────────────────────────────────────────────────

export async function fetchAllowedCommands(): Promise<string[]> {
  try {
    const res = await safeFetch('/api/v1/terminal/allowed-commands', { headers: getAuthHeaders() });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function fetchDockerContainers(): Promise<Array<{
  id: string; name: string; status: string; image: string; ports: string;
}>> {
  try {
    const res = await safeFetch('/api/v1/terminal/docker-containers', { headers: getAuthHeaders() });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function startLocalTerminal(payload: { command: string; working_dir: string }): Promise<{ session_id: string; status: string } | null> {
  try {
    const res = await safeFetch('/api/v1/terminal/local', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `API Error ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('Error starting local terminal:', err);
    throw err;
  }
}

export async function startDockerTerminal(container_id: string): Promise<{ session_id: string; status: string } | null> {
  try {
    const res = await safeFetch('/api/v1/terminal/docker', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ container_id }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Error starting docker terminal:', err);
    return null;
  }
}

export async function stopLocalTerminal(sessionId: string): Promise<void> {
  try {
    await safeFetch(`/api/v1/terminal/local/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  } catch { /* ignore */ }
}

export async function stopDockerTerminal(sessionId: string): Promise<void> {
  try {
    await safeFetch(`/api/v1/terminal/docker/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  } catch { /* ignore */ }
}

export async function analyzeErrorText(errorText: string, sessionId?: string) {
  try {
    const res = await safeFetch('/api/v1/terminal/analyze-error', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ error_text: errorText, session_id: sessionId || 'manual' }),
    });
    if (!res.ok) throw new Error('Analysis failed');
    return await res.json();
  } catch (err) {
    console.error('Error analyzing error text:', err);
    return null;
  }
}

export async function createIncidentFromTerminalError(payload: {
  session_id: string;
  error_id: string;
  title: string;
  severity: string;
  service_name?: string;
}) {
  try {
    const res = await safeFetch('/api/v1/terminal/create-incident-from-error', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
