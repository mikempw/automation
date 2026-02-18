import React, { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'react';
import { api } from './api';
import { colors, fonts } from './styles';

// ── Constants ────────────────────────────────────────────
const NODE_W = 200, NODE_H = 72, H_GAP = 90, V_GAP = 110, START_X = 80, START_Y = 220, CANVAS_PAD = 60;
const NODE_TYPES = {
  start: { label: 'Start', color: '#16a34a', icon: '▶' },
  skill: { label: 'Skill', color: colors.accent, icon: '🔧' },
  branch: { label: 'Branch', color: colors.amber, icon: '◇' },
  end: { label: 'End', color: '#dc2626', icon: '■' },
  macro: { label: 'Macro', color: '#7c3aed', icon: '📦' },
};
const END_ACTIONS = ['Allow', 'Deny', 'Alert', 'Webhook', 'Rollback'];
const BRANCH_OPS = [
  { v: 'contains', l: 'contains' }, { v: 'not_contains', l: 'does not contain' },
  { v: 'equals', l: 'equals' }, { v: 'not_equals', l: 'does not equal' },
  { v: 'gt', l: '>' }, { v: 'lt', l: '<' }, { v: 'gte', l: '>=' }, { v: 'lte', l: '<=' },
  { v: 'regex', l: 'matches regex' }, { v: 'exists', l: 'exists (non-empty)' },
  { v: 'status_success', l: 'prev step succeeded' }, { v: 'status_failed', l: 'prev step failed' },
];

// ── Utility ──────────────────────────────────────────────
let _idC = 0;
const uid = () => `node-${Date.now()}-${++_idC}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const edgePath = (x1, y1, x2, y2) => { const dx = Math.abs(x2-x1)*0.45; return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`; };

// ── Undo/Redo ────────────────────────────────────────────
const MAX_HIST = 50;
function historyReducer(state, action) {
  switch (action.type) {
    case 'push': { const past = [...state.past, state.present].slice(-MAX_HIST); return { past, present: action.snapshot, future: [] }; }
    case 'undo': { if (!state.past.length) return state; const p = state.past[state.past.length-1]; return { past: state.past.slice(0,-1), present: p, future: [state.present, ...state.future].slice(0, MAX_HIST) }; }
    case 'redo': { if (!state.future.length) return state; const n = state.future[0]; return { past: [...state.past, state.present], present: n, future: state.future.slice(1) }; }
    case 'init': return { past: [], present: action.snapshot, future: [] };
    default: return state;
  }
}

// ── Shared UI ────────────────────────────────────────────
const btnP = { background: colors.accent, color: '#fff', fontWeight: 600, boxShadow: '0 1px 3px rgba(37,99,235,0.3)' };
const btnS = { background: '#fff', color: colors.textMuted, border: `1px solid ${colors.border}` };
const btnDanger = { background: colors.red, color: '#fff', fontWeight: 600 };
function FL({ label, required }) {
  return <label style={{ display:'flex', alignItems:'center', gap:4, marginBottom:5, fontSize:12, fontWeight:600, color: colors.textMuted }}>
    {label}{required && <span style={{color:colors.red}}>*</span>}</label>;
}
function Badge({ status, children }) {
  const map = { complete:{bg:colors.greenLight,fg:colors.green}, running:{bg:colors.accentLight,fg:colors.accent}, failed:{bg:colors.redLight,fg:colors.red}, pending:{bg:colors.amberLight,fg:colors.amber}, manual:{bg:colors.accentLight,fg:colors.accent}, alert:{bg:colors.amberLight,fg:colors.amber}, webhook:{bg:'#e0e7ff',fg:'#4338ca'} };
  const c = map[status] || {bg:colors.amberLight,fg:colors.amber};
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:12,background:c.bg,color:c.fg,fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:0.4}}>
    <span style={{width:5,height:5,borderRadius:'50%',background:c.fg}}/>{children}</span>;
}
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type='info', dur=3500) => { const id=Date.now(); setToasts(p=>[...p,{id,msg,type}]); setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), dur); }, []);
  const cMap = {info:colors.accent, success:colors.green, error:colors.red, warning:colors.amber};
  const el = <div style={{position:'fixed',top:16,right:16,zIndex:10000,display:'flex',flexDirection:'column',gap:8}}>
    {toasts.map(t=><div key={t.id} style={{padding:'12px 20px',background:colors.surface,border:`1px solid ${colors.border}`,borderLeft:`4px solid ${cMap[t.type]||colors.accent}`,borderRadius:10,boxShadow:'0 8px 30px rgba(0,0,0,0.15)',fontSize:13,maxWidth:400}}>{t.msg}</div>)}</div>;
  return {addToast:add, toastEl:el};
}

// ══════════════════════════════════════════════════════════
// SERIALIZATION — Graph ↔ Automation API format
// ══════════════════════════════════════════════════════════
function serializeGraph(nodes, edges) {
  const startNode = nodes.find(n => n.type === 'start');
  if (!startNode) return { steps: [], graph_layout: {} };
  const steps = [], visited = new Set();
  let currentId = startNode.id;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const sEdge = edges.find(e => e.from === currentId && (e.port === 'success' || e.port === 'true'));
    if (!sEdge) break;
    const next = nodes.find(n => n.id === sEdge.to);
    if (!next || next.type === 'end') break;
    if (next.type === 'skill') {
      const fEdge = edges.find(e => e.from === next.id && e.port === 'failure');
      steps.push({ id: next.id, skill_name: next.data.skill_name||'', label: next.data.label||next.data.skill_name||'',
        gate: next.data.gate||'auto', on_failure: fEdge ? 'stop' : (next.data.on_failure||'skip'),
        device_source: next.data.device_source||'parameter', device_param: next.data.device_param||'device',
        device_hostname: next.data.device_hostname||'', parameters: next.data.parameters||{}, parameter_map: next.data.parameter_map||{} });
    } else if (next.type === 'branch') {
      steps.push({ id: next.id, type: 'branch', label: next.data.label||'Branch', conditions: next.data.conditions||[] });
    } else if (next.type === 'macro') {
      steps.push({ id: next.id, type: 'macro', label: next.data.label||'Macro', automation_id: next.data.automation_id||'', parameters: next.data.parameters||{} });
    }
    currentId = next.id;
  }
  const graph_layout = {
    nodes: nodes.map(n => ({ id:n.id, type:n.type, x:n.x, y:n.y, data:n.data })),
    edges: edges.map(e => ({ id:e.id, from:e.from, to:e.to, port:e.port })),
  };
  return { steps, graph_layout };
}

function deserializeToGraph(automation) {
  if (automation.graph_layout?.nodes?.length > 0) return { nodes: automation.graph_layout.nodes, edges: automation.graph_layout.edges };
  const steps = automation.steps||[], nn=[], ne=[];
  const sId = uid();
  nn.push({ id:sId, type:'start', x:START_X, y:START_Y, data:{label:'Start'} });
  let prevId = sId;
  steps.forEach((step, i) => {
    const nid = step.id||uid(), x = START_X+(i+1)*(NODE_W+H_GAP), nt = step.type||'skill';
    nn.push({ id:nid, type:nt, x, y:START_Y, data:{ label:step.label||step.skill_name||'', skill_name:step.skill_name||'',
      gate:step.gate||'auto', on_failure:step.on_failure||'stop', device_source:step.device_source||'parameter',
      device_param:step.device_param||'device', device_hostname:step.device_hostname||'',
      parameters:step.parameters||{}, parameter_map:step.parameter_map||{}, conditions:step.conditions||[], automation_id:step.automation_id||'' } });
    ne.push({ id:uid(), from:prevId, to:nid, port:'success' });
    if (step.on_failure==='stop' && nt==='skill') { const fId=uid(); nn.push({id:fId,type:'end',x,y:START_Y+V_GAP,data:{label:'Deny',action:'Deny'}}); ne.push({id:uid(),from:nid,to:fId,port:'failure'}); }
    prevId = nid;
  });
  const eId = uid();
  nn.push({id:eId,type:'end',x:START_X+(steps.length+1)*(NODE_W+H_GAP),y:START_Y,data:{label:'Allow',action:'Allow'}});
  ne.push({id:uid(),from:prevId,to:eId,port:'success'});
  return { nodes:nn, edges:ne };
}

