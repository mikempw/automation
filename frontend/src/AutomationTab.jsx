import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { colors, fonts } from './styles';

// ── Shared mini-components (matching App.jsx patterns) ────
const btnP = {background:colors.accent,color:'#fff',fontWeight:600,boxShadow:'0 1px 3px rgba(37,99,235,0.3)'};
const btnS = {background:'#fff',color:colors.textMuted,border:`1px solid ${colors.border}`};
const btnDanger = {background:colors.red,color:'#fff',fontWeight:600};
const btnSuccess = {background:colors.green,color:'#fff',fontWeight:600};

function Card({children,style,onClick}){
  return <div onClick={onClick} style={{background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:12,padding:20,cursor:onClick?'pointer':'default',transition:'box-shadow 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.04)',...style}}
    onMouseEnter={e=>{if(onClick){e.currentTarget.style.borderColor=colors.accent;e.currentTarget.style.boxShadow='0 4px 12px rgba(37,99,235,0.1)'}}}
    onMouseLeave={e=>{e.currentTarget.style.borderColor=colors.border;e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.04)'}}>{children}</div>;
}

function Badge({status,children}){
  const map={complete:{bg:colors.greenLight,fg:colors.green},running:{bg:colors.accentLight,fg:colors.accent},
    failed:{bg:colors.redLight,fg:colors.red},waiting_approval:{bg:colors.amberLight,fg:colors.amber},
    cancelled:{bg:colors.border,fg:colors.textDim},manual:{bg:colors.accentLight,fg:colors.accent},
    webhook:{bg:colors.greenLight,fg:colors.green},alert:{bg:colors.amberLight,fg:colors.amber}};
  const c=map[status]||{bg:colors.amberLight,fg:colors.amber};
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:12,background:c.bg,color:c.fg,fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:0.3}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:c.fg}}/>{children}</span>;
}

function FL({label,required}){
  return <label style={{display:'flex',alignItems:'center',gap:4,marginBottom:5,fontSize:13,fontWeight:600,color:colors.textMuted}}>
    {label}{required&&<span style={{color:colors.red}}>*</span>}</label>;
}

