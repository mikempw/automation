import React, { useState, useEffect, useCallback, useRef } from 'react';

// ═══════════════════════════════════════════════════════════
// ServiceNow Polaris Theme
// ═══════════════════════════════════════════════════════════
const snow = {
  // Chrome/nav
  navBg: '#1b2a32',
  navBgDark: '#0d1b24',
  navText: '#c3cdd5',
  navTextActive: '#ffffff',
  navAccent: '#62d84e',  // ServiceNow green
  navHover: '#243a44',
  // Header
  headerBg: '#293e40',
  // Surface
  bg: '#f1f1f1',
  surface: '#ffffff',
  surfaceAlt: '#f5f5f5',
  border: '#d6d6d6',
  borderLight: '#e8e8e8',
  // Text
  text: '#333333',
  textMuted: '#666666',
  textDim: '#999999',
  textLink: '#005ad2',
  // Status
  green: '#2c9930',
  greenBg: '#e8f5e9',
  red: '#c83932',
  redBg: '#fce4ec',
  amber: '#e8a018',
  amberBg: '#fff8e1',
  blue: '#005ad2',
  blueBg: '#e3f2fd',
  purple: '#6a3ec4',
  // Priority
  p1: '#c83932',  p1Bg: '#fce4ec',
  p2: '#e8a018',  p2Bg: '#fff8e1',
  p3: '#2c9930',  p3Bg: '#e8f5e9',
  p4: '#666666',  p4Bg: '#f5f5f5',
  // Insight
  insightBg: '#e8edf5',
  insightAccent: '#3b82f6',
};

const BASE = '/api';
async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}
const api = {
  health: () => req('/health'),
  stats: () => req('/stats'),
  incidents: (state) => req(`/incidents${state ? `?state=${state}` : ''}`),
  incident: (n) => req(`/incidents/${n}`),
  create: (data) => req('/incidents', { method: 'POST', body: JSON.stringify(data) }),
  update: (n, data) => req(`/incidents/${n}`, { method: 'PUT', body: JSON.stringify(data) }),
  del: (n) => req(`/incidents/${n}`, { method: 'DELETE' }),
  addNote: (n, content, author) => req(`/incidents/${n}/notes`, { method: 'POST', body: JSON.stringify({ content, author }) }),
  analyze: (n) => req(`/incidents/${n}/analyze`, { method: 'POST' }),
  approve: (n, approved_by) => req(`/incidents/${n}/approve`, { method: 'POST', body: JSON.stringify({ approved_by: approved_by || 'admin' }) }),
  reject: (n, reason) => req(`/incidents/${n}/reject`, { method: 'POST', body: JSON.stringify({ rejected_by: 'admin', reason: reason || 'Rejected by operator' }) }),
};

// ═══════════════════════════════════════════════════════════
// GLOBAL STYLES (ServiceNow Polaris)
// ═══════════════════════════════════════════════════════════
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Source Sans 3', 'Helvetica Neue', Arial, sans-serif; background: ${snow.bg}; color: ${snow.text}; font-size: 14px; -webkit-font-smoothing: antialiased; }
  input, select, textarea { font-family: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid ${snow.border}; border-radius: 3px; outline: none; background: #fff; color: ${snow.text}; width: 100%; }
  input:focus, select:focus, textarea:focus { border-color: ${snow.blue}; box-shadow: 0 0 0 1px ${snow.blue}; }
  select { padding: 5px 6px; cursor: pointer; }
  button { font-family: inherit; font-size: 13px; padding: 5px 14px; border: 1px solid ${snow.border}; border-radius: 3px; cursor: pointer; background: #fff; color: ${snow.text}; transition: all 0.1s; }
  button:hover { background: ${snow.surfaceAlt}; }
  pre { font-family: 'Menlo', 'Monaco', 'Courier New', monospace; }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes insightPulse { 0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0.3)} 50%{box-shadow:0 0 0 6px rgba(59,130,246,0)} }
