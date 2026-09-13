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