// ── Main Automation Tab ───────────────────────────────────
export default function AutomationTab(){
  const[view,setView]=useState('list'); // list | editor | runner | run-detail
  const[automations,setAutomations]=useState([]);
  const[editing,setEditing]=useState(null);
  const[runTarget,setRunTarget]=useState(null);
  const[viewRun,setViewRun]=useState(null);

  const load=useCallback(()=>{api.listAutomations().then(setAutomations).catch(console.error)},[]);
  useEffect(()=>{load()},[load]);

  if(view==='editor') return <ChainEditor automation={editing} onSave={()=>{setView('list');setEditing(null);load()}} onCancel={()=>{setView('list');setEditing(null)}}/>;
  if(view==='runner') return <ChainRunner automation={runTarget} onBack={()=>{setView('list');setRunTarget(null)}}/>;
  if(view==='run-detail') return <RunDetail runId={viewRun} onBack={()=>{setView('list');setViewRun(null)}}/>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
      <div><h2 style={{fontSize:22,fontWeight:700,color:colors.text}}>Automations</h2>
        <p style={{fontSize:14,color:colors.textMuted,marginTop:4}}>Multi-skill chains for repeatable workflows</p></div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={()=>setView('templates')} style={{...btnS,padding:'8px 16px',borderRadius:8,fontSize:13}}>Templates</button>
        <button onClick={()=>{setEditing(null);setView('editor')}} style={{...btnP,padding:'8px 16px',borderRadius:8,fontSize:13}}>+ New Automation</button>
      </div>
    </div>

    {view==='templates'&&<TemplatePanel onUse={async(t)=>{
      const created=await api.createAutomation(t);
      load();setView('list');
    }} onClose={()=>setView('list')}/>}

    {automations.length===0&&view==='list'?<Card>
      <div style={{textAlign:'center',padding:40,color:colors.textDim}}>
        <div style={{fontSize:36,marginBottom:12}}>⛓️</div>
        <div style={{fontSize:16,fontWeight:600,marginBottom:8}}>No automations yet</div>
        <div style={{fontSize:14,marginBottom:20}}>Create a multi-skill chain or start from a template</div>
        <button onClick={()=>setView('templates')} style={{...btnP,padding:'10px 20px',borderRadius:8}}>Browse Templates</button>
      </div>
    </Card>:view==='list'&&<div style={{display:'grid',gap:12}}>
      {automations.map(a=><Card key={a.id} onClick={()=>{setEditing(a);setView('editor')}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
              <span style={{fontSize:16,fontWeight:600}}>{a.name}</span>
              <Badge status={a.trigger}>{a.trigger}</Badge>
            </div>
            <div style={{fontSize:13,color:colors.textDim,marginBottom:8}}>{a.description||'No description'}</div>
            <div style={{display:'flex',gap:16,fontSize:12,color:colors.textMuted}}>
              <span>{a.step_count} steps</span>
              <span>{a.parameter_count} parameters</span>
              {a.tags?.length>0&&<span>{a.tags.join(', ')}</span>}
            </div>
          </div>
          <div style={{display:'flex',gap:6}} onClick={e=>e.stopPropagation()}>
            <button onClick={()=>{setRunTarget(a);setView('runner')}} style={{...btnSuccess,padding:'6px 14px',borderRadius:8,fontSize:12}}>▶ Run</button>
            <button onClick={async()=>{await api.duplicateAutomation(a.id);load()}} style={{...btnS,padding:'6px 14px',borderRadius:8,fontSize:12}}>Clone</button>
            <button onClick={async()=>{if(window.confirm('Delete this automation?')){await api.deleteAutomation(a.id);load()}}} style={{...btnS,padding:'6px 14px',borderRadius:8,fontSize:12,color:colors.red}}>Del</button>
          </div>
        </div>
      </Card>)}
    </div>}

    {/* Recent Runs */}
    <RecentRuns onViewRun={(id)=>{setViewRun(id);setView('run-detail')}}/>
  </div>;
}


// ── Template Panel ────────────────────────────────────────
function TemplatePanel({onUse,onClose}){
  const[templates,setTemplates]=useState([]);
  useEffect(()=>{api.automationTemplates().then(setTemplates).catch(console.error)},[]);
  return <Card style={{marginBottom:20}}>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}>
      <span style={{fontSize:15,fontWeight:600}}>Automation Templates</span>
      <button onClick={onClose} style={{...btnS,padding:'4px 12px',borderRadius:6,fontSize:12}}>Close</button>
    </div>
    <div style={{display:'grid',gap:10}}>
      {templates.map((t,i)=><div key={i} style={{padding:14,border:`1px solid ${colors.border}`,borderRadius:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontWeight:600,fontSize:14}}>{t.name}</div>
          <div style={{fontSize:12,color:colors.textDim,marginTop:2}}>{t.description}</div>
          <div style={{fontSize:11,color:colors.textMuted,marginTop:4}}>{t.steps?.length} steps · {t.tags?.join(', ')}</div>
        </div>
        <button onClick={()=>onUse(t)} style={{...btnP,padding:'6px 14px',borderRadius:8,fontSize:12}}>Use</button>
      </div>)}
    </div>
  </Card>;
}


