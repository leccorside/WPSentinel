// Cliente HTTP para a API do WP Sentinel
async function request(endpoint, options = {}) {
  const res = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 401) {
    const error = new Error('Não autenticado');
    error.status = 401;
    throw error;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(text || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }

  return res.text();
}

export const api = {
  auth: {
    status: () => request('/api/auth/status'),
    login: (password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
  },
  health: () => request('/api/health'),
  status: () => request('/api/status'),
  overview: () => request('/api/overview'),
  alerts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/alerts${query ? `?${query}` : ''}`);
  },
  files: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/files${query ? `?${query}` : ''}`);
  },
  baselineDiff: (siteKey) => `/api/baseline-diff${siteKey ? `?site=${encodeURIComponent(siteKey)}` : ''}`,
  plan: () => request('/api/plan'),
  backups: () => request('/api/backups'),
  reports: {
    list: () => request('/api/reports'),
    get: (name) => request(`/api/reports/${encodeURIComponent(name)}`),
    rawUrl: (name) => `/api/reports/${encodeURIComponent(name)}/raw`,
    executive: () => request('/api/reports/executive'),
    executiveDownloadUrl: () => '/api/reports/executive/download',
  },
  jobs: {
    run: (type) => request('/api/jobs/run', { method: 'POST', body: JSON.stringify({ type }) }),
    current: () => request('/api/jobs/current'),
    confirmClean: (code) => request('/api/jobs/clean/confirm', { method: 'POST', body: JSON.stringify({ code }) }),
    cancelClean: () => request('/api/jobs/clean/cancel', { method: 'POST' }),
  },
  monitor: {
    start: () => request('/api/monitor/start', { method: 'POST' }),
    stop: () => request('/api/monitor/stop', { method: 'POST' }),
  },
  sites: {
    sessions: (siteKey) => request(`/api/sites/${encodeURIComponent(siteKey)}/sessions`),
    test: (siteKey) => request(`/api/sites/${encodeURIComponent(siteKey)}/test`, { method: 'POST' }),
    getManage: () => request('/api/sites-manage'),
    saveManage: (data) => request('/api/sites-manage', { method: 'POST', body: JSON.stringify(data) }),
    deleteManage: (key) => request(`/api/sites-manage/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    testManage: (data) => request('/api/sites-manage/test', { method: 'POST', body: JSON.stringify(data) }),
  },
  settings: {
    get: () => request('/api/settings'),
    update: (data) => request('/api/settings', { method: 'POST', body: JSON.stringify(data) }),
  },
  manualReview: {
    list: () => request('/api/manual-review'),
    mark: (key, reviewed, notes = '') =>
      request('/api/manual-review/mark', { method: 'POST', body: JSON.stringify({ key, reviewed, notes }) }),
  },
  notifications: {
    list: () => request('/api/notifications'),
    markRead: (id) => request('/api/notifications/read', { method: 'POST', body: JSON.stringify({ id }) }),
    markAllRead: () => request('/api/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) }),
  },
};