function validateGraph(name, nodes, edges) {
  const errs = [];
  if (!name.trim()) errs.push('Workflow name is required');
  const sk = nodes.filter(n=>n.type==='skill');
  if (!sk.length) errs.push('Add at least one skill node');
  sk.forEach(n => { if (!n.data?.skill_name) errs.push(`Skill "${n.data?.label||n.id}" has no skill selected`); });
  const st = nodes.find(n=>n.type==='start');
  if (!st) errs.push('Missing start node');
  else if (!edges.some(e=>e.from===st.id)) errs.push('Start node has no connections');
  nodes.forEach(n => { if (n.type==='start') return; if (!edges.some(e=>e.to===n.id) && !edges.some(e=>e.from===n.id)) errs.push(`Node "${n.data?.label||n.id}" is disconnected`); });
  nodes.filter(n=>n.type==='end'&&n.data?.action==='Webhook').forEach(n=>{ if(!n.data?.webhook_url) errs.push(`Webhook "${n.data?.label||n.id}" needs a URL`); });
  nodes.filter(n=>n.type==='branch').forEach(n=>{ if(!n.data?.conditions?.length) errs.push(`Branch "${n.data?.label||n.id}" has no conditions`); });
  return errs;
}

// ══════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════
export default function VisualWorkflowEditor() {
  const [view, setView] = useState('list');
  const [workflows, setWorkflows] = useState([]);
  const [editing, setEditing] = useState(null);
  const { addToast, toastEl } = useToast();
  const load = useCallback(() => { api.listAutomations().then(setWorkflows).catch(console.error); }, []);
  useEffect(() => { load(); }, [load]);
  const handleSaved = useCallback((saved) => { setView('list'); setEditing(null); load(); addToast(`Workflow "${saved.name}" saved`, 'success'); }, [load, addToast]);
  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this workflow?')) return;
    try { await api.deleteAutomation(id); load(); addToast('Deleted', 'info'); } catch(e) { addToast(`Delete failed: ${e.message}`, 'error'); }
  }, [load, addToast]);

  if (view === 'canvas') return <>{toastEl}<WorkflowCanvas workflow={editing} onSave={handleSaved} onCancel={() => { setView('list'); setEditing(null); }} /></>;

  return <div>{toastEl}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
      <div><h2 style={{fontSize:22,fontWeight:700,color:colors.text}}>Visual Workflow Editor</h2>
        <p style={{fontSize:14,color:colors.textMuted,marginTop:4}}>VPE-style drag & drop policy builder for skill chains</p></div>
      <button onClick={()=>{setEditing(null);setView('canvas');}} style={{...btnP,padding:'10px 20px',borderRadius:8,fontSize:13}}>+ New Workflow</button>
    </div>
    {workflows.length===0 ? <div style={{background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:12,padding:40,textAlign:'center',color:colors.textDim}}>
      <div style={{fontSize:48,marginBottom:12}}>🔀</div><div style={{fontSize:16,fontWeight:600,marginBottom:8}}>No workflows yet</div>
      <button onClick={()=>{setEditing(null);setView('canvas');}} style={{...btnP,padding:'10px 20px',borderRadius:8}}>Create Visual Workflow</button></div>
    : <div style={{display:'grid',gap:12}}>
      {workflows.map(w => <div key={w.id} style={{background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:12,padding:20,cursor:'pointer',transition:'all 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=colors.accent;e.currentTarget.style.boxShadow='0 4px 12px rgba(37,99,235,0.1)';}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=colors.border;e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.04)';}}
        onClick={()=>{setEditing(w);setView('canvas');}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:16,fontWeight:600,display:'flex',alignItems:'center',gap:8}}>{w.name} <Badge status={w.trigger}>{w.trigger}</Badge></div>
            <div style={{fontSize:13,color:colors.textDim,marginTop:4}}>{w.description||'No description'}</div>
            <div style={{display:'flex',gap:6,marginTop:8}}>
              <span style={{fontSize:11,color:colors.textMuted}}>{w.step_count} steps</span>
              {w.tags?.map(t=><span key={t} style={{padding:'1px 8px',background:colors.surfaceAlt,border:`1px solid ${colors.border}`,borderRadius:6,fontSize:10,color:colors.textDim}}>{t}</span>)}
            </div></div>
          <div style={{display:'flex',gap:6}} onClick={e=>e.stopPropagation()}>
            <button onClick={()=>{setEditing(w);setView('canvas');}} style={{...btnP,padding:'6px 14px',borderRadius:8,fontSize:12}}>Edit</button>
            <button onClick={()=>handleDelete(w.id)} style={{...btnS,padding:'6px 14px',borderRadius:8,fontSize:12,color:colors.red}}>✕</button>
          </div></div></div>)}</div>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// WORKFLOW CANVAS
