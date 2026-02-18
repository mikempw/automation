const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

export const api = {
  // Health
  health: () => request('/health'),

  // Devices
  listDevices: () => request('/devices/'),
  addDevice: (device) => request('/devices/', { method: 'POST', body: JSON.stringify(device) }),
  getDevice: (hostname) => request(`/devices/${hostname}`),
  updateDevice: (hostname, device) => request(`/devices/${hostname}`, { method: 'PUT', body: JSON.stringify(device) }),
  deleteDevice: (hostname) => request(`/devices/${hostname}`, { method: 'DELETE' }),
  testDevice: (hostname) => request(`/devices/${hostname}/test`, { method: 'POST' }),

  // Skills
  listSkills: () => request('/skills/'),
  getSkill: (name) => request(`/skills/${name}`),
  createSkill: (skill) => request('/skills/', { method: 'POST', body: JSON.stringify(skill) }),
  deleteSkill: (name) => request(`/skills/${name}`, { method: 'DELETE' }),

  // Execution
  execute: (req) => request('/execute/', { method: 'POST', body: JSON.stringify(req) }),
  executionHistory: (limit = 50) => request(`/execute/history?limit=${limit}`),
  getExecution: (id) => request(`/execute/history/${id}`),

  // SSE streaming execution
  executeStream: (req, onEvent) => {
    return new Promise((resolve, reject) => {
      fetch(`${BASE}/execute/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }).then(res => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        function read() {
          reader.read().then(({ done, value }) => {
            if (done) { resolve(); return; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const event = JSON.parse(line.slice(6));
                  onEvent(event);
                  if (event.type === 'execution_complete' || event.type === 'error') {
                    resolve(event);
                    return;
                  }
                } catch (e) { /* skip malformed */ }
              }
            }
            read();
          }).catch(reject);
        }
        read();
      }).catch(reject);
    });
  },

  // Chat
  chat: (messages) => request('/chat/', { method: 'POST', body: JSON.stringify({ messages }) }),
  chatExecute: (skill_request) => request('/chat/execute', { method: 'POST', body: JSON.stringify({ skill_request }) }),
  chatExecuteStream: (skill_request, onEvent) => {
    return new Promise((resolve, reject) => {
      fetch(`${BASE}/chat/execute/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_request }),
      }).then(res => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        function read() {
          reader.read().then(({ done, value }) => {
            if (done) { resolve(); return; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const event = JSON.parse(line.slice(6));
                  onEvent(event);
                  if (event.type === 'execution_complete' || event.type === 'error') {
                    resolve(event);
                    return;
                  }
                } catch (e) { /* skip */ }
              }
            }
            read();
          }).catch(reject);
        }
        read();
      }).catch(reject);
    });
  },

  // Conversations (chat history persistence)
  listConversations: (limit = 50) => request(`/conversations/?limit=${limit}`),
  createConversation: (title) => request('/conversations/', { method: 'POST', body: JSON.stringify({ title }) }),
  getConversation: (id) => request(`/conversations/${id}`),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: 'DELETE' }),
  renameConversation: (id, title) => request(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  addMessage: (convId, msg) => request(`/conversations/${convId}/messages`, { method: 'POST', body: JSON.stringify(msg) }),
  updateMessage: (msgId, updates) => request(`/conversations/messages/${msgId}`, { method: 'PATCH', body: JSON.stringify(updates) }),

  // Integrations (webhooks)
  listIntegrations: () => request('/integrations/'),
  createIntegration: (data) => request('/integrations/', { method: 'POST', body: JSON.stringify(data) }),
  getIntegration: (id) => request(`/integrations/${id}`),
  updateIntegration: (id, data) => request(`/integrations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteIntegration: (id) => request(`/integrations/${id}`, { method: 'DELETE' }),
  integrationLogs: (id, limit = 50) => request(`/integrations/${id}/logs?limit=${limit}`),

  // MCP Clients
  listMcpClients: () => request('/mcp-clients/'),
  addMcpClient: (data) => request('/mcp-clients/', { method: 'POST', body: JSON.stringify(data) }),
  discoverMcpTools: (id) => request(`/mcp-clients/${id}/discover`, { method: 'POST' }),
  callMcpTool: (id, toolName, args) => request(`/mcp-clients/${id}/call`, { method: 'POST', body: JSON.stringify({ tool_name: toolName, arguments: args }) }),
  deleteMcpClient: (id) => request(`/mcp-clients/${id}`, { method: 'DELETE' }),

  // Images
  listStagedImages: () => request('/images/staged'),
  deleteStagedImage: (filename) => request(`/images/staged/${filename}`, { method: 'DELETE' }),
  pushImage: (filename, device_hostname) => request('/images/push', { method: 'POST', body: JSON.stringify({ filename, device_hostname }) }),
  deviceImages: (hostname) => request(`/images/device/${hostname}`),
  uploadImage: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/images/upload`, { method: 'POST', body: formData });
    if (!res.ok) { const err = await res.text(); throw new Error(`Upload failed ${res.status}: ${err}`); }
    return res.json();
  },

  // Topology
  listVirtualServers: (hostname) => request(`/topology/${hostname}`),
  getTopology: (hostname, vs) => request(`/topology/${hostname}/${vs}`),

  // Automations
  listAutomations: () => request('/automations/'),
  automationTemplates: () => request('/automations/templates'),
  getAutomation: (id) => request(`/automations/${id}`),
  createAutomation: (data) => request('/automations/', { method: 'POST', body: JSON.stringify(data) }),
  updateAutomation: (id, data) => request(`/automations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAutomation: (id) => request(`/automations/${id}`, { method: 'DELETE' }),
  duplicateAutomation: (id) => request(`/automations/${id}/duplicate`, { method: 'POST' }),
  runAutomation: (id, body) => request(`/automations/${id}/run`, { method: 'POST', body: JSON.stringify(body) }),
  listAutomationRuns: (id, limit = 20) => request(`/automations/${id}/runs?limit=${limit}`),
  listAllAutomationRuns: (limit = 50) => request(`/automations/runs/all?limit=${limit}`),
  getAutomationRun: (runId) => request(`/automations/runs/${runId}`),
  resumeAutomationRun: (runId, body) => request(`/automations/runs/${runId}/resume`, { method: 'POST', body: JSON.stringify(body) }),

  // Clusters (ECMP Autoscale)
  listClusters: () => request('/clusters/'),
  getCluster: (id) => request(`/clusters/${id}`),
  getClusterParams: (id) => request(`/clusters/${id}/params`),
  createCluster: (data) => request('/clusters/', { method: 'POST', body: JSON.stringify(data) }),
  updateCluster: (id, data) => request(`/clusters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCluster: (id) => request(`/clusters/${id}`, { method: 'DELETE' }),
  getPoolStatus: (id) => request(`/clusters/${id}/ip-pool`),
  allocateIP: (id) => request(`/clusters/${id}/ip-pool/allocate`, { method: 'POST' }),
  releaseIP: (id, body) => request(`/clusters/${id}/ip-pool/release`, { method: 'POST', body: JSON.stringify(body) }),
  listMembers: (id) => request(`/clusters/${id}/members`),
  addMember: (id, body) => request(`/clusters/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),
  updateMember: (id, hostname, body) => request(`/clusters/${id}/members/${hostname}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeMember: (id, hostname) => request(`/clusters/${id}/members/${hostname}`, { method: 'DELETE' }),
};