`;

// ═══════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════
function SNField({ label, required, children, span }) {
  return <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: snow.textMuted, marginBottom: 3, letterSpacing: 0.2 }}>
      {label}{required && <span style={{ color: snow.red, marginLeft: 2 }}>*</span>}
    </label>
    {children}
  </div>;
}

function PriorityBadge({ priority }) {
  const map = {
    '1 - Critical': { bg: snow.p1Bg, fg: snow.p1, dot: snow.p1 },
    '2 - High': { bg: snow.p2Bg, fg: snow.p2, dot: snow.p2 },
    '3 - Moderate': { bg: snow.p3Bg, fg: snow.p3, dot: snow.p3 },
    '4 - Low': { bg: snow.p4Bg, fg: snow.p4, dot: snow.p4 },
  };
  const c = map[priority] || map['3 - Moderate'];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }} />{priority}
  </span>;
}

function StateBadge({ state }) {
  const map = {
    'New': { bg: '#e3f2fd', fg: '#1565c0' },
    'In Progress': { bg: '#fff3e0', fg: '#e65100' },
    'On Hold': { bg: '#f3e5f5', fg: '#7b1fa2' },
    'Resolved': { bg: '#e8f5e9', fg: '#2e7d32' },
    'Closed': { bg: '#eceff1', fg: '#546e6f' },
  };
  const c = map[state] || { bg: '#f5f5f5', fg: '#666' };
  return <span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg }}>{state}</span>;
}

function InsightBadge({ status }) {
  if (!status) return null;
  const map = {
    sent: { bg: snow.blueBg, fg: snow.blue, label: 'Analyzing...' },
    analyzed: { bg: '#e8f0fe', fg: '#1a73e8', label: 'Analyzed' },
    pending_approval: { bg: snow.amberBg, fg: '#b45309', label: 'Awaiting Approval' },
    executing: { bg: snow.blueBg, fg: snow.blue, label: 'Executing...' },
    rejected: { bg: '#f5f5f5', fg: '#666', label: 'Rejected' },
    error: { bg: snow.redBg, fg: snow.red, label: 'Error' },
  };
  const c = map[status] || { bg: '#f5f5f5', fg: '#666', label: status };
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg,
    animation: (status === 'sent' || status === 'executing') ? 'insightPulse 2s infinite' : 'none' }}>
    {(status === 'sent' || status === 'executing') && <span style={{ width: 10, height: 10, border: `2px solid ${c.fg}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
    {c.label}
  </span>;
}