// ══════════════════════════════════════════════════════════
function WorkflowCanvas({ workflow, onSave, onCancel }) {
  const svgRef = useRef(null), containerRef = useRef(null);
  const { addToast, toastEl } = useToast();
  const [name, setName] = useState(workflow?.name || '');
  const [desc, setDesc] = useState(workflow?.description || '');
  const [trigger, setTrigger] = useState(workflow?.trigger || 'manual');
  const [tags, setTags] = useState(workflow?.tags?.join(', ') || '');
  const [chainParams, setChainParams] = useState(workflow?.parameters || [{ name:'device', label:'Target Device', type:'device', required:true }]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [history, dispatchHistory] = useReducer(historyReducer, { past:[], present:{nodes:[],edges:[]}, future:[] });
  const { nodes, edges } = history.present;
  const setNodes = useCallback(fn => { dispatchHistory({type:'push',snapshot:{nodes:typeof fn==='function'?fn(history.present.nodes):fn, edges:history.present.edges}}); setDirty(true); }, [history.present]);
  const setEdges = useCallback(fn => { dispatchHistory({type:'push',snapshot:{nodes:history.present.nodes, edges:typeof fn==='function'?fn(history.present.edges):fn}}); setDirty(true); }, [history.present]);
  const setNE = useCallback((nFn,eFn) => { dispatchHistory({type:'push',snapshot:{nodes:typeof nFn==='function'?nFn(history.present.nodes):nFn, edges:typeof eFn==='function'?eFn(history.present.edges):eFn}}); setDirty(true); }, [history.present]);
  const undo = useCallback(() => dispatchHistory({type:'undo'}), []);
  const redo = useCallback(() => dispatchHistory({type:'redo'}), []);

  const [pan, setPan] = useState({x:0,y:0});
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [mousePos, setMousePos] = useState({x:0,y:0});
  const [showPalette, setShowPalette] = useState(true);
  const [showProps, setShowProps] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({x:0,y:0});

  const [skills, setSkills] = useState([]);
  const [devices, setDevices] = useState([]);
  const [automations, setAutomations] = useState([]);
  useEffect(() => {
    api.listSkills().then(setSkills).catch(console.error);
    api.listDevices().then(setDevices).catch(console.error);
    api.listAutomations().then(setAutomations).catch(console.error);
  }, []);

  useEffect(() => {
    if (workflow?.id) {
      api.getAutomation(workflow.id).then(full => {
        setName(full.name); setDesc(full.description||''); setTrigger(full.trigger||'manual');
        setTags(full.tags?.join(', ')||''); setChainParams(full.parameters||[]);
        const g = deserializeToGraph(full);
        dispatchHistory({type:'init',snapshot:{nodes:g.nodes,edges:g.edges}});
      }).catch(console.error);
    } else {
      const sId=uid(), eId=uid();
      dispatchHistory({type:'init',snapshot:{
        nodes:[{id:sId,type:'start',x:START_X,y:START_Y,data:{label:'Start'}},{id:eId,type:'end',x:START_X+NODE_W+H_GAP*3,y:START_Y,data:{label:'Allow',action:'Allow'}}],
        edges:[{id:uid(),from:sId,to:eId,port:'success'}]}});
    }
  }, []);

  const handleSave = useCallback(async () => {
    const errs = validateGraph(name, nodes, edges);
    if (errs.length) { addToast(errs[0], 'error'); return; }
    setSaving(true);
    const {steps, graph_layout} = serializeGraph(nodes, edges);
    const data = { name, description:desc, trigger, tags:tags.split(',').map(t=>t.trim()).filter(Boolean), steps, parameters:chainParams, graph_layout };
    try {
      const result = workflow?.id ? await api.updateAutomation(workflow.id, data) : await api.createAutomation(data);
      setDirty(false); onSave(result);
    } catch(e) { addToast(`Save failed: ${e.message}`, 'error'); }
    setSaving(false);
  }, [name,desc,trigger,tags,chainParams,nodes,edges,workflow,onSave,addToast]);

  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==='Z'||e.key==='y')) { e.preventDefault(); redo(); }
      if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); handleSave(); }
      if ((e.key==='Delete'||e.key==='Backspace') && selected && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); const nd=nodes.find(n=>n.id===selected);
        if (nd && nd.type!=='start') { setNE(p=>p.filter(n=>n.id!==selected), p=>p.filter(e2=>e2.from!==selected&&e2.to!==selected)); setSelected(null); }
      }
      if (e.key==='Escape') { setSelected(null); setConnecting(null); }
    };
    window.addEventListener('keydown', h); return ()=>window.removeEventListener('keydown', h);
  }, [selected, nodes, undo, redo, handleSave, setNE]);

  const toCanvas = useCallback((cx,cy) => { const r=svgRef.current?.getBoundingClientRect(); if(!r) return {x:0,y:0}; return {x:(cx-r.left-pan.x)/zoom, y:(cy-r.top-pan.y)/zoom}; }, [pan,zoom]);
  const handleWheel = useCallback((e) => { e.preventDefault(); setZoom(z=>clamp(z*(e.deltaY>0?0.92:1.08),0.2,3)); }, []);
  const handleMouseDown = useCallback((e) => { if(e.target===svgRef.current||e.target.classList?.contains?.('canvas-bg')) { setIsPanning(true); setPanStart({x:e.clientX-pan.x,y:e.clientY-pan.y}); setSelected(null); } }, [pan]);
  const handleMouseMove = useCallback((e) => {
    const r=svgRef.current?.getBoundingClientRect(); if(r) setMousePos({x:(e.clientX-r.left-pan.x)/zoom,y:(e.clientY-r.top-pan.y)/zoom});
    if(isPanning) { setPan({x:e.clientX-panStart.x,y:e.clientY-panStart.y}); return; }
    if(dragging) {
      const dx=(e.clientX-dragging.startClientX)/zoom;
      const dy=(e.clientY-dragging.startClientY)/zoom;
      dispatchHistory({type:'push',snapshot:{nodes:nodes.map(n=>n.id===dragging.id?{...n,x:dragging.startNodeX+dx,y:dragging.startNodeY+dy}:n),edges}});
    }
  }, [isPanning,panStart,dragging,pan,zoom,nodes,edges]);
  const handleMouseUp = useCallback(() => {
    if(isPanning) setIsPanning(false); if(dragging) setDragging(null);
    if(connecting) {
      const target = nodes.find(n=>n.id!==connecting.fromId && mousePos.x>=n.x && mousePos.x<=n.x+NODE_W && mousePos.y>=n.y && mousePos.y<=n.y+NODE_H);
      if(target && !edges.some(e=>e.from===connecting.fromId&&e.to===target.id&&e.port===connecting.fromPort))
        setEdges(p=>[...p,{id:uid(),from:connecting.fromId,to:target.id,port:connecting.fromPort}]);
      setConnecting(null);
    }
  }, [isPanning,dragging,connecting,nodes,mousePos,edges,setEdges]);

  const addNode = useCallback((type,extra={}) => {
    const id=uid(), cx=(-pan.x+(containerRef.current?.clientWidth||800)/2)/zoom, cy=(-pan.y+(containerRef.current?.clientHeight||600)/2)/zoom;
    const data = {label:type==='skill'?(extra.skill_name||'New Skill'):type==='branch'?'Branch':NODE_TYPES[type]?.label||type,
      gate:'auto',on_failure:'stop',device_source:'parameter',device_param:'device',parameters:{},conditions:[],...extra};
    setNodes(p=>[...p,{id,type,x:cx-NODE_W/2,y:cy-NODE_H/2,data}]); setSelected(id);
  }, [pan,zoom,setNodes]);

  const updateNodeData = useCallback((id,updates) => { setNodes(p=>p.map(n=>n.id===id?{...n,data:{...n.data,...updates}}:n)); }, [setNodes]);

  const insertOnEdge = useCallback((edgeId,type,extra={}) => {
    const edge=edges.find(e=>e.id===edgeId); if(!edge) return;
    const fromN=nodes.find(n=>n.id===edge.from), toN=nodes.find(n=>n.id===edge.to); if(!fromN||!toN) return;
    const nId=uid(), x=(fromN.x+toN.x)/2, y=(fromN.y+toN.y)/2;
    const data = {label:type==='skill'?(extra.skill_name||'New Skill'):type==='branch'?'Branch':NODE_TYPES[type]?.label,
      gate:'auto',on_failure:'stop',device_source:'parameter',device_param:'device',parameters:{},conditions:[],...extra};
    setNE(p=>[...p,{id:nId,type,x,y,data}].map(n=>(n.x>=x&&n.id!==nId)?{...n,x:n.x+NODE_W+H_GAP}:n),
      p=>[...p.filter(e=>e.id!==edgeId),{id:uid(),from:edge.from,to:nId,port:edge.port},{id:uid(),from:nId,to:edge.to,port:'success'}]);
    setSelected(nId);
  }, [nodes,edges,setNE]);

  const autoLayout = useCallback(() => {
    const st=nodes.find(n=>n.type==='start'); if(!st) return;
    const vis=new Set(), pos={}; let col=0;
    const walk=(nId,row)=>{ if(vis.has(nId)) return; vis.add(nId);
      pos[nId]={x:START_X+col*(NODE_W+H_GAP),y:START_Y+row*(NODE_H+V_GAP)};
      const se=edges.filter(e=>e.from===nId&&(e.port==='success'||e.port==='true'));
      const fe=edges.filter(e=>e.from===nId&&(e.port==='failure'||e.port==='false'));
      if(se.length){col++;walk(se[0].to,row);} fe.forEach((e,i)=>{const sc=col;walk(e.to,row+1+i);col=sc;});
    }; walk(st.id,0);
    setNodes(p=>p.map(n=>pos[n.id]?{...n,...pos[n.id]}:n));
  }, [nodes,edges,setNodes]);

  const bounds = useMemo(() => {
    if(!nodes.length) return {minX:0,minY:0,maxX:800,maxY:600};
    return {minX:Math.min(...nodes.map(n=>n.x))-CANVAS_PAD, minY:Math.min(...nodes.map(n=>n.y))-CANVAS_PAD,
      maxX:Math.max(...nodes.map(n=>n.x))+NODE_W+CANVAS_PAD, maxY:Math.max(...nodes.map(n=>n.y))+NODE_H+CANVAS_PAD};
  }, [nodes]);
  const selectedNode = nodes.find(n=>n.id===selected);

  return <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',marginTop:-28,marginLeft:-28,marginRight:-28}}>
    {toastEl}
    {/* Toolbar */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 16px',background:colors.surface,borderBottom:`1px solid ${colors.border}`,zIndex:10}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <button onClick={()=>{if(dirty&&!window.confirm('Unsaved changes. Leave?')) return; onCancel();}} style={{...btnS,padding:'6px 14px',borderRadius:8,fontSize:12}}>← Back</button>
        <input value={name} onChange={e=>{setName(e.target.value);setDirty(true);}} placeholder="Workflow name..." style={{border:'none',fontSize:16,fontWeight:700,background:'transparent',outline:'none',width:260}} />
        <select value={trigger} onChange={e=>{setTrigger(e.target.value);setDirty(true);}} style={{fontSize:12,padding:'4px 8px',borderRadius:6,width:'auto'}}>
          <option value="manual">Manual</option><option value="webhook">Webhook</option><option value="alert">Alert</option></select>
        {dirty && <span style={{fontSize:10,color:colors.amber,fontWeight:600}}>● unsaved</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <button onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)" style={{...btnS,padding:'4px 10px',fontSize:14,opacity:history.past.length?1:0.3}}>↶</button>
        <button onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)" style={{...btnS,padding:'4px 10px',fontSize:14,opacity:history.future.length?1:0.3}}>↷</button>
        <div style={{width:1,height:20,background:colors.border,margin:'0 4px'}} />
        <span style={{fontSize:12,color:colors.textDim}}>{Math.round(zoom*100)}%</span>
        <button onClick={()=>setZoom(z=>clamp(z*1.2,0.2,3))} style={{...btnS,padding:'4px 10px',fontSize:12}}>+</button>
        <button onClick={()=>setZoom(z=>clamp(z*0.8,0.2,3))} style={{...btnS,padding:'4px 10px',fontSize:12}}>−</button>
        <button onClick={()=>{setPan({x:0,y:0});setZoom(1);}} style={{...btnS,padding:'4px 10px',fontSize:12}}>Fit</button>
        <div style={{width:1,height:20,background:colors.border,margin:'0 4px'}} />
        <button onClick={autoLayout} style={{...btnS,padding:'4px 12px',fontSize:12}}>Auto Layout</button>
        <button onClick={()=>setShowPalette(!showPalette)} style={{...btnS,padding:'4px 12px',fontSize:12,background:showPalette?colors.accentLight:undefined}}>Palette</button>
        <button onClick={()=>setShowProps(!showProps)} style={{...btnS,padding:'4px 12px',fontSize:12,background:showProps?colors.accentLight:undefined}}>Properties</button>
        <div style={{width:1,height:20,background:colors.border,margin:'0 4px'}} />
        <button onClick={handleSave} disabled={saving} title="Save (Ctrl+S)" style={{...btnP,padding:'6px 18px',borderRadius:8,fontSize:13,background:colors.green,boxShadow:'0 1px 3px rgba(22,163,74,0.3)',opacity:saving?0.6:1}}>
          {saving?'⏳ Saving...':'💾 Save'}</button>
      </div>
    </div>
    <div style={{display:'flex',flex:1,overflow:'hidden',position:'relative'}}>
      {showPalette && <Palette skills={skills} automations={automations} onAddNode={addNode} onDragSkill={sn=>addNode('skill',{skill_name:sn,label:sn})} />}
      {/* SVG Canvas */}
      <div ref={containerRef} style={{flex:1,overflow:'hidden',position:'relative',background:'#f8fafc',cursor:isPanning?'grabbing':'grab',
        backgroundImage:'radial-gradient(circle, #d1d5db 1px, transparent 1px)',backgroundSize:`${20*zoom}px ${20*zoom}px`,backgroundPosition:`${pan.x}px ${pan.y}px`}}>
        <svg ref={svgRef} width="100%" height="100%" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel} style={{display:'block'}}>
          <defs>
            <marker id="arrowS" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={colors.green}/></marker>
            <marker id="arrowF" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={colors.red}/></marker>
            <marker id="arrowT" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={colors.accent}/></marker>
            <filter id="nodeShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08"/></filter>
            <filter id="nodeGlow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={colors.accent} floodOpacity="0.35"/></filter>
          </defs>
          <rect className="canvas-bg" width="100%" height="100%" fill="transparent" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {edges.map(edge => {
              const from=nodes.find(n=>n.id===edge.from), to=nodes.find(n=>n.id===edge.to); if(!from||!to) return null;
              const x1=from.x+NODE_W,y1=from.y+NODE_H/2,x2=to.x,y2=to.y+NODE_H/2;
              const isF=edge.port==='failure'||edge.port==='false', isT=edge.port==='true';
              const color=isF?colors.red:isT?colors.accent:colors.green;
              const label=isF?(edge.port==='false'?'FALSE':'FAIL'):isT?'TRUE':'OK';
              const marker=isF?'url(#arrowF)':isT?'url(#arrowT)':'url(#arrowS)';
              const mx=(x1+x2)/2, my=(y1+y2)/2;
              return <g key={edge.id}>
                <path d={edgePath(x1,y1,x2,y2)} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray={isF?'6,4':'none'} markerEnd={marker} style={{cursor:'pointer'}} onClick={()=>setEdges(p=>p.filter(e=>e.id!==edge.id))} />
                <text x={mx} y={my-10} textAnchor="middle" fontSize={9} fill={color} fontWeight={700}>{label}</text>
                <g style={{cursor:'pointer'}} onClick={e=>{e.stopPropagation();insertOnEdge(edge.id,'skill');}}>
                  <circle cx={mx} cy={my+6} r={11} fill={colors.surface} stroke={colors.border} strokeWidth={1.5} />
                  <text x={mx} y={my+10} textAnchor="middle" fontSize={15} fill={colors.accent} fontWeight={700}>+</text></g></g>;
            })}
            {connecting && (()=>{ const from=nodes.find(n=>n.id===connecting.fromId); if(!from) return null;
              return <path d={edgePath(from.x+NODE_W,from.y+NODE_H/2,mousePos.x,mousePos.y)} fill="none" stroke={colors.accent} strokeWidth={2} strokeDasharray="6,4" opacity={0.5} pointerEvents="none" />; })()}
            {nodes.map(node => <FlowNode key={node.id} node={node} isSelected={selected===node.id} skills={skills}
              onSelect={()=>setSelected(node.id)} onDragStart={(cx,cy)=>setDragging({id:node.id,startClientX:cx,startClientY:cy,startNodeX:node.x,startNodeY:node.y})}
              onDelete={()=>{setNE(p=>p.filter(n=>n.id!==node.id),p=>p.filter(e=>e.from!==node.id&&e.to!==node.id));setSelected(null);}}
              onStartConnect={port=>setConnecting({fromId:node.id,fromPort:port})} />)}
          </g>
        </svg>
        <Minimap nodes={nodes} edges={edges} bounds={bounds} pan={pan} zoom={zoom} containerRef={containerRef} />
        <div style={{position:'absolute',bottom:12,left:12,display:'flex',gap:8,fontSize:11,alignItems:'center'}}>
          {Object.entries(NODE_TYPES).filter(([k])=>nodes.some(n=>n.type===k)).map(([k,v])=>
            <div key={k} style={{background:'rgba(255,255,255,0.92)',border:`1px solid ${colors.border}`,borderRadius:6,padding:'3px 10px',display:'flex',alignItems:'center',gap:5}}>
              <span style={{width:8,height:8,borderRadius:2,background:v.color}}/><span style={{color:colors.textMuted}}>{v.icon} {nodes.filter(n=>n.type===k).length}</span></div>)}
          <div style={{background:'rgba(255,255,255,0.75)',borderRadius:6,padding:'3px 10px',color:colors.textDim,fontSize:10}}>⌘Z undo · ⌘⇧Z redo · ⌘S save · Del delete</div>
        </div>
      </div>
      {showProps && <PropertiesPanel node={selectedNode} skills={skills} devices={devices} allNodes={nodes}
        chainParams={chainParams} setChainParams={p=>{setChainParams(p);setDirty(true);}}
        onUpdate={u=>selected&&updateNodeData(selected,u)}
        onDelete={()=>{if(selected){setNE(p=>p.filter(n=>n.id!==selected),p=>p.filter(e=>e.from!==selected&&e.to!==selected));setSelected(null);}}}
        onAddFailureBranch={()=>{if(!selected)return;const nd=nodes.find(n=>n.id===selected);const eId=uid();
          setNE(p=>[...p,{id:eId,type:'end',x:nd.x,y:nd.y+V_GAP,data:{label:'Deny',action:'Deny'}}],p=>[...p,{id:uid(),from:selected,to:eId,port:'failure'}]);}}
        desc={desc} setDesc={v=>{setDesc(v);setDirty(true);}} tags={tags} setTags={v=>{setTags(v);setDirty(true);}} />}
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════════
// FLOW NODE (SVG)
// ══════════════════════════════════════════════════════════
function FlowNode({ node, isSelected, skills, onSelect, onDragStart, onDelete, onStartConnect }) {
  const tc = NODE_TYPES[node.type]||NODE_TYPES.skill;
  const isStart=node.type==='start', isEnd=node.type==='end', isBranch=node.type==='branch';
  const sm = node.data?.skill_name ? skills.find(s=>s.name===node.data.skill_name) : null;
  const isDestructive = sm?.tags?.includes('destructive');
  const handleMouseDown = (e) => {
    e.stopPropagation(); onSelect();
    onDragStart(e.clientX, e.clientY);
  };
  return <g style={{cursor:'move'}} onMouseDown={handleMouseDown} filter={isSelected?'url(#nodeGlow)':'url(#nodeShadow)'}>
    <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={10} ry={10} fill={isSelected?'#eef2ff':'#fff'} stroke={isSelected?colors.accent:tc.color} strokeWidth={isSelected?2.5:1.5} />
    <rect x={node.x} y={node.y} width={NODE_W} height={24} rx={10} ry={10} fill={tc.color} />
    <rect x={node.x} y={node.y+16} width={NODE_W} height={8} fill={tc.color} />
    <text x={node.x+10} y={node.y+16} fontSize={10} fill="rgba(255,255,255,0.9)" fontWeight={600} fontFamily={fonts.sans}>{tc.icon} {node.type.toUpperCase()}</text>
    {node.data?.gate==='approve' && <text x={node.x+NODE_W-10} y={node.y+16} fontSize={10} fill="#fff" textAnchor="end">🔒</text>}
    {isDestructive && <text x={node.x+NODE_W-(node.data?.gate==='approve'?24:10)} y={node.y+16} fontSize={10} fill="#fff" textAnchor="end">⚠️</text>}
    <text x={node.x+NODE_W/2} y={node.y+46} textAnchor="middle" fontSize={12} fill={colors.text} fontWeight={500} fontFamily={fonts.sans}>
      {(node.data?.label||'').length>22?node.data.label.substring(0,20)+'…':(node.data?.label||'')}</text>
    {node.type==='skill'&&node.data?.skill_name && <text x={node.x+NODE_W/2} y={node.y+60} textAnchor="middle" fontSize={9} fill={colors.textDim} fontFamily={fonts.mono}>
      {node.data.skill_name.length>26?node.data.skill_name.substring(0,24)+'…':node.data.skill_name}</text>}
    {isBranch && <text x={node.x+NODE_W/2} y={node.y+60} textAnchor="middle" fontSize={9} fill={colors.textDim}>
      {node.data?.conditions?.length||0} condition{(node.data?.conditions?.length||0)!==1?'s':''}</text>}
    {/* Ports */}
    {!isEnd && <>{isBranch ? <>
      <g style={{cursor:'crosshair'}} onMouseDown={e=>{e.stopPropagation();onStartConnect('true');}}><circle cx={node.x+NODE_W} cy={node.y+NODE_H/3} r={7} fill={colors.accent} stroke="#fff" strokeWidth={2} /><text x={node.x+NODE_W} y={node.y+NODE_H/3+3.5} textAnchor="middle" fontSize={7} fill="#fff" fontWeight={700}>T</text></g>
      <g style={{cursor:'crosshair'}} onMouseDown={e=>{e.stopPropagation();onStartConnect('false');}}><circle cx={node.x+NODE_W} cy={node.y+NODE_H*2/3} r={7} fill={colors.red} stroke="#fff" strokeWidth={2} /><text x={node.x+NODE_W} y={node.y+NODE_H*2/3+3.5} textAnchor="middle" fontSize={7} fill="#fff" fontWeight={700}>F</text></g>
    </> : <>
      <g style={{cursor:'crosshair'}} onMouseDown={e=>{e.stopPropagation();onStartConnect('success');}}><circle cx={node.x+NODE_W} cy={node.y+NODE_H/2} r={7} fill={colors.green} stroke="#fff" strokeWidth={2} /><text x={node.x+NODE_W} y={node.y+NODE_H/2+3.5} textAnchor="middle" fontSize={8} fill="#fff" fontWeight={700}>✓</text></g>
      {node.type==='skill' && <g style={{cursor:'crosshair'}} onMouseDown={e=>{e.stopPropagation();onStartConnect('failure');}}><circle cx={node.x+NODE_W} cy={node.y+NODE_H-10} r={6} fill={colors.red} stroke="#fff" strokeWidth={2} /><text x={node.x+NODE_W} y={node.y+NODE_H-6.5} textAnchor="middle" fontSize={7} fill="#fff" fontWeight={700}>✕</text></g>}
    </>}</>}
    {!isStart && <circle cx={node.x} cy={node.y+NODE_H/2} r={7} fill={colors.accent} stroke="#fff" strokeWidth={2} />}
    {!isStart && isSelected && <g style={{cursor:'pointer'}} onMouseDown={e=>{e.stopPropagation();onDelete();}}>
      <circle cx={node.x+NODE_W-2} cy={node.y+2} r={9} fill={colors.red} /><text x={node.x+NODE_W-2} y={node.y+6} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700}>✕</text></g>}
  </g>;
}