// ── Chain Editor ──────────────────────────────────────────
function ChainEditor({automation,onSave,onCancel}){
  const isEdit=!!automation?.id;
  const[name,setName]=useState(automation?.name||'');
  const[desc,setDesc]=useState(automation?.description||'');
  const[trigger,setTrigger]=useState(automation?.trigger||'manual');
  const[tags,setTags]=useState(automation?.tags?.join(', ')||'');
  const[steps,setSteps]=useState(automation?.steps||[]);
  const[params,setParams]=useState(automation?.parameters||[]);
  const[skills,setSkills]=useState([]);
  const[devices,setDevices]=useState([]);
  const[full,setFull]=useState(null); // loaded full definition for editing

  useEffect(()=>{
    api.listSkills().then(setSkills).catch(console.error);
    api.listDevices().then(setDevices).catch(console.error);
    if(isEdit && automation?.id) api.getAutomation(automation.id).then(d=>{
      setName(d.name);setDesc(d.description||'');setTrigger(d.trigger||'manual');
      setTags(d.tags?.join(', ')||'');setSteps(d.steps||[]);setParams(d.parameters||[]);
      setFull(d);
    }).catch(console.error);
  },[]);

  const addStep=()=>setSteps([...steps,{skill_name:'',label:'',gate:'auto',on_failure:'stop',device_source:'parameter',device_param:'device',parameters:{},parameter_map:{}}]);
  const removeStep=(i)=>setSteps(steps.filter((_,j)=>j!==i));
  const updateStep=(i,field,val)=>{const s=[...steps];s[i]={...s[i],[field]:val};setSteps(s)};
  const moveStep=(i,dir)=>{const s=[...steps];const j=i+dir;if(j<0||j>=s.length)return;[s[i],s[j]]=[s[j],s[i]];setSteps(s)};

  const addParam=()=>setParams([...params,{name:'',label:'',type:'string',required:true}]);
  const removeParam=(i)=>setParams(params.filter((_,j)=>j!==i));
  const updateParam=(i,field,val)=>{const p=[...params];p[i]={...p[i],[field]:val};setParams(p)};

  const save=async()=>{
    if(!name.trim())return alert('Name required');
    if(steps.length===0)return alert('Add at least one step');
    const data={name,description:desc,trigger,tags:tags.split(',').map(t=>t.trim()).filter(Boolean),steps,parameters:params};
    try{
      if(isEdit){await api.updateAutomation(automation.id,data)}
      else{await api.createAutomation(data)}
      onSave();
    }catch(e){alert(e.message)}
  };

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
      <h2 style={{fontSize:22,fontWeight:700}}>{isEdit?'Edit':'New'} Automation</h2>
      <div style={{display:'flex',gap:8}}>
        <button onClick={onCancel} style={{...btnS,padding:'8px 16px',borderRadius:8,fontSize:13}}>Cancel</button>
        <button onClick={save} style={{...btnP,padding:'8px 16px',borderRadius:8,fontSize:13}}>💾 Save</button>
      </div>
    </div>

    {/* Metadata */}
    <Card style={{marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Chain Settings</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div><FL label="Name" required/><input value={name} onChange={e=>setName(e.target.value)} placeholder="Troubleshoot Connectivity"/></div>
        <div><FL label="Trigger"/><select value={trigger} onChange={e=>setTrigger(e.target.value)}>
          <option value="manual">Manual</option><option value="webhook">Webhook</option><option value="alert">Alert</option>
        </select></div>
        <div style={{gridColumn:'1/-1'}}><FL label="Description"/><input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="What this automation does"/></div>
        <div><FL label="Tags"/><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="troubleshooting, network"/></div>
      </div>
    </Card>

    {/* Chain Parameters */}
    <Card style={{marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:14,fontWeight:600}}>Chain Parameters</span>
        <button onClick={addParam} style={{...btnS,padding:'4px 12px',borderRadius:6,fontSize:12}}>+ Add</button>
      </div>
      <div style={{fontSize:12,color:colors.textDim,marginBottom:10}}>
        These are prompted when running. Reference in steps as {'{{chain.param_name}}'}
      </div>
      {params.map((p,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 100px 60px 40px',gap:8,marginBottom:6,alignItems:'end'}}>
        <div><FL label="Name"/><input value={p.name} onChange={e=>updateParam(i,'name',e.target.value)} placeholder="device" style={{fontSize:12,fontFamily:fonts.mono}}/></div>
        <div><FL label="Label"/><input value={p.label} onChange={e=>updateParam(i,'label',e.target.value)} placeholder="Target Device"/></div>
        <div><FL label="Type"/><select value={p.type||'string'} onChange={e=>updateParam(i,'type',e.target.value)} style={{fontSize:12}}>
          <option value="device">Device</option><option value="string">String</option><option value="integer">Integer</option><option value="boolean">Boolean</option>
        </select></div>
        <div style={{textAlign:'center'}}><FL label="Req"/><input type="checkbox" checked={p.required!==false} onChange={e=>updateParam(i,'required',e.target.checked)}/></div>
        <button onClick={()=>removeParam(i)} style={{...btnS,padding:'4px 8px',borderRadius:6,fontSize:11,color:colors.red,marginBottom:0}}>✕</button>
      </div>)}
    </Card>

    {/* Steps */}
    <Card>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:14,fontWeight:600}}>Steps ({steps.length})</span>
        <button onClick={addStep} style={{...btnS,padding:'4px 12px',borderRadius:6,fontSize:12}}>+ Add Step</button>
      </div>
      {steps.map((s,i)=><div key={i} style={{border:`1px solid ${colors.border}`,borderRadius:10,padding:14,marginBottom:10,background:colors.surfaceAlt||'#fafbfc'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:24,height:24,borderRadius:'50%',background:colors.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700}}>{i+1}</span>
            <span style={{fontSize:13,fontWeight:600,color:colors.text}}>{s.label||s.skill_name||'New Step'}</span>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button onClick={()=>moveStep(i,-1)} disabled={i===0} style={{...btnS,padding:'2px 8px',borderRadius:4,fontSize:11}}>↑</button>
            <button onClick={()=>moveStep(i,1)} disabled={i===steps.length-1} style={{...btnS,padding:'2px 8px',borderRadius:4,fontSize:11}}>↓</button>
            <button onClick={()=>removeStep(i)} style={{...btnS,padding:'2px 8px',borderRadius:4,fontSize:11,color:colors.red}}>✕</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          <div><FL label="Skill" required/><select value={s.skill_name} onChange={e=>{updateStep(i,'skill_name',e.target.value);if(!s.label)updateStep(i,'label',e.target.value)}} style={{fontSize:12}}>
            <option value="">Select skill...</option>
            {skills.map(sk=><option key={sk.name} value={sk.name}>{sk.name}</option>)}
          </select></div>
          <div><FL label="Label"/><input value={s.label||''} onChange={e=>updateStep(i,'label',e.target.value)} placeholder="Step label" style={{fontSize:12}}/></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div><FL label="Gate"/><select value={s.gate||'auto'} onChange={e=>updateStep(i,'gate',e.target.value)} style={{fontSize:12}}>
              <option value="auto">Auto</option><option value="approve">Approval</option>
            </select></div>
            <div><FL label="On Fail"/><select value={s.on_failure||'stop'} onChange={e=>updateStep(i,'on_failure',e.target.value)} style={{fontSize:12}}>
              <option value="stop">Stop</option><option value="skip">Skip</option>
            </select></div>
          </div>
        </div>
        {/* Parameter overrides */}
        <div style={{marginTop:8}}>
          <div style={{fontSize:11,fontWeight:600,color:colors.textMuted,marginBottom:4}}>Parameter Overrides (key = value or {'{{chain.xxx}}'})</div>
          {Object.entries(s.parameters||{}).map(([k,v],pi)=><div key={pi} style={{display:'flex',gap:6,marginBottom:4}}>
            <input value={k} onChange={e=>{const p={...s.parameters};const newK=e.target.value;delete p[k];p[newK]=v;updateStep(i,'parameters',p)}} placeholder="key" style={{flex:1,fontSize:11,fontFamily:fonts.mono}}/>
            <input value={v} onChange={e=>{const p={...s.parameters};p[k]=e.target.value;updateStep(i,'parameters',p)}} placeholder="value or {{chain.xxx}}" style={{flex:2,fontSize:11,fontFamily:fonts.mono}}/>
            <button onClick={()=>{const p={...s.parameters};delete p[k];updateStep(i,'parameters',p)}} style={{...btnS,padding:'2px 6px',fontSize:10,color:colors.red}}>✕</button>
          </div>)}
          <button onClick={()=>{const p={...s.parameters};p['']='';;updateStep(i,'parameters',p)}} style={{...btnS,padding:'2px 8px',borderRadius:4,fontSize:10,marginTop:2}}>+ param</button>
        </div>
      </div>)}
    </Card>
  </div>;
}


// ── Chain Runner ──────────────────────────────────────────
function ChainRunner({automation,onBack}){
  const[full,setFull]=useState(null);
  const[devices,setDevices]=useState([]);
  const[paramValues,setParamValues]=useState({});
  const[running,setRunning]=useState(false);
  const[run,setRun]=useState(null);

  useEffect(()=>{
    api.getAutomation(automation.id).then(d=>{setFull(d);
      const defaults={};(d.parameters||[]).forEach(p=>{defaults[p.name]=p.default||''});setParamValues(defaults);
    }).catch(console.error);
    api.listDevices().then(setDevices).catch(console.error);
  },[automation.id]);

  const execute=async()=>{
    setRunning(true);
    try{
      const result=await api.runAutomation(automation.id,{parameters:paramValues});
      setRun(result);
    }catch(e){alert(e.message)}
    setRunning(false);
  };

  const resume=async(action)=>{
    if(!run)return;
    setRunning(true);
    try{const result=await api.resumeAutomationRun(run.id,{action});setRun(result)}catch(e){alert(e.message)}
    setRunning(false);
  };

  const refresh=async()=>{if(run)try{setRun(await api.getAutomationRun(run.id))}catch(e){}};

  if(!full) return <div>Loading...</div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
      <div><h2 style={{fontSize:22,fontWeight:700}}>▶ {full.name}</h2>
        <p style={{fontSize:14,color:colors.textMuted,marginTop:4}}>{full.description}</p></div>
      <button onClick={onBack} style={{...btnS,padding:'8px 16px',borderRadius:8,fontSize:13}}>← Back</button>
    </div>

    {!run&&<Card style={{marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Parameters</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        {(full.parameters||[]).map(p=><div key={p.name}>
          <FL label={p.label} required={p.required}/>
          {p.type==='device'?<select value={paramValues[p.name]||''} onChange={e=>setParamValues({...paramValues,[p.name]:e.target.value})}>
            <option value="">Select device...</option>
            {devices.map(d=><option key={d.hostname} value={d.hostname}>{d.hostname} ({d.mgmt_ip})</option>)}
          </select>:<input value={paramValues[p.name]||''} onChange={e=>setParamValues({...paramValues,[p.name]:e.target.value})} placeholder={p.name}/>}
        </div>)}
      </div>
      <div style={{marginTop:16}}>
        <button onClick={execute} disabled={running} style={{...btnP,padding:'10px 24px',borderRadius:8,fontSize:14}}>
          {running?'Running...':'▶ Execute Chain'}
        </button>
      </div>
    </Card>}

    {run&&<RunProgress run={run} onResume={resume} onRefresh={refresh} running={running}/>}
  </div>;
}


// ── Run Progress Display ─────────────────────────────────
function RunProgress({run,onResume,onRefresh,running}){
  return <Card>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:15,fontWeight:600}}>Run {run.id}</span>
        <Badge status={run.status}>{run.status}</Badge>
      </div>
      <div style={{fontSize:12,color:colors.textDim}}>
        {run.current_step}/{run.total_steps} steps
      </div>
    </div>

    {/* Step timeline */}
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {(run.step_results||[]).map((s,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',border:`1px solid ${colors.border}`,borderRadius:8,
        background:s.status==='complete'?'#f0fdf4':s.status==='failed'?'#fef2f2':colors.surface}}>
        <span style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,
          background:s.status==='complete'?colors.green:s.status==='failed'?colors.red:colors.accent,color:'#fff'}}>{i+1}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:600}}>{s.label||s.skill_name}</div>
          <div style={{fontSize:11,color:colors.textDim,fontFamily:fonts.mono}}>{s.skill_name} → {s.device||'?'} {s.duration_ms?`(${s.duration_ms}ms)`:''}</div>
          {s.error&&<div style={{fontSize:11,color:colors.red,marginTop:2}}>{s.error}</div>}
        </div>
        <Badge status={s.status}>{s.status}</Badge>
      </div>)}
    </div>

    {run.status==='waiting_approval'&&<div style={{marginTop:16,padding:16,background:colors.amberLight,borderRadius:10,border:`1px solid ${colors.amber}`}}>
      <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>⏸️ Approval Required</div>
      <div style={{fontSize:13,marginBottom:12}}>Step {run.current_step} requires approval before continuing.</div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={()=>onResume('approve')} disabled={running} style={{...btnSuccess,padding:'8px 20px',borderRadius:8,fontSize:13}}>✓ Approve & Continue</button>
        <button onClick={()=>onResume('reject')} disabled={running} style={{...btnDanger,padding:'8px 20px',borderRadius:8,fontSize:13}}>✕ Reject</button>
      </div>
    </div>}

    {(run.status==='running')&&<div style={{marginTop:12,textAlign:'center'}}>
      <button onClick={onRefresh} style={{...btnS,padding:'6px 16px',borderRadius:8,fontSize:12}}>🔄 Refresh</button>
    </div>}
  </Card>;
}