// ═══════════════════════════════════════════════════════════
// INCIDENT LIST
// ═══════════════════════════════════════════════════════════
function IncidentList({ onSelect, onCreate, refresh }) {
  const [incidents, setIncidents] = useState([]);
  const [filter, setFilter] = useState('');
  const [stats, setStats] = useState(null);
  const load = useCallback(async () => {
    try {
      const [inc, st] = await Promise.all([api.incidents(), api.stats()]);
      setIncidents(inc);
      setStats(st);
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { load() }, [load, refresh]);

  const filtered = incidents.filter(i =>
    !filter || i.number.toLowerCase().includes(filter.toLowerCase()) ||
    i.short_description.toLowerCase().includes(filter.toLowerCase()) ||
    i.assignment_group.toLowerCase().includes(filter.toLowerCase())
  );

  return <div>
    {/* Stats bar */}
    {stats && <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      {[['Total', stats.total, snow.blue], ['New', stats.by_state?.New || 0, '#1565c0'], ['In Progress', stats.by_state?.['In Progress'] || 0, '#e65100'],
        ['Resolved', stats.by_state?.Resolved || 0, '#2e7d32'], ['Closed', stats.by_state?.Closed || 0, '#546e6f']].map(([label, count, color]) =>
        <div key={label} style={{ flex: 1, background: snow.surface, border: `1px solid ${snow.border}`, borderRadius: 4, padding: '12px 16px', borderTop: `3px solid ${color}` }}>
          <div style={{ fontSize: 22, fontWeight: 700, color }}>{count}</div>
          <div style={{ fontSize: 12, color: snow.textMuted, marginTop: 2 }}>{label}</div>
        </div>)}
    </div>}

    {/* Toolbar */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: snow.text }}>Incidents</h2>
        <span style={{ fontSize: 12, color: snow.textDim }}>({filtered.length})</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search incidents..." style={{ width: 240 }} />
        <button onClick={onCreate} style={{ background: snow.blue, color: '#fff', border: 'none', fontWeight: 600 }}>New</button>
      </div>
    </div>

    {/* Table */}
    <div style={{ background: snow.surface, border: `1px solid ${snow.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ background: snow.surfaceAlt, borderBottom: `2px solid ${snow.border}` }}>
          {['Number', 'Priority', 'Short Description', 'Category', 'State', 'Assignment Group', 'Insight', 'Updated'].map(h =>
            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: snow.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map(inc => <tr key={inc.number} onClick={() => onSelect(inc.number)}
            style={{ borderBottom: `1px solid ${snow.borderLight}`, cursor: 'pointer', transition: 'background 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8f9fa'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <td style={{ padding: '8px 12px' }}><span style={{ color: snow.textLink, fontWeight: 500, textDecoration: 'underline' }}>{inc.number}</span></td>
            <td style={{ padding: '8px 12px' }}><PriorityBadge priority={inc.priority} /></td>
            <td style={{ padding: '8px 12px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.short_description}</td>
            <td style={{ padding: '8px 12px', fontSize: 13, color: snow.textMuted }}>{inc.category}</td>
            <td style={{ padding: '8px 12px' }}><StateBadge state={inc.state} /></td>
            <td style={{ padding: '8px 12px', fontSize: 13 }}>{inc.assignment_group}</td>
            <td style={{ padding: '8px 12px' }}><InsightBadge status={inc.insight_status} /></td>
            <td style={{ padding: '8px 12px', fontSize: 12, color: snow.textDim, whiteSpace: 'nowrap' }}>{inc.updated_at?.split('T')[0]}</td>
          </tr>)}
          {filtered.length === 0 && <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: snow.textDim }}>No incidents found</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════
// INCIDENT FORM (ServiceNow-accurate layout)
// ═══════════════════════════════════════════════════════════
function IncidentForm({ number, onBack, onRefresh }) {
  const [inc, setInc] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    try { setInc(await api.incident(number)) } catch (e) { console.error(e) }
  }, [number]);
  useEffect(() => { load() }, [load]);

  const save = async () => {
    setSaving(true);
    try { setInc(await api.update(number, inc)); onRefresh?.() } catch (e) { alert(e.message) }
    setSaving(false);
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    try { await api.addNote(number, noteText, 'admin'); setNoteText(''); load() } catch (e) { alert(e.message) }
  };

  const reanalyze = async () => {
    setAnalyzing(true);
    try { setInc(await api.analyze(number)); } catch (e) { alert(e.message) }
    setAnalyzing(false);
  };

  const approveSkill = async () => {
    setApproving(true);
    try { setInc(await api.approve(number, 'admin')); load(); } catch (e) { alert(e.message) }
    setApproving(false);
  };

  const rejectSkill = async () => {
    const reason = window.prompt('Rejection reason:', 'Not approved at this time');
    if (reason === null) return;
    try { setInc(await api.reject(number, reason)); load(); } catch (e) { alert(e.message) }
  };

  if (!inc) return <div style={{ padding: 40, textAlign: 'center', color: snow.textDim }}>Loading...</div>;

  return <div style={{ animation: 'fadeIn 0.2s ease' }}>
    {/* Form header bar */}
    <div style={{ background: snow.surface, border: `1px solid ${snow.border}`, borderRadius: '4px 4px 0 0', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${snow.blue}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: snow.textLink, padding: 0, fontSize: 13 }}>← Back to list</button>
        <span style={{ color: snow.border }}>|</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{inc.number}</span>
        <StateBadge state={inc.state} />
        <PriorityBadge priority={inc.priority} />
        <InsightBadge status={inc.insight_status} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={reanalyze} disabled={analyzing} style={{ background: snow.insightAccent, color: '#fff', border: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          {analyzing && <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18"/></svg>
          {analyzing ? 'Analyzing...' : 'Send to F5 Insight'}
        </button>
        <button onClick={save} disabled={saving} style={{ background: snow.green, color: '#fff', border: 'none', fontWeight: 600 }}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
      {/* Left column - incident details */}
      <div style={{ background: snow.surface, border: `1px solid ${snow.border}`, borderTop: 'none', padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SNField label="Number"><input value={inc.number} disabled style={{ background: snow.surfaceAlt }} /></SNField>
          <SNField label="Caller"><input value={inc.caller || ''} onChange={e => setInc({ ...inc, caller: e.target.value })} /></SNField>
          <SNField label="Category"><select value={inc.category} onChange={e => setInc({ ...inc, category: e.target.value })}>
            {['Network', 'Hardware', 'Software', 'Database', 'Inquiry/Help'].map(c => <option key={c}>{c}</option>)}</select></SNField>
          <SNField label="Subcategory"><input value={inc.subcategory || ''} onChange={e => setInc({ ...inc, subcategory: e.target.value })} /></SNField>
          <SNField label="State"><select value={inc.state} onChange={e => setInc({ ...inc, state: e.target.value })}>
            {['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'].map(s => <option key={s}>{s}</option>)}</select></SNField>
          <SNField label="Contact Type"><select value={inc.contact_type || 'Self-service'} onChange={e => setInc({ ...inc, contact_type: e.target.value })}>
            {['Self-service', 'Phone', 'Email', 'Walk-in', 'Chat'].map(c => <option key={c}>{c}</option>)}</select></SNField>
          <SNField label="Impact"><select value={inc.impact} onChange={e => setInc({ ...inc, impact: e.target.value })}>
            {['1 - High', '2 - Medium', '3 - Low'].map(v => <option key={v}>{v}</option>)}</select></SNField>
          <SNField label="Urgency"><select value={inc.urgency} onChange={e => setInc({ ...inc, urgency: e.target.value })}>
            {['1 - High', '2 - Medium', '3 - Low'].map(v => <option key={v}>{v}</option>)}</select></SNField>
          <SNField label="Priority"><select value={inc.priority} onChange={e => setInc({ ...inc, priority: e.target.value })}>
            {['1 - Critical', '2 - High', '3 - Moderate', '4 - Low'].map(v => <option key={v}>{v}</option>)}</select></SNField>
          <SNField label="Configuration Item"><input value={inc.configuration_item || ''} onChange={e => setInc({ ...inc, configuration_item: e.target.value })} /></SNField>
          <SNField label="Assignment Group"><select value={inc.assignment_group} onChange={e => setInc({ ...inc, assignment_group: e.target.value })}>
            {['Network Operations', 'Server Team', 'Database Team', 'Application Support', 'Security Operations', 'Service Desk'].map(g => <option key={g}>{g}</option>)}</select></SNField>
          <SNField label="Assigned To"><input value={inc.assigned_to || ''} onChange={e => setInc({ ...inc, assigned_to: e.target.value })} /></SNField>
        </div>
        <div style={{ marginTop: 16 }}>
          <SNField label="Short Description" required span={2}>
            <input value={inc.short_description} onChange={e => setInc({ ...inc, short_description: e.target.value })} style={{ fontSize: 14 }} /></SNField>
        </div>
        <div style={{ marginTop: 12 }}>
          <SNField label="Description" span={2}>
            <textarea value={inc.description || ''} onChange={e => setInc({ ...inc, description: e.target.value })} rows={4} style={{ resize: 'vertical' }} /></SNField>
        </div>
        {inc.state === 'Resolved' && <div style={{ marginTop: 12 }}>
          <SNField label="Close Notes"><textarea value={inc.close_notes || ''} onChange={e => setInc({ ...inc, close_notes: e.target.value })} rows={3} /></SNField>
        </div>}
        <div style={{ marginTop: 12, padding: '8px 0', borderTop: `1px solid ${snow.borderLight}`, fontSize: 12, color: snow.textDim, display: 'flex', gap: 20 }}>
          <span>Opened: {inc.opened_at?.split('T')[0]}</span>
          <span>Updated: {inc.updated_at?.split('T')[0]}</span>
          {inc.resolved_at && <span>Resolved: {inc.resolved_at?.split('T')[0]}</span>}
        </div>
      </div>

      {/* Right column - work notes + Insight results */}
      <div style={{ background: snow.surface, border: `1px solid ${snow.border}`, borderTop: 'none', borderLeft: 'none', padding: 20 }}>
        {/* Pending Approval Panel */}
        {inc.pending_skill && inc.insight_status === 'pending_approval' && (() => {
          let sk = {};
          try { sk = JSON.parse(inc.pending_skill); } catch(e) {}
          return <div style={{ marginBottom: 20, padding: 16, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 4, borderLeft: '4px solid #e8a018' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e8a018" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#b45309' }}>Approval Required — Destructive Action</span>
            </div>
            <div style={{ background: '#fff', border: '1px solid #ffe082', borderRadius: 4, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px 12px', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: snow.textMuted }}>Skill:</span>
                <span style={{ fontWeight: 600 }}>{sk.skill_name || '—'}</span>
                <span style={{ fontWeight: 600, color: snow.textMuted }}>Device:</span>
                <span style={{ fontFamily: "'Menlo', monospace", fontSize: 12 }}>{sk.device_hostname || '—'}</span>
                <span style={{ fontWeight: 600, color: snow.textMuted }}>Action:</span>
                <span>{sk.explanation || '—'}</span>
                {sk.parameters && Object.keys(sk.parameters).length > 0 && <>
                  <span style={{ fontWeight: 600, color: snow.textMuted }}>Parameters:</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Object.entries(sk.parameters).map(([k,v]) =>
                      <span key={k} style={{ padding: '2px 8px', background: '#fef3c7', borderRadius: 3, fontSize: 12, fontFamily: "'Menlo', monospace" }}>
                        {k}={String(v)}
                      </span>)}
                  </div>
                </>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={approveSkill} disabled={approving}
                style={{ background: snow.green, color: '#fff', border: 'none', fontWeight: 700, padding: '8px 24px', fontSize: 14,
                  display: 'flex', alignItems: 'center', gap: 6, opacity: approving ? 0.6 : 1 }}>
                {approving && <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
                {approving ? 'Executing...' : '✓ Approve & Execute'}
              </button>
              <button onClick={rejectSkill}
                style={{ background: '#fff', color: snow.red, border: `1px solid ${snow.red}`, fontWeight: 600, padding: '8px 20px', fontSize: 14 }}>
                ✗ Reject
              </button>
            </div>
          </div>;
        })()}

        {/* Executing indicator */}
        {inc.insight_status === 'executing' && <div style={{ marginBottom: 20, padding: 16, background: snow.blueBg, border: `1px solid #90caf9`, borderRadius: 4, borderLeft: `4px solid ${snow.blue}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 20, height: 20, border: `3px solid ${snow.blue}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontWeight: 600, color: snow.blue, fontSize: 14 }}>F5 Insight is executing the approved skill...</span>
        </div>}

        {/* F5 Insight Results Panel */}
        {inc.insight_response && <div style={{ marginBottom: 20, padding: 16, background: snow.insightBg, border: `1px solid #c4d4f0`, borderRadius: 4, borderLeft: `4px solid ${snow.insightAccent}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={snow.insightAccent} strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
            <span style={{ fontWeight: 700, fontSize: 14, color: snow.insightAccent }}>F5 Insight Analysis</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#333' }}>{inc.insight_response}</div>
        </div>}

        {/* Work Notes */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: snow.textMuted, display: 'block', marginBottom: 4 }}>Work Notes</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} placeholder="Add a work note..." style={{ flex: 1, resize: 'vertical' }} />
            <button onClick={addNote} style={{ alignSelf: 'flex-end', background: snow.blue, color: '#fff', border: 'none', fontWeight: 600 }}>Post</button>
          </div>
        </div>

        {/* Activity stream */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: snow.textMuted, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${snow.borderLight}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Activities ({(inc.work_notes_list || []).length})
          </div>
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {(inc.work_notes_list || []).slice().reverse().map((note, i) => (
              <div key={note.id || i} style={{ padding: '10px 0', borderBottom: `1px solid ${snow.borderLight}`, animation: 'fadeIn 0.3s ease' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: note.author === 'F5 Insight' ? snow.insightAccent : snow.textMuted }}>
                    {note.author === 'F5 Insight' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginRight: 4, verticalAlign: 'middle' }}><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18"/></svg>}
                    {note.author}
                  </span>
                  <span style={{ fontSize: 11, color: snow.textDim }}>{note.created_at?.replace('T', ' ').split('.')[0]}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: note.author === 'F5 Insight' ? '#1a3a5c' : snow.text,
                  background: note.author === 'F5 Insight' ? snow.insightBg : 'transparent',
                  padding: note.author === 'F5 Insight' ? '8px 10px' : 0,
                  borderRadius: note.author === 'F5 Insight' ? 4 : 0,
                  borderLeft: note.author === 'F5 Insight' ? `3px solid ${snow.insightAccent}` : 'none' }}>
                  {note.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════
// NEW INCIDENT (LLM-powered natural language)
// ═══════════════════════════════════════════════════════════
function NewIncident({ onCreated, onBack }) {
  const [mode, setMode] = useState('nlp');  // nlp or manual
  const [nlpText, setNlpText] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    short_description: '', description: '', category: 'Network', subcategory: '',
    impact: '2 - Medium', urgency: '2 - Medium', priority: '3 - Moderate',
    assignment_group: 'Network Operations', configuration_item: '', caller: 'admin',
  });

  const createNLP = async () => {
    if (!nlpText.trim()) return;
    setCreating(true);
    try {
      const inc = await api.create({ natural_language: nlpText, caller: 'admin' });
      onCreated(inc.number);
    } catch (e) { alert(e.message) }
    setCreating(false);
  };

  const createManual = async () => {
    if (!form.short_description) return alert('Short description required');
    setCreating(true);
    try {
      const inc = await api.create(form);
      onCreated(inc.number);
    } catch (e) { alert(e.message) }
    setCreating(false);
  };

  return <div style={{ animation: 'fadeIn 0.2s ease' }}>
    <div style={{ background: snow.surface, border: `1px solid ${snow.border}`, borderRadius: '4px 4px 0 0', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${snow.green}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: snow.textLink, padding: 0, fontSize: 13 }}>← Back</button>
        <span style={{ color: snow.border }}>|</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>New Incident</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => setMode('nlp')} style={{ background: mode === 'nlp' ? snow.blue : '#fff', color: mode === 'nlp' ? '#fff' : snow.text, fontWeight: 600, fontSize: 12, borderColor: snow.blue }}>
          ✦ AI Create</button>
        <button onClick={() => setMode('manual')} style={{ background: mode === 'manual' ? snow.blue : '#fff', color: mode === 'manual' ? '#fff' : snow.text, fontWeight: 600, fontSize: 12, borderColor: snow.blue }}>
          Manual</button>
      </div>
    </div>

    <div style={{ background: snow.surface, border: `1px solid ${snow.border}`, borderTop: 'none', padding: 24 }}>
      {mode === 'nlp' ? <div>
        <div style={{ padding: 16, background: '#f0f4ff', border: '1px solid #c4d4f0', borderRadius: 4, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: snow.blue, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 3z"/></svg>
            Describe the issue in plain English</div>
          <p style={{ fontSize: 13, color: snow.textMuted, lineHeight: 1.5 }}>
            AI will auto-fill all ticket fields including category, priority, assignment group, and configuration item. The ticket will automatically be sent to F5 Insight for analysis.</p>
        </div>
        <textarea value={nlpText} onChange={e => setNlpText(e.target.value)} rows={6}
          placeholder="Example: The virtual server 'app-vs-443' on bigip01.lab.local is showing high connection counts and several pool members appear to be down. Users are reporting intermittent 502 errors when accessing the application. This started about 30 minutes ago."
          style={{ fontSize: 14, lineHeight: 1.6, resize: 'vertical' }} />
        <button onClick={createNLP} disabled={creating || !nlpText.trim()}
          style={{ marginTop: 16, background: snow.green, color: '#fff', border: 'none', fontWeight: 600, padding: '10px 28px', fontSize: 14,
            opacity: creating || !nlpText.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          {creating && <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
          {creating ? 'Creating & Analyzing...' : 'Create Incident'}
        </button>
      </div>

      : <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SNField label="Caller"><input value={form.caller} onChange={e => setForm({ ...form, caller: e.target.value })} /></SNField>
          <SNField label="Category"><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {['Network', 'Hardware', 'Software', 'Database', 'Inquiry/Help'].map(c => <option key={c}>{c}</option>)}</select></SNField>
          <SNField label="Impact"><select value={form.impact} onChange={e => setForm({ ...form, impact: e.target.value })}>
            {['1 - High', '2 - Medium', '3 - Low'].map(v => <option key={v}>{v}</option>)}</select></SNField>
          <SNField label="Urgency"><select value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}>
            {['1 - High', '2 - Medium', '3 - Low'].map(v => <option key={v}>{v}</option>)}</select></SNField>
          <SNField label="Assignment Group"><select value={form.assignment_group} onChange={e => setForm({ ...form, assignment_group: e.target.value })}>
            {['Network Operations', 'Server Team', 'Database Team', 'Application Support', 'Security Operations', 'Service Desk'].map(g => <option key={g}>{g}</option>)}</select></SNField>
          <SNField label="Configuration Item"><input value={form.configuration_item} onChange={e => setForm({ ...form, configuration_item: e.target.value })} placeholder="e.g. bigip01.lab.local" /></SNField>
        </div>
        <div style={{ marginTop: 12 }}><SNField label="Short Description" required>
          <input value={form.short_description} onChange={e => setForm({ ...form, short_description: e.target.value })} style={{ fontSize: 14 }} /></SNField></div>
        <div style={{ marginTop: 12 }}><SNField label="Description">
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} /></SNField></div>
        <button onClick={createManual} disabled={creating}
          style={{ marginTop: 16, background: snow.green, color: '#fff', border: 'none', fontWeight: 600, padding: '10px 28px', fontSize: 14, opacity: creating ? 0.5 : 1 }}>
          {creating ? 'Creating...' : 'Submit'}
        </button>
      </div>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════
// APP SHELL (ServiceNow Polaris chrome)
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [view, setView] = useState('list');  // list, form, new
  const [selectedInc, setSelectedInc] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [health, setHealth] = useState(null);

  useEffect(() => { api.health().then(setHealth).catch(() => {}) }, []);

  const refresh = () => setRefreshKey(k => k + 1);

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <style>{globalCSS}</style>

    {/* ServiceNow Polaris Top Nav */}
    <div style={{ height: 48, background: snow.navBgDark, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* ServiceNow logo area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 4, background: snow.navAccent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="4"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" opacity="0.4"/></svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: -0.3 }}>ServiceNow</span>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 20 }}>|</span>
        <span style={{ color: snow.navText, fontSize: 13 }}>Incident Management</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {health?.insight_configured && <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(59,130,246,0.15)', borderRadius: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={snow.insightAccent} strokeWidth="2.5"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18"/></svg>
          <span style={{ fontSize: 11, color: snow.insightAccent, fontWeight: 600 }}>F5 Insight Connected</span>
        </div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#3a5a6e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff', fontWeight: 600 }}>A</div>
          <span style={{ fontSize: 13, color: snow.navText }}>admin</span>
        </div>
      </div>
    </div>

    {/* Secondary nav */}
    <div style={{ height: 36, background: snow.navBg, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 4, flexShrink: 0 }}>
      {[['list', 'All Incidents'], ['new', '+ New Incident']].map(([id, label]) =>
        <button key={id} onClick={() => { setView(id); setSelectedInc(null); }}
          style={{ background: view === id ? 'rgba(255,255,255,0.1)' : 'transparent', color: view === id ? '#fff' : snow.navText,
            border: 'none', padding: '6px 14px', borderRadius: 3, fontSize: 13, fontWeight: view === id ? 600 : 400,
            borderBottom: view === id ? `2px solid ${snow.navAccent}` : '2px solid transparent' }}>
          {label}
        </button>)}
    </div>

    {/* Content */}
    <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
      {view === 'list' && !selectedInc && <IncidentList
        onSelect={n => { setSelectedInc(n); setView('form'); }}
        onCreate={() => setView('new')}
        refresh={refreshKey} />}
      {view === 'form' && selectedInc && <IncidentForm
        number={selectedInc}
        onBack={() => { setSelectedInc(null); setView('list'); refresh(); }}
        onRefresh={refresh} />}
      {view === 'new' && <NewIncident
        onCreated={n => { setSelectedInc(n); setView('form'); refresh(); }}
        onBack={() => setView('list')} />}
    </div>

    {/* Footer */}
    <div style={{ height: 28, background: snow.surfaceAlt, borderTop: `1px solid ${snow.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0 }}>
      <span style={{ fontSize: 11, color: snow.textDim }}>ServiceNow Mock — ITSM Demo Instance</span>
      <span style={{ fontSize: 11, color: snow.textDim }}>
        {health?.llm_configured ? '✓ LLM' : '○ LLM'} · {health?.insight_configured ? '✓ F5 Insight' : '○ F5 Insight'}
      </span>
    </div>
  </div>;
}