// ══════════════════════════════════════════════════════════
// PALETTE
// ══════════════════════════════════════════════════════════
function Palette({ skills, automations, onAddNode, onDragSkill }) {
  const [search, setSearch] = useState('');
  const [expCat, setExpCat] = useState('bigip');
  const grouped = useMemo(() => { const g={}; skills.forEach(s=>{const p=s.name.split('-')[0]; if(!g[p])g[p]=[];g[p].push(s);}); return g; }, [skills]);
  const filtered = useMemo(() => { if(!search) return grouped; const q=search.toLowerCase(),r={};
    Object.entries(grouped).forEach(([k,v])=>{const f=v.filter(s=>s.name.toLowerCase().includes(q)||s.description?.toLowerCase().includes(q));if(f.length)r[k]=f;}); return r; }, [grouped,search]);
  const tagColor = t=>({troubleshooting:colors.amber,config:colors.red,security:colors.cyan,discovery:colors.accent,ha:colors.green,destructive:colors.red,network:'#7c3aed',fleet:colors.green,cloud:colors.accent,backup:colors.green,pool:colors.amber,cert:colors.cyan}[t]||colors.textDim);

  return <div style={{width:260,background:colors.surface,borderRight:`1px solid ${colors.border}`,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <div style={{padding:'14px 14px 10px',borderBottom:`1px solid ${colors.border}`}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:8,color:colors.text}}>🧩 Node Palette</div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search skills..." style={{fontSize:12,padding:'7px 12px'}} /></div>
    <div style={{flex:1,overflow:'auto',padding:10}}>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:700,color:colors.textDim,textTransform:'uppercase',letterSpacing:0.6,marginBottom:6,padding:'0 4px'}}>Control Flow</div>
        {[{type:'branch',label:'Branch (If/Else)',extra:{label:'Branch',conditions:[]},icon:'◇'},
          {type:'end',label:'End (Allow)',extra:{label:'Allow',action:'Allow'},icon:'✅'},
          {type:'end',label:'End (Deny)',extra:{label:'Deny',action:'Deny'},icon:'🚫'},
          {type:'end',label:'End (Alert)',extra:{label:'Alert',action:'Alert'},icon:'🔔'},
          {type:'end',label:'End (Webhook)',extra:{label:'Webhook',action:'Webhook'},icon:'🔗'},
        ].map((item,i)=><div key={i} onClick={()=>onAddNode(item.type,item.extra)} style={{padding:'7px 10px',borderRadius:8,cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:8,marginBottom:2,border:'1px solid transparent',transition:'all 0.12s'}}
          onMouseEnter={e=>{e.currentTarget.style.background=item.type==='branch'?colors.amberLight:colors.surfaceHover;e.currentTarget.style.borderColor=colors.border;}}
          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.borderColor='transparent';}}>
          <span style={{fontSize:13}}>{item.icon}</span><span style={{fontWeight:500}}>{item.label}</span></div>)}
      </div>
      <div>
        <div style={{fontSize:10,fontWeight:700,color:colors.textDim,textTransform:'uppercase',letterSpacing:0.6,marginBottom:6,padding:'0 4px'}}>Skills ({skills.length})</div>
        {Object.entries(filtered).map(([prefix,items])=><div key={prefix} style={{marginBottom:6}}>
          <div onClick={()=>setExpCat(expCat===prefix?'':prefix)} style={{padding:'5px 8px',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:700,color:colors.accent,display:'flex',justifyContent:'space-between',alignItems:'center',background:expCat===prefix?colors.accentLight:'transparent'}}>
            <span>{prefix.toUpperCase()}</span><span>{expCat===prefix?'▾':'▸'} {items.length}</span></div>
          {expCat===prefix && items.map(sk=><div key={sk.name} onClick={()=>onDragSkill(sk.name)} style={{padding:'6px 10px 6px 18px',borderRadius:7,cursor:'pointer',fontSize:11,marginBottom:1,border:'1px solid transparent'}}
            onMouseEnter={e=>{e.currentTarget.style.background=colors.accentLight;e.currentTarget.style.borderColor=colors.border;}}
            onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.borderColor='transparent';}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:colors.accent}}>🔧</span><span style={{fontFamily:fonts.mono,fontWeight:500}}>{sk.name.replace(`${prefix}-`,'')}</span></div>
            <div style={{fontSize:10,color:colors.textDim,marginLeft:22,marginTop:2}}>{sk.description}</div>
            {sk.tags?.length>0 && <div style={{display:'flex',gap:3,marginLeft:22,marginTop:3}}>
              {sk.tags.map(t=><span key={t} style={{padding:'0 5px',borderRadius:4,fontSize:8,fontWeight:600,color:tagColor(t),background:`${tagColor(t)}18`,textTransform:'uppercase'}}>{t}</span>)}</div>}
          </div>)}</div>)}
      </div>
      {automations.length>0 && <div style={{marginTop:14}}>
        <div style={{fontSize:10,fontWeight:700,color:colors.textDim,textTransform:'uppercase',letterSpacing:0.6,marginBottom:6,padding:'0 4px'}}>Macros ({automations.length})</div>
        {automations.map(a=><div key={a.id} onClick={()=>onAddNode('macro',{label:a.name,automation_id:a.id})}
          style={{padding:'6px 10px',borderRadius:7,cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:6,marginBottom:1}}
          onMouseEnter={e=>{e.currentTarget.style.background='#f3e8ff';}} onMouseLeave={e=>{e.currentTarget.style.background='transparent';}}>
          <span>📦</span><span style={{fontWeight:500}}>{a.name}</span><span style={{fontSize:10,color:colors.textDim,marginLeft:'auto'}}>{a.step_count}st</span></div>)}</div>}
    </div></div>;
}