// ── Recent Runs ──────────────────────────────────────────
function RecentRuns({onViewRun}){
  const[runs,setRuns]=useState([]);
  useEffect(()=>{api.listAllAutomationRuns(20).then(setRuns).catch(console.error)},[]);
  if(runs.length===0) return null;

  return <div style={{marginTop:24}}>
    <div style={{fontSize:15,fontWeight:600,marginBottom:12}}>Recent Runs</div>
    <div style={{display:'grid',gap:8}}>
      {runs.map(r=><Card key={r.id} onClick={()=>onViewRun(r.id)} style={{padding:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <span style={{fontWeight:600,fontSize:14}}>{r.automation_name}</span>
            <span style={{fontSize:12,color:colors.textDim,marginLeft:10,fontFamily:fonts.mono}}>{r.id}</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:12,color:colors.textDim}}>{r.current_step}/{r.total_steps}</span>
            <Badge status={r.status}>{r.status}</Badge>
          </div>
        </div>
      </Card>)}
    </div>
  </div>;
}


// ── Run Detail View ──────────────────────────────────────
function RunDetail({runId,onBack}){
  const[run,setRun]=useState(null);
  const[running,setRunning]=useState(false);
  useEffect(()=>{api.getAutomationRun(runId).then(setRun).catch(console.error)},[runId]);

  const resume=async(action)=>{
    setRunning(true);
    try{setRun(await api.resumeAutomationRun(runId,{action}))}catch(e){alert(e.message)}
    setRunning(false);
  };

  if(!run) return <div>Loading...</div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
      <h2 style={{fontSize:22,fontWeight:700}}>Run: {run.automation_name}</h2>
      <button onClick={onBack} style={{...btnS,padding:'8px 16px',borderRadius:8,fontSize:13}}>← Back</button>
    </div>
    <RunProgress run={run} onResume={resume} onRefresh={async()=>{try{setRun(await api.getAutomationRun(runId))}catch(e){}}} running={running}/>

    {/* Step output details */}
    {(run.step_results||[]).filter(s=>s.output_preview||s.analysis).map((s,i)=><Card key={i} style={{marginTop:12}}>
      <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{s.label||s.skill_name} — Output</div>
      {s.output_preview&&<pre style={{background:colors.surfaceAlt||'#f8f9fa',padding:12,borderRadius:8,fontSize:11,fontFamily:fonts.mono,maxHeight:200,overflow:'auto',whiteSpace:'pre-wrap',border:`1px solid ${colors.border}`}}>{s.output_preview}</pre>}
      {s.analysis&&<div style={{marginTop:10,padding:12,background:colors.accentLight,borderRadius:8,fontSize:13,lineHeight:1.5}}>
        <div style={{fontWeight:600,marginBottom:4,color:colors.accent}}>✦ AI Analysis</div>
        {s.analysis}
      </div>}
    </Card>)}
  </div>;
}