// ══════════════════════════════════════════════════════════
// PROPERTIES PANEL
// ══════════════════════════════════════════════════════════
function PropertiesPanel({ node, skills, devices, allNodes, chainParams, setChainParams, onUpdate, onDelete, onAddFailureBranch, desc, setDesc, tags, setTags }) {
  if (!node) {
    return <div style={{width:290,background:colors.surface,borderLeft:`1px solid ${colors.border}`,overflow:'auto',padding:16}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:16}}>Workflow Properties</div>
      <div style={{marginBottom:12}}><FL label="Description" /><textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="What this workflow does..." rows={3} style={{fontSize:12,resize:'vertical'}} /></div>
      <div style={{marginBottom:16}}><FL label="Tags" /><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="network, troubleshooting" style={{fontSize:12}} /></div>
      <div style={{borderTop:`1px solid ${colors.border}`,paddingTop:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:600}}>Parameters</span>
          <button onClick={()=>setChainParams([...chainParams,{name:'',label:'',type:'string',required:true}])} style={{...btnS,padding:'2px 8px',fontSize:10,borderRadius:4}}>+ Add</button></div>
        <div style={{fontSize:10,color:colors.textDim,marginBottom:8}}>Prompted when running. Use {'{{chain.name}}'} in skill params.</div>
        {chainParams.map((p,i)=><div key={i} style={{padding:8,border:`1px solid ${colors.border}`,borderRadius:8,marginBottom:6,background:colors.surfaceAlt}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            <input value={p.name} onChange={e=>{const c=[...chainParams];c[i]={...c[i],name:e.target.value};setChainParams(c);}} placeholder="name" style={{fontSize:10,fontFamily:fonts.mono}} />
            <input value={p.label} onChange={e=>{const c=[...chainParams];c[i]={...c[i],label:e.target.value};setChainParams(c);}} placeholder="Label" style={{fontSize:10}} /></div>
          <div style={{display:'flex',gap:6,marginTop:4}}>
            <select value={p.type||'string'} onChange={e=>{const c=[...chainParams];c[i]={...c[i],type:e.target.value};setChainParams(c);}} style={{fontSize:10,flex:1}}>
              <option value="device">Device</option><option value="string">String</option><option value="integer">Integer</option><option value="boolean">Boolean</option></select>
            <button onClick={()=>setChainParams(chainParams.filter((_,j)=>j!==i))} style={{...btnS,padding:'2px 6px',fontSize:9,color:colors.red,borderRadius:4}}>✕</button></div></div>)}
      </div>
      <div style={{marginTop:16,padding:12,background:colors.accentLight,borderRadius:8,fontSize:11,color:colors.accentDark,lineHeight:1.5}}>
        <strong>Shortcuts:</strong> ⌘Z undo · ⌘⇧Z redo · ⌘S save · Del delete · Esc deselect</div>
    </div>;
  }

  const isSkill=node.type==='skill', isEnd=node.type==='end', isBranch=node.type==='branch', isMacro=node.type==='macro';
  const sm = isSkill&&node.data?.skill_name ? skills.find(s=>s.name===node.data.skill_name) : null;

  return <div style={{width:290,background:colors.surface,borderLeft:`1px solid ${colors.border}`,overflow:'auto',padding:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:700}}>{NODE_TYPES[node.type]?.icon} {NODE_TYPES[node.type]?.label}</div>
      {node.type!=='start' && <button onClick={onDelete} style={{...btnDanger,padding:'4px 10px',fontSize:11,borderRadius:6}}>Delete</button>}</div>
    <div style={{marginBottom:12}}><FL label="Label" /><input value={node.data?.label||''} onChange={e=>onUpdate({label:e.target.value})} /></div>

    {isEnd && <>
      <div style={{marginBottom:12}}><FL label="End Action" /><select value={node.data?.action||'Allow'} onChange={e=>onUpdate({action:e.target.value,label:e.target.value})}>{END_ACTIONS.map(a=><option key={a} value={a}>{a}</option>)}</select></div>
      {node.data?.action==='Webhook' && <WebhookConfig node={node} onUpdate={onUpdate} />}
      {node.data?.action==='Alert' && <div style={{padding:10,background:colors.amberLight,borderRadius:8,marginBottom:12,border:`1px solid ${colors.amber}30`}}>
        <FL label="Channel" /><select value={node.data?.alert_channel||'slack'} onChange={e=>onUpdate({alert_channel:e.target.value})} style={{marginBottom:8}}>
          <option value="slack">Slack</option><option value="pagerduty">PagerDuty</option><option value="email">Email</option><option value="teams">Teams</option></select>
        <FL label="Severity" /><select value={node.data?.alert_severity||'warning'} onChange={e=>onUpdate({alert_severity:e.target.value})} style={{marginBottom:8}}>
          <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select>
        <FL label="Message" /><textarea value={node.data?.alert_message||''} onChange={e=>onUpdate({alert_message:e.target.value})} placeholder="Workflow completed on {{chain.device}}" rows={2} style={{fontSize:11,fontFamily:fonts.mono,resize:'vertical'}} /></div>}</>}

    {isBranch && <BranchEditor node={node} onUpdate={onUpdate} allNodes={allNodes} />}

    {isMacro && <div style={{marginBottom:12}}><FL label="Sub-workflow" required /><select value={node.data?.automation_id||''} onChange={e=>onUpdate({automation_id:e.target.value})}>
      <option value="">Select...</option></select></div>}

    {isSkill && <>
      <div style={{marginBottom:12}}><FL label="Skill" required /><select value={node.data?.skill_name||''} onChange={e=>onUpdate({skill_name:e.target.value,label:node.data?.label===(node.data?.skill_name||'New Skill')?e.target.value:node.data?.label})}>
        <option value="">Select skill...</option>{skills.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}</select></div>
      {sm && <div style={{padding:8,background:colors.surfaceAlt,borderRadius:8,marginBottom:12,fontSize:11}}>
        <div style={{color:colors.textDim,marginBottom:4}}>{sm.description}</div>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{sm.tags?.map(t=><span key={t} style={{padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:600,background:colors.accentLight,color:colors.accent}}>{t}</span>)}</div></div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
        <div><FL label="Gate" /><select value={node.data?.gate||'auto'} onChange={e=>onUpdate({gate:e.target.value})}><option value="auto">Auto</option><option value="approve">Approval</option></select></div>
        <div><FL label="On Failure" /><select value={node.data?.on_failure||'stop'} onChange={e=>onUpdate({on_failure:e.target.value})}><option value="stop">Stop</option><option value="skip">Skip</option></select></div></div>
      <div style={{marginBottom:12}}><FL label="Device Source" />
        <select value={node.data?.device_source||'parameter'} onChange={e=>onUpdate({device_source:e.target.value})}>
          <option value="parameter">From Chain Parameter</option><option value="fixed">Fixed Device</option><option value="previous_step">From Previous Step</option></select>
        {node.data?.device_source==='parameter' && <input value={node.data?.device_param||'device'} onChange={e=>onUpdate({device_param:e.target.value})} placeholder="device" style={{fontSize:10,fontFamily:fonts.mono,marginTop:4}} />}
        {node.data?.device_source==='fixed' && <select value={node.data?.device_hostname||''} onChange={e=>onUpdate({device_hostname:e.target.value})} style={{marginTop:4}}>
          <option value="">Select...</option>{devices.map(d=><option key={d.hostname} value={d.hostname}>{d.hostname}</option>)}</select>}</div>
      <div style={{borderTop:`1px solid ${colors.border}`,paddingTop:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <span style={{fontSize:12,fontWeight:600}}>Parameters</span>
          <button onClick={()=>{const p={...(node.data?.parameters||{})};p['']='';onUpdate({parameters:p});}} style={{...btnS,padding:'2px 6px',fontSize:10,borderRadius:4}}>+ Add</button></div>
        <div style={{fontSize:10,color:colors.textDim,marginBottom:6}}>Use {'{{chain.xxx}}'} or {'{{steps.id.output}}'}</div>
        {Object.entries(node.data?.parameters||{}).map(([k,v],pi)=><div key={pi} style={{display:'flex',gap:4,marginBottom:4}}>
          <input value={k} onChange={e=>{const p={...(node.data?.parameters||{})};delete p[k];p[e.target.value]=v;onUpdate({parameters:p});}} placeholder="key" style={{flex:1,fontSize:10,fontFamily:fonts.mono,padding:'3px 4px'}} />
          <input value={v} onChange={e=>{const p={...(node.data?.parameters||{})};p[k]=e.target.value;onUpdate({parameters:p});}} placeholder="value" style={{flex:2,fontSize:10,fontFamily:fonts.mono,padding:'3px 4px'}} />
          <button onClick={()=>{const p={...(node.data?.parameters||{})};delete p[k];onUpdate({parameters:p});}} style={{...btnS,padding:'1px 4px',fontSize:9,color:colors.red,borderRadius:3}}>✕</button></div>)}</div>
      <div style={{borderTop:`1px solid ${colors.border}`,paddingTop:10,marginTop:10}}>
        <button onClick={onAddFailureBranch} style={{...btnS,width:'100%',padding:'7px',borderRadius:7,fontSize:11,color:colors.red,borderColor:colors.redLight}}>+ Add Failure Branch</button></div>
    </>}
    <div style={{marginTop:16,fontSize:10,color:colors.textDim,fontFamily:fonts.mono}}>ID: {node.id}</div>
  </div>;
}

// ══════════════════════════════════════════════════════════
// BRANCH CONDITION EDITOR
// ══════════════════════════════════════════════════════════
function BranchEditor({ node, onUpdate, allNodes }) {
  const conds = node.data?.conditions||[];
  const add = ()=>onUpdate({conditions:[...conds,{source:'',operator:'contains',value:'',logic:'AND'}]});
  const upd = (i,u)=>{const c=[...conds];c[i]={...c[i],...u};onUpdate({conditions:c});};
  const rem = (i)=>onUpdate({conditions:conds.filter((_,j)=>j!==i)});
  const refs = allNodes.filter(n=>n.type==='skill'&&n.data?.skill_name).map(n=>({v:`{{steps.${n.id}.output}}`,l:n.data.label||n.data.skill_name}));

  return <div style={{padding:10,background:colors.amberLight,borderRadius:8,marginBottom:12,border:`1px solid ${colors.amber}30`}}>
    <div style={{fontSize:11,fontWeight:700,color:colors.amber,marginBottom:8,display:'flex',justifyContent:'space-between'}}>
      <span>◇ Branch Conditions</span>
      <button onClick={add} style={{...btnS,padding:'2px 8px',fontSize:10,borderRadius:4,background:'#fff'}}>+ Add</button></div>
    {!conds.length && <div style={{fontSize:11,color:colors.textDim,textAlign:'center',padding:'8px 0'}}>No conditions. Add one to define when TRUE fires.</div>}
    {conds.map((c,i)=><div key={i} style={{padding:8,background:'#fff',borderRadius:6,marginBottom:6,border:`1px solid ${colors.border}`}}>
      {i>0 && <select value={c.logic||'AND'} onChange={e=>upd(i,{logic:e.target.value})} style={{fontSize:10,width:'auto',marginBottom:6}}><option value="AND">AND</option><option value="OR">OR</option></select>}
      <FL label="Source" />
      <select value={c.source||''} onChange={e=>upd(i,{source:e.target.value})} style={{fontSize:10,fontFamily:fonts.mono,marginBottom:6}}>
        <option value="">Select...</option>
        <option value="{{steps.previous.output}}">Previous step output</option>
        <option value="{{steps.previous.status}}">Previous step status</option>
        {refs.map(r=><option key={r.v} value={r.v}>{r.l} output</option>)}
        <option value="{{chain.device}}">Chain: device</option></select>
      <FL label="Operator" />
      <select value={c.operator||'contains'} onChange={e=>upd(i,{operator:e.target.value})} style={{fontSize:10,marginBottom:6}}>
        {BRANCH_OPS.map(op=><option key={op.v} value={op.v}>{op.l}</option>)}</select>
      {!['exists','status_success','status_failed'].includes(c.operator) && <><FL label="Value" />
        <input value={c.value||''} onChange={e=>upd(i,{value:e.target.value})} placeholder="Expected..." style={{fontSize:10,fontFamily:fonts.mono,marginBottom:4}} /></>}
      <button onClick={()=>rem(i)} style={{...btnS,padding:'2px 6px',fontSize:9,color:colors.red,borderRadius:4,marginTop:4}}>Remove</button>
    </div>)}
    <div style={{fontSize:10,color:colors.amber,marginTop:4,lineHeight:1.4}}><strong>TRUE</strong> fires when conditions match. <strong>FALSE</strong> otherwise.</div>
  </div>;
}

// ══════════════════════════════════════════════════════════
// WEBHOOK CONFIG
// ══════════════════════════════════════════════════════════
function WebhookConfig({ node, onUpdate }) {
  const [showH, setShowH] = useState(false);
  const [testSt, setTestSt] = useState(null);
  const hdrs = node.data?.webhook_headers||{};
  const doTest = ()=>{setTestSt('testing');setTimeout(()=>{setTestSt(node.data?.webhook_url?'success':'error');setTimeout(()=>setTestSt(null),3000);},1200);};

  return <div style={{padding:10,background:'#eef2ff',borderRadius:8,marginBottom:12,border:`1px solid ${colors.accent}30`}}>
    <div style={{fontSize:11,fontWeight:700,color:colors.accent,marginBottom:8}}>🔗 Webhook Configuration</div>
    <FL label="Method" /><select value={node.data?.webhook_method||'POST'} onChange={e=>onUpdate({webhook_method:e.target.value})} style={{marginBottom:8}}>
      <option value="POST">POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH</option><option value="GET">GET</option></select>
    <FL label="URL" required /><input value={node.data?.webhook_url||''} onChange={e=>onUpdate({webhook_url:e.target.value})} placeholder="https://hooks.slack.com/..." style={{fontSize:11,fontFamily:fonts.mono,marginBottom:8}} />
    <FL label="Auth" /><select value={node.data?.webhook_auth||'none'} onChange={e=>onUpdate({webhook_auth:e.target.value})} style={{marginBottom:8}}>
      <option value="none">None</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="api_key">API Key Header</option></select>
    {node.data?.webhook_auth==='bearer' && <><FL label="Token" required /><input type="password" value={node.data?.webhook_token||''} onChange={e=>onUpdate({webhook_token:e.target.value})} placeholder="eyJhb..." style={{fontSize:11,fontFamily:fonts.mono,marginBottom:8}} /></>}
    {node.data?.webhook_auth==='basic' && <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
      <div><FL label="User" /><input value={node.data?.webhook_username||''} onChange={e=>onUpdate({webhook_username:e.target.value})} /></div>
      <div><FL label="Pass" /><input type="password" value={node.data?.webhook_password||''} onChange={e=>onUpdate({webhook_password:e.target.value})} /></div></div>}
    {node.data?.webhook_auth==='api_key' && <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
      <div><FL label="Header" /><input value={node.data?.webhook_api_key_header||'X-API-Key'} onChange={e=>onUpdate({webhook_api_key_header:e.target.value})} style={{fontFamily:fonts.mono}} /></div>
      <div><FL label="Key" /><input type="password" value={node.data?.webhook_api_key||''} onChange={e=>onUpdate({webhook_api_key:e.target.value})} /></div></div>}
    <div style={{marginBottom:8}}>
      <div onClick={()=>setShowH(!showH)} style={{cursor:'pointer',fontSize:11,fontWeight:600,color:colors.textMuted,marginBottom:4}}>{showH?'▾':'▸'} Headers ({Object.keys(hdrs).length})</div>
      {showH && <>{Object.entries(hdrs).map(([k,v],i)=><div key={i} style={{display:'flex',gap:3,marginBottom:3}}>
        <input value={k} onChange={e=>{const h={...hdrs};delete h[k];h[e.target.value]=v;onUpdate({webhook_headers:h});}} placeholder="Header" style={{flex:1,fontSize:10,fontFamily:fonts.mono,padding:'3px 4px'}} />
        <input value={v} onChange={e=>{const h={...hdrs};h[k]=e.target.value;onUpdate({webhook_headers:h});}} placeholder="Value" style={{flex:2,fontSize:10,fontFamily:fonts.mono,padding:'3px 4px'}} />
        <button onClick={()=>{const h={...hdrs};delete h[k];onUpdate({webhook_headers:h});}} style={{...btnS,padding:'1px 4px',fontSize:9,color:colors.red,borderRadius:3}}>✕</button></div>)}
        <button onClick={()=>onUpdate({webhook_headers:{...hdrs,'':''}})} style={{...btnS,padding:'2px 6px',fontSize:9,borderRadius:4}}>+ Header</button></>}</div>
    <FL label="Payload" /><textarea value={node.data?.webhook_payload||'{\n  "workflow": "{{chain.workflow_name}}",\n  "device": "{{chain.device}}",\n  "status": "{{steps.last.output}}"\n}'}
      onChange={e=>onUpdate({webhook_payload:e.target.value})} rows={4} style={{fontSize:10,fontFamily:fonts.mono,resize:'vertical',lineHeight:1.4,marginBottom:4}} />
    <div style={{fontSize:10,color:colors.accent,marginBottom:8}}>Use {'{{chain.xxx}}'} or {'{{steps.id.output}}'} for dynamic values</div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
      <div><FL label="Timeout (s)" /><input type="number" value={node.data?.webhook_timeout||30} onChange={e=>onUpdate({webhook_timeout:parseInt(e.target.value)||30})} /></div>
      <div><FL label="Retries" /><select value={node.data?.webhook_retries||'0'} onChange={e=>onUpdate({webhook_retries:e.target.value})}><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div></div>
    <button onClick={doTest} disabled={testSt==='testing'} style={{width:'100%',padding:'7px',borderRadius:7,fontSize:11,fontWeight:600,
      background:testSt==='success'?colors.green:testSt==='error'?colors.red:colors.accent,color:'#fff',opacity:testSt==='testing'?0.6:1}}>
      {testSt==='testing'?'⏳ Testing...':testSt==='success'?'✓ OK':testSt==='error'?'✕ Failed':'🧪 Test Webhook'}</button>
  </div>;
}

// ══════════════════════════════════════════════════════════
// MINIMAP
// ══════════════════════════════════════════════════════════
function Minimap({ nodes, edges, bounds, pan, zoom, containerRef }) {
  const W=180,H=100, bw=bounds.maxX-bounds.minX||1, bh=bounds.maxY-bounds.minY||1, sc=Math.min(W/bw,H/bh)*0.88;
  return <div style={{position:'absolute',bottom:12,right:12,width:W,height:H,background:'rgba(255,255,255,0.94)',border:`1px solid ${colors.border}`,borderRadius:8,boxShadow:'0 2px 8px rgba(0,0,0,0.08)',overflow:'hidden'}}>
    <svg width={W} height={H}><g transform={`translate(${W/2-(bounds.minX+bw/2)*sc}, ${H/2-(bounds.minY+bh/2)*sc}) scale(${sc})`}>
      {edges.map(e=>{const f=nodes.find(n=>n.id===e.from),t=nodes.find(n=>n.id===e.to);if(!f||!t)return null;
        return <line key={e.id} x1={f.x+NODE_W/2} y1={f.y+NODE_H/2} x2={t.x+NODE_W/2} y2={t.y+NODE_H/2}
          stroke={e.port==='failure'||e.port==='false'?colors.red:e.port==='true'?colors.accent:colors.green} strokeWidth={2/sc} opacity={0.5}/>;})}
      {nodes.map(n=><rect key={n.id} x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={4} fill={NODE_TYPES[n.type]?.color||colors.accent} opacity={0.6}/>)}
    </g>
    {containerRef.current && (()=>{const cw=containerRef.current.clientWidth,ch=containerRef.current.clientHeight,vx=-pan.x/zoom,vy=-pan.y/zoom,vw=cw/zoom,vh=ch/zoom,ox=W/2-(bounds.minX+bw/2)*sc,oy=H/2-(bounds.minY+bh/2)*sc;
      return <rect x={ox+vx*sc} y={oy+vy*sc} width={vw*sc} height={vh*sc} fill="none" stroke={colors.accent} strokeWidth={1.5} rx={2}/>;})()}
    </svg></div>;
}
