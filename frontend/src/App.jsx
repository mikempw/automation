import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import { colors, fonts, globalStyles } from './styles';
import TrafficFlowVisualizer from './TrafficFlowVisualizer';
import AutomationTab from './AutomationTab';
import VisualWorkflowEditor from './VisualWorkflowEditor';

// ═══════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════
function Tooltip({ text }) {
  const [show, setShow] = useState(false);
  if (!text) return null;
  return (
    <span style={{ position:'relative', display:'inline-flex', marginLeft:6, cursor:'help' }}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>
      {show&&<div style={{position:'absolute',bottom:'100%',left:'50%',transform:'translateX(-50%)',background:'#1f2937',color:'#fff',borderRadius:8,padding:'8px 12px',fontSize:12,whiteSpace:'pre-wrap',width:280,zIndex:100,marginBottom:6,lineHeight:1.5,boxShadow:'0 8px 30px rgba(0,0,0,0.2)'}}>{text}</div>}
    </span>
  );
}

function FL({ label, required, tooltip }) {
  return (<label style={{display:'flex',alignItems:'center',gap:4,marginBottom:5,fontSize:13,fontWeight:600,color:colors.textMuted}}>
    {label}{required&&<span style={{color:colors.red}}>*</span>}<Tooltip text={tooltip}/>
  </label>);
}

function Badge({ status, children }) {
  const map = {
    complete:{bg:colors.greenLight,fg:colors.green},running:{bg:colors.accentLight,fg:colors.accent},
    failed:{bg:colors.redLight,fg:colors.red},pending:{bg:colors.amberLight,fg:colors.amber},
    rejected:{bg:colors.border,fg:colors.textDim},bigip:{bg:colors.accentLight,fg:colors.accent},
    nginx:{bg:colors.greenLight,fg:colors.green},nginx_plus:{bg:colors.greenLight,fg:colors.green},
    connected:{bg:colors.greenLight,fg:colors.green},disconnected:{bg:colors.border,fg:colors.textDim},
    error:{bg:colors.redLight,fg:colors.red},
  };
  const c = map[status] || {bg:colors.amberLight,fg:colors.amber};
  return (<span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:12,background:c.bg,color:c.fg,fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:0.3}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:c.fg}}/>{children}
  </span>);
}

function Card({children,style,onClick}){
  return <div onClick={onClick} style={{background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:12,padding:20,cursor:onClick?'pointer':'default',transition:'box-shadow 0.2s, border-color 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.04)',...style}}
    onMouseEnter={e=>{if(onClick){e.currentTarget.style.borderColor=colors.accent;e.currentTarget.style.boxShadow='0 4px 12px rgba(37,99,235,0.1)'}}}
    onMouseLeave={e=>{e.currentTarget.style.borderColor=colors.border;e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.04)'}}>{children}</div>;
}

function PageHeader({title,subtitle,children}){
  return <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
    <div><h2 style={{fontSize:22,fontWeight:700,color:colors.text}}>{title}</h2>
      {subtitle&&<p style={{fontSize:14,color:colors.textMuted,marginTop:4}}>{subtitle}</p>}</div>
    {children}
  </div>;
}

const btnP = {background:colors.accent,color:'#fff',fontWeight:600,boxShadow:'0 1px 3px rgba(37,99,235,0.3)'};
const btnS = {background:'#fff',color:colors.textMuted,border:`1px solid ${colors.border}`};
const btnDanger = {background:colors.red,color:'#fff',fontWeight:600};
const btnSuccess = {background:colors.green,color:'#fff',fontWeight:600};

// Toast
const ToastContext = React.createContext({addToast:()=>{}});
function ToastProvider({children}){
  const[toasts,setToasts]=useState([]);
  const addToast=useCallback((msg,type='info',duration=4000)=>{
    const id=Date.now();setToasts(prev=>[...prev,{id,msg,type}]);
    setTimeout(()=>setToasts(prev=>prev.filter(t=>t.id!==id)),duration);
  },[]);
  const colorMap={info:colors.accent,success:colors.green,error:colors.red,warning:colors.amber};
  return <ToastContext.Provider value={{addToast}}>
    {children}
    <div style={{position:'fixed',top:16,right:16,zIndex:10000,display:'flex',flexDirection:'column',gap:8}}>
      {toasts.map(t=><div key={t.id} style={{padding:'12px 20px',background:colors.surface,border:`1px solid ${colors.border}`,borderLeft:`4px solid ${colorMap[t.type]||colors.accent}`,borderRadius:10,boxShadow:'0 8px 30px rgba(0,0,0,0.15)',fontSize:13,maxWidth:400,animation:'slideIn 0.3s ease'}}>{t.msg}</div>)}
    </div>
  </ToastContext.Provider>;
}
function useToast(){return React.useContext(ToastContext)}

// ═══════════════════════════════════════════════════════════
// DEVICE MANAGER (with Edit)
// ═══════════════════════════════════════════════════════════
const EMPTY_FORM = {hostname:'',mgmt_ip:'',device_type:'bigip',port:22,ssh_auth_method:'password',username:'',password:'',ssh_private_key:'',rest_username:'',rest_password:'',description:'',tags:''};

function DeviceForm({form,setForm,onSubmit,onCancel,title,submitLabel}){
  return <Card style={{marginBottom:20}}>
    <h3 style={{fontSize:16,fontWeight:600,marginBottom:16}}>{title}</h3>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
      <div><FL label="Hostname" required/><input value={form.hostname} onChange={e=>setForm({...form,hostname:e.target.value})} placeholder="bigip01.lab.local"/></div>
      <div><FL label="Management IP" required/><input value={form.mgmt_ip} onChange={e=>setForm({...form,mgmt_ip:e.target.value})} placeholder="10.1.1.245"/></div>
      <div><FL label="Device Type" required/><select value={form.device_type} onChange={e=>setForm({...form,device_type:e.target.value})}><option value="bigip">BIG-IP</option><option value="nginx">NGINX</option><option value="nginx_plus">NGINX Plus</option></select></div>
      <div><FL label="SSH Port"/><input type="number" value={form.port} onChange={e=>setForm({...form,port:e.target.value})}/></div>
      <div><FL label="SSH Auth Method" required/><select value={form.ssh_auth_method} onChange={e=>setForm({...form,ssh_auth_method:e.target.value})}><option value="password">Password</option><option value="ssh_key">SSH Key</option></select></div>
      <div><FL label="SSH Username" required/><input value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="root"/></div>
      {form.ssh_auth_method==='password'?
        <div><FL label="SSH Password" required/><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder={form._editing?"(unchanged if empty)":""}/></div>
      :<div style={{gridColumn:'1/-1'}}><FL label="SSH Private Key" required/><textarea value={form.ssh_private_key} onChange={e=>setForm({...form,ssh_private_key:e.target.value})} rows={6} style={{fontFamily:fonts.mono,fontSize:12}} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"/></div>}
      {form.device_type==='bigip'&&<>
      <div><FL label="REST Username"/><input value={form.rest_username} onChange={e=>setForm({...form,rest_username:e.target.value})} placeholder="admin"/></div>
      <div><FL label="REST Password"/><input type="password" value={form.rest_password} onChange={e=>setForm({...form,rest_password:e.target.value})} placeholder={form._editing?"(unchanged if empty)":""}/></div>
      </>}
      <div><FL label="Description"/><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Production HA pair"/></div>
      <div><FL label="Tags"/><input value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})} placeholder="production, dc-east"/></div>
    </div>
    <div style={{marginTop:16,display:'flex',gap:8}}>
      <button onClick={onSubmit} style={btnSuccess}>{submitLabel}</button>
      <button onClick={onCancel} style={btnS}>Cancel</button>
    </div>
  </Card>;
}

function DeviceManager(){
  const[devices,setDevices]=useState([]);const[showForm,setShowForm]=useState(false);const[editHost,setEditHost]=useState(null);
  const[form,setForm]=useState(EMPTY_FORM);const[testing,setTesting]=useState(null);const[testR,setTestR]=useState({});
  const{addToast}=useToast();
  const load=useCallback(async()=>{try{setDevices(await api.listDevices())}catch(e){console.error(e)}},[]);
  useEffect(()=>{load()},[load]);
  const submit=async()=>{try{
    const data={...form,port:parseInt(form.port)||22,tags:form.tags?form.tags.split(',').map(t=>t.trim()):[]};
    if(editHost){await api.updateDevice(editHost,data);addToast(`Device "${data.hostname}" updated`,'success')}
    else{await api.addDevice(data);addToast(`Device "${data.hostname}" added`,'success')}
    setShowForm(false);setEditHost(null);setForm(EMPTY_FORM);load();
  }catch(e){alert(e.message)}};
  const startEdit=async(hostname)=>{try{const d=await api.getDevice(hostname);
    setForm({hostname:d.hostname,mgmt_ip:d.mgmt_ip,device_type:d.device_type,port:d.port,ssh_auth_method:d.ssh_auth_method,
      username:d.username,password:'',ssh_private_key:'',rest_username:d.rest_username||'',rest_password:'',
      description:d.description||'',tags:(d.tags||[]).join(', '),_editing:true});
    setEditHost(hostname);setShowForm(true)}catch(e){alert(e.message)}};
  const test=async(h)=>{setTesting(h);try{setTestR({...testR,[h]:await api.testDevice(h)})}catch(e){setTestR({...testR,[h]:{error:e.message}})}setTesting(null)};
  const del=async(h)=>{if(!window.confirm(`Delete "${h}"?`))return;try{await api.deleteDevice(h);addToast(`Deleted ${h}`,'info');load()}catch(e){alert(e.message)}};

  return <div>
    <PageHeader title="Devices" subtitle="Manage BIG-IP and NGINX device inventory.">
      <button onClick={()=>{setShowForm(!showForm);setEditHost(null);setForm(EMPTY_FORM)}} style={btnP}>+ Add Device</button>
    </PageHeader>
    {showForm&&<DeviceForm form={form} setForm={setForm} onSubmit={submit} onCancel={()=>{setShowForm(false);setEditHost(null)}}
      title={editHost?`Edit: ${editHost}`:'Add New Device'} submitLabel={editHost?'Update Device':'Save to Vault'}/>}
    {devices.length===0?<Card><div style={{textAlign:'center',padding:40,color:colors.textDim}}>No devices registered.</div></Card>
    :<div style={{background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:12,overflow:'hidden'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
        <thead><tr style={{borderBottom:`2px solid ${colors.border}`,background:colors.surfaceAlt}}>
          {['Device','Type','IP','Auth','Status','Actions'].map(h=><th key={h} style={{padding:'12px 16px',textAlign:'left',fontWeight:600,fontSize:13,color:colors.textMuted}}>{h}</th>)}
        </tr></thead>
        <tbody>{devices.map(d=><tr key={d.hostname} style={{borderBottom:`1px solid ${colors.border}`}}>
          <td style={{padding:'12px 16px'}}><div style={{fontWeight:600,color:colors.accent}}>{d.hostname}</div>
            {d.description&&<div style={{fontSize:12,color:colors.textDim,marginTop:2}}>{d.description}</div>}</td>
          <td style={{padding:'12px 16px'}}><Badge status={d.device_type}>{d.device_type}</Badge></td>
          <td style={{padding:'12px 16px',fontFamily:fonts.mono,fontSize:13}}>{d.mgmt_ip}:{d.port}</td>
          <td style={{padding:'12px 16px'}}><span style={{padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:600,fontFamily:fonts.mono,background:d.ssh_auth_method==='ssh_key'?'#e0f2fe':'#f3f4f6',color:d.ssh_auth_method==='ssh_key'?'#0369a1':'#6b7280'}}>{d.ssh_auth_method==='ssh_key'?'🔑 Key':'🔒 Pass'}</span></td>
          <td style={{padding:'12px 16px'}}>{testR[d.hostname]?testR[d.hostname].error?<Badge status="failed">Error</Badge>:<Badge status="complete">{testR[d.hostname].version||'OK'}</Badge>:<span style={{color:colors.textDim,fontSize:13}}>—</span>}</td>
          <td style={{padding:'12px 16px'}}><div style={{display:'flex',gap:6}}>
            <button onClick={()=>test(d.hostname)} disabled={testing===d.hostname} style={{...btnS,fontSize:12,padding:'5px 12px'}}>{testing===d.hostname?'...':'Test'}</button>
            <button onClick={()=>startEdit(d.hostname)} style={{...btnS,fontSize:12,padding:'5px 12px',color:colors.accent}}>Edit</button>
            <button onClick={()=>del(d.hostname)} style={{...btnS,fontSize:12,padding:'5px 12px',color:colors.red}}>Del</button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

// ═══════════════════════════════════════════════════════════
// SKILL INVENTORY (with Delete)
// ═══════════════════════════════════════════════════════════
function SkillInventory({onRun,onView}){
  const[skills,setSkills]=useState([]);const{addToast}=useToast();
  const load=useCallback(()=>{api.listSkills().then(setSkills).catch(console.error)},[]);
  useEffect(()=>{load()},[load]);
  const del=async(name,e)=>{e.stopPropagation();if(!window.confirm(`Delete skill "${name}"?`))return;
    try{await api.deleteSkill(name);addToast(`Deleted "${name}"`,'info');load()}catch(e){alert(e.message)}};
  return <div>
    <PageHeader title="Skills" subtitle={`${skills.length} skills available.`}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:16}}>
      {skills.map(s=><Card key={s.name} onClick={()=>onView(s.name)}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',marginBottom:8}}>
          <div style={{fontWeight:600,fontSize:15}}>{s.name}</div><Badge status={s.product}>{s.product}</Badge></div>
        <p style={{fontSize:13,color:colors.textMuted,lineHeight:1.5,marginBottom:12,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{s.description}</p>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
          {(s.transports||[]).map(t=><span key={t} style={{padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:600,fontFamily:fonts.mono,background:t==='ssh'?'#e0f2fe':'#fce7f3',color:t==='ssh'?'#0369a1':'#be185d'}}>{t.toUpperCase()}</span>)}
          {s.destructive&&<span style={{padding:'2px 8px',background:colors.redLight,borderRadius:6,fontSize:11,color:colors.red,fontWeight:600}}>destructive</span>}
          {s.requires_approval&&<span style={{padding:'2px 8px',background:colors.amberLight,borderRadius:6,fontSize:12,color:colors.amber}}>⚠ approval</span>}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={e=>{e.stopPropagation();onRun(s.name)}} style={{...btnP,fontSize:13,padding:'7px 16px',flex:1}}>Run</button>
          <button onClick={e=>del(s.name,e)} style={{...btnS,fontSize:13,padding:'7px 12px',color:colors.red}} title="Delete">✕</button>
        </div>
      </Card>)}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════
// SKILL RUNNER (with SSE progress)
// ═══════════════════════════════════════════════════════════
function SkillRunner({skillName,onBack,onEdit}){
  const[skill,setSkill]=useState(null);const[devices,setDevices]=useState([]);const[selDev,setSelDev]=useState('');
  const[params,setParams]=useState({});const[result,setResult]=useState(null);const[running,setRunning]=useState(false);
  const[approved,setApproved]=useState(false);const[progress,setProgress]=useState(null);const{addToast}=useToast();
  useEffect(()=>{(async()=>{const[s,d]=await Promise.all([api.getSkill(skillName),api.listDevices()]);setSkill(s);setDevices(d);
    const defs={};(s.parameters||[]).forEach(p=>{if(p.default)defs[p.name]=p.default});setParams(defs);
    const m=d.filter(dev=>dev.device_type===s.product);if(m.length>0)setSelDev(m[0].hostname)})()},[skillName]);
  const exec=async()=>{if(!selDev)return alert('Select a device');setRunning(true);setResult(null);setProgress(null);
    try{await api.executeStream({skill_name:skillName,device_hostname:selDev,parameters:params},(ev)=>{
      if(ev.type==='step_start')setProgress({step:ev.step_index,total:ev.total_steps,label:ev.step_label,status:'running'});
      if(ev.type==='step_complete'){setProgress({step:ev.step_index+1,total:ev.total_steps,label:ev.step_name,status:ev.status});
        if(ev.status==='failed')addToast(`Step "${ev.step_name}" failed`,'error');}
      if(ev.type==='analyzing')setProgress(p=>({...p,label:'AI Analysis...'}));
      if(ev.type==='execution_complete'){setResult(ev.result);addToast(`Skill ${ev.status}`,ev.status==='complete'?'success':'error');}
      if(ev.type==='error'){setResult({status:'failed',error:ev.error});addToast(ev.error,'error');}
    })}catch(e){setResult({status:'failed',error:e.message})}setRunning(false);setProgress(null)};
  if(!skill)return <div style={{color:colors.textDim}}>Loading...</div>;
  const needApproval=skill.safety?.requires_approval&&!approved;
  return <div>
    <div style={{display:'flex',gap:8,marginBottom:20}}>
      <button onClick={onBack} style={{...btnS,fontSize:13}}>← Back</button>
      {onEdit&&<button onClick={()=>onEdit(skillName)} style={{...btnS,fontSize:13,color:colors.accent}}>✎ Edit</button>}
    </div>
    <h2 style={{fontSize:20,fontWeight:700,marginBottom:20,display:'flex',gap:10,alignItems:'center'}}>{skill.name} <Badge status={skill.product}>{skill.product}</Badge>
      {skill.safety?.destructive&&<Badge status="failed">DESTRUCTIVE</Badge>}</h2>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
      <Card>
        <h3 style={{fontSize:15,fontWeight:600,marginBottom:16}}>Parameters</h3>
        <div style={{marginBottom:14}}><FL label="Target Device" required/>
          <select value={selDev} onChange={e=>setSelDev(e.target.value)}><option value="">Select...</option>
            {devices.map(d=><option key={d.hostname} value={d.hostname}>{d.hostname} ({d.mgmt_ip})</option>)}</select></div>
        {(skill.parameters||[]).map(p=><div key={p.name} style={{marginBottom:14}}>
          <FL label={p.label||p.name} required={p.required} tooltip={p.description}/>
          {p.type==='select'?<select value={params[p.name]||''} onChange={e=>setParams({...params,[p.name]:e.target.value})}>{(p.options||[]).map(o=><option key={o} value={o}>{o}</option>)}</select>
          :p.type==='textarea'?<textarea value={params[p.name]||''} onChange={e=>setParams({...params,[p.name]:e.target.value})} rows={6} style={{fontFamily:fonts.mono,fontSize:12}}/>
          :<input value={params[p.name]||''} onChange={e=>setParams({...params,[p.name]:e.target.value})} placeholder={p.placeholder||p.default||''}/>}
        </div>)}
        {progress&&<div style={{marginTop:12,padding:12,background:colors.surfaceAlt,borderRadius:8}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:6}}>
            <span style={{fontWeight:600,color:colors.accent}}>{progress.label}</span><span style={{color:colors.textDim}}>{progress.step}/{progress.total}</span></div>
          <div style={{height:6,background:colors.border,borderRadius:3,overflow:'hidden'}}>
            <div style={{height:'100%',background:progress.status==='failed'?colors.red:colors.accent,borderRadius:3,transition:'width 0.3s',width:`${(progress.step/progress.total)*100}%`}}/></div>
        </div>}
        {needApproval?<div style={{padding:14,background:colors.amberBg,border:`1px solid ${colors.amberLight}`,borderRadius:8,marginTop:16}}>
          <div style={{fontSize:13,fontWeight:600,color:colors.amber,marginBottom:6}}>⚠ Approval Required</div>
          <button onClick={()=>setApproved(true)} style={btnSuccess}>Approve & Enable</button>
        </div>:<button onClick={exec} disabled={running||!selDev} style={{...btnP,padding:'11px 24px',marginTop:16,width:'100%',opacity:running||!selDev?0.5:1}}>{running?'Executing...':'Execute Skill'}</button>}
      </Card>
      <div>
        <Card style={{marginBottom:16}}><h3 style={{fontSize:15,fontWeight:600,marginBottom:12}}>Steps</h3>
          {(skill.steps||[]).map((s,i)=><div key={i} style={{padding:'8px 12px',borderLeft:`3px solid ${colors.accentLight}`,marginBottom:8,background:colors.surfaceAlt,borderRadius:'0 8px 8px 0'}}>
            <div style={{fontSize:14,fontWeight:500}}>{i+1}. {s.label||s.name}</div></div>)}</Card>
        {result&&<Card style={{borderColor:result.status==='complete'?colors.green:colors.red,borderWidth:2}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}><h3 style={{fontSize:15,fontWeight:600}}>Result</h3><Badge status={result.status}>{result.status}</Badge></div>
          {result.error&&<div style={{padding:10,background:colors.redBg,borderRadius:8,marginBottom:12,fontSize:13,color:colors.red}}>{result.error}</div>}
          {(result.steps||[]).map((s,i)=><div key={i} style={{marginBottom:10}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13,color:s.status==='complete'?colors.green:colors.red}}>{s.status==='complete'?'✓':'✗'} {s.step_name}</span><span style={{fontSize:12,color:colors.textDim}}>{s.duration_ms}ms</span></div>
            {s.output&&<pre style={{marginTop:6,padding:10,background:colors.surfaceAlt,borderRadius:8,fontSize:12,fontFamily:fonts.mono,maxHeight:200,overflow:'auto',whiteSpace:'pre-wrap',border:`1px solid ${colors.border}`}}>{s.output}</pre>}
          </div>)}
          {result.analysis&&<div style={{marginTop:12,padding:14,background:colors.accentLight,borderRadius:8,borderLeft:`3px solid ${colors.accent}`}}>
            <div style={{fontSize:12,fontWeight:600,color:colors.accent,marginBottom:8}}>✦ AI Analysis</div>
            <div style={{fontSize:13,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{result.analysis}</div></div>}
        </Card>}
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════
// SKILL BUILDER (compact)
// ═══════════════════════════════════════════════════════════
function SkillBuilder({onCreated,initialSkill,onBack}){
  const isEdit=!!initialSkill;
  const buildInit=()=>{if(!initialSkill)return{name:'',description:'',product:'bigip',version:'1.0',author:'',tags:'',parameters:[],steps:[],safety:{requires_approval:true,max_duration:60,destructive:false,rollback_enabled:false},analysis:{enabled:false,model:'claude-sonnet-4-20250514',prompt_template:''}};
    const s=initialSkill;return{name:s.name||'',description:s.description||'',product:s.product||'bigip',version:s.version||'1.0',author:s.author||'',tags:(s.tags||[]).join(', '),
      parameters:(s.parameters||[]).map(p=>({name:p.name||'',label:p.label||'',param_type:p.type||p.param_type||'string',required:p.required!==false,default:p.default||'',description:p.description||'',placeholder:p.placeholder||'',options:p.options||[],validation_regex:p.validation_regex||''})),
      steps:(s.steps||[]).map(st=>({name:st.name||'',label:st.label||'',transport:st.transport||'ssh',command_template:st.command_template||'',timeout:st.timeout||30,rollback_command:st.rollback_command||'',description:st.description||''})),
      safety:s.safety||{requires_approval:true,max_duration:60,destructive:false,rollback_enabled:false},analysis:s.analysis||{enabled:false,model:'claude-sonnet-4-20250514',prompt_template:''}};};
  const[form,setForm]=useState(buildInit);
  const addP=()=>setForm({...form,parameters:[...form.parameters,{name:'',label:'',param_type:'string',required:true,default:'',description:'',placeholder:'',options:[],validation_regex:''}]});
  const upP=(i,f,v)=>{const u=[...form.parameters];u[i]={...u[i],[f]:v};setForm({...form,parameters:u})};const rmP=i=>setForm({...form,parameters:form.parameters.filter((_,x)=>x!==i)});
  const addS=()=>setForm({...form,steps:[...form.steps,{name:'',label:'',transport:'ssh',command_template:'',timeout:30,rollback_command:'',description:''}]});
  const upS=(i,f,v)=>{const u=[...form.steps];u[i]={...u[i],[f]:v};setForm({...form,steps:u})};const rmS=i=>setForm({...form,steps:form.steps.filter((_,x)=>x!==i)});
  const submit=async()=>{if(!form.name||!form.description)return alert('Name and description required');if(!form.steps.length)return alert('Add at least one step');
    try{await api.createSkill({...form,tags:form.tags?form.tags.split(',').map(t=>t.trim()):[]});alert(`Skill "${form.name}" ${isEdit?'updated':'created'}!`);onCreated?.()}catch(e){alert(e.message)}};
  return <div>
    {onBack&&<button onClick={onBack} style={{...btnS,fontSize:13,marginBottom:16}}>← Back</button>}
    <h2 style={{fontSize:20,fontWeight:700,marginBottom:20}}>{isEdit?`Edit: ${form.name}`:'Skill Builder'}</h2>
    <Card style={{marginBottom:16}}><h3 style={{fontSize:16,fontWeight:600,marginBottom:14}}>Metadata</h3>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div><FL label="Name" required/><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} disabled={isEdit}/></div>
        <div><FL label="Product"/><select value={form.product} onChange={e=>setForm({...form,product:e.target.value})}><option value="bigip">BIG-IP</option><option value="nginx">NGINX</option></select></div>
        <div style={{gridColumn:'1/-1'}}><FL label="Description" required/><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={2}/></div>
      </div></Card>
    <Card style={{marginBottom:16}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}><h3 style={{fontSize:16,fontWeight:600}}>Parameters</h3><button onClick={addP} style={{...btnS,fontSize:12}}>+ Add</button></div>
      {form.parameters.map((p,i)=><div key={i} style={{padding:12,border:`1px solid ${colors.border}`,borderRadius:8,marginBottom:8}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:10}}>
          <input value={p.name} onChange={e=>upP(i,'name',e.target.value)} placeholder="param_name"/>
          <input value={p.label} onChange={e=>upP(i,'label',e.target.value)} placeholder="Label"/>
          <select value={p.param_type} onChange={e=>upP(i,'param_type',e.target.value)}>{['string','textarea','integer','select'].map(t=><option key={t}>{t}</option>)}</select>
          <button onClick={()=>rmP(i)} style={{...btnS,color:colors.red,padding:'5px 10px'}}>✕</button></div>
        <input value={p.description} onChange={e=>upP(i,'description',e.target.value)} placeholder="Description" style={{marginTop:8}}/></div>)}</Card>
    <Card style={{marginBottom:16}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}><h3 style={{fontSize:16,fontWeight:600}}>Steps</h3><button onClick={addS} style={{...btnS,fontSize:12}}>+ Add</button></div>
      {form.steps.map((s,i)=><div key={i} style={{padding:12,border:`1px solid ${colors.border}`,borderRadius:8,marginBottom:8}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:10}}>
          <input value={s.name} onChange={e=>upS(i,'name',e.target.value)} placeholder="step_name"/>
          <input value={s.label} onChange={e=>upS(i,'label',e.target.value)} placeholder="Label"/>
          <select value={s.transport} onChange={e=>upS(i,'transport',e.target.value)}><option value="ssh">SSH</option><option value="icontrol_rest">REST</option><option value="icontrol_bash">Bash</option></select>
          <button onClick={()=>rmS(i)} style={{...btnS,color:colors.red,padding:'5px 10px'}}>✕</button></div>
        <textarea value={s.command_template} onChange={e=>upS(i,'command_template',e.target.value)} rows={3} style={{marginTop:8,fontFamily:fonts.mono,fontSize:12}} placeholder="tmsh show ..."/></div>)}</Card>
    <Card style={{marginBottom:16}}><h3 style={{fontSize:16,fontWeight:600,marginBottom:14}}>Safety</h3>
      <div style={{display:'flex',gap:20}}>{[['requires_approval','Requires Approval'],['destructive','Destructive'],['rollback_enabled','Rollback']].map(([k,l])=>
        <label key={k} style={{display:'flex',alignItems:'center',gap:8,fontSize:14}}><input type="checkbox" checked={form.safety[k]} onChange={e=>setForm({...form,safety:{...form.safety,[k]:e.target.checked}})}/>{l}</label>)}</div></Card>
    <Card style={{marginBottom:16}}><h3 style={{fontSize:16,fontWeight:600,marginBottom:14}}>AI Analysis</h3>
      <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><input type="checkbox" checked={form.analysis.enabled} onChange={e=>setForm({...form,analysis:{...form.analysis,enabled:e.target.checked}})}/>Enable</label>
      {form.analysis.enabled&&<textarea value={form.analysis.prompt_template} onChange={e=>setForm({...form,analysis:{...form.analysis,prompt_template:e.target.value}})} rows={6} style={{fontFamily:fonts.mono,fontSize:12}} placeholder="Analyze: {{output}}"/>}</Card>
    <button onClick={submit} style={{...btnP,padding:'12px 32px'}}>{isEdit?'Update':'Create'}</button>
  </div>;
}

// ═══════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════
function History(){
  const[items,setItems]=useState([]);const[sel,setSel]=useState(null);
  useEffect(()=>{api.executionHistory().then(setItems).catch(console.error)},[]);
  if(sel)return <div><button onClick={()=>setSel(null)} style={{...btnS,fontSize:13,marginBottom:16}}>← Back</button>
    <Card><div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}><div><h3 style={{fontSize:18,fontWeight:600}}>{sel.skill_name}</h3><div style={{fontSize:13,color:colors.textMuted}}>on {sel.device_hostname}</div></div><Badge status={sel.status}>{sel.status}</Badge></div>
      {(sel.steps||[]).map((s,i)=><div key={i} style={{marginBottom:10}}>
        <span style={{fontSize:13,color:s.status==='complete'?colors.green:colors.red}}>{s.status==='complete'?'✓':'✗'} {s.step_name} ({s.duration_ms}ms)</span>
        {s.output&&<pre style={{marginTop:4,padding:8,background:colors.surfaceAlt,borderRadius:6,fontSize:11,fontFamily:fonts.mono,maxHeight:200,overflow:'auto',whiteSpace:'pre-wrap'}}>{s.output}</pre>}</div>)}
    </Card>{sel.analysis&&<Card style={{marginTop:16}}><div style={{fontSize:12,fontWeight:600,color:colors.accent,marginBottom:8}}>✦ AI Analysis</div><div style={{fontSize:14,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{sel.analysis}</div></Card>}</div>;
  return <div><PageHeader title="Execution History"/>
    {items.length===0?<Card><div style={{textAlign:'center',padding:40,color:colors.textDim}}>No executions yet.</div></Card>
    :<div style={{display:'flex',flexDirection:'column',gap:8}}>
      {items.map(r=><Card key={r.execution_id} onClick={()=>setSel(r)} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div><div style={{fontWeight:600}}>{r.skill_name}</div><div style={{fontSize:13,color:colors.textMuted}}>on {r.device_hostname}</div></div>
        <div style={{textAlign:'right'}}><Badge status={r.status}>{r.status}</Badge><div style={{fontSize:12,color:colors.textDim,fontFamily:fonts.mono,marginTop:4}}>{r.started_at}</div></div>
      </Card>)}</div>}</div>;
}

// ═══════════════════════════════════════════════════════════
// CHAT (persistence + SSE + multi-turn optimization)
// ═══════════════════════════════════════════════════════════
function Chat(){
  const[messages,setMessages]=useState([]);const[input,setInput]=useState('');const[loading,setLoading]=useState(false);
  const[pendingSkill,setPendingSkill]=useState(null);const[pendingIdx,setPendingIdx]=useState(null);const[topoView,setTopoView]=useState(null);
  const[convId,setConvId]=useState(null);const[conversations,setConversations]=useState([]);const[showHist,setShowHist]=useState(false);
  const[streamProg,setStreamProg]=useState(null);const bottomRef=useRef(null);const{addToast}=useToast();
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[messages,loading]);
  const loadConvs=useCallback(async()=>{try{setConversations(await api.listConversations(30))}catch(e){}},[]);
  useEffect(()=>{loadConvs()},[loadConvs]);
  const loadConv=async(id)=>{try{const c=await api.getConversation(id);setConvId(id);setMessages(c.messages||[]);setShowHist(false)}catch(e){addToast('Failed to load','error')}};
  const newConv=()=>{setConvId(null);setMessages([]);setPendingSkill(null);setPendingIdx(null);setShowHist(false)};
  const delConv=async(id,e)=>{e.stopPropagation();try{await api.deleteConversation(id);if(convId===id)newConv();loadConvs()}catch(e){}};
  const persist=async(cId,msg)=>{try{return await api.addMessage(cId,msg)}catch(e){return null}};

  const buildLLM=(msgs)=>{const h=[];for(const m of msgs){h.push({role:m.role,content:m.content});
    if(m.role==='assistant'&&m.execution_result){const sr=m.skill_request||{};const er=m.execution_result;const steps=er.steps||[];
      const s=`[SKILL EXECUTION RESULT]\nSkill: ${sr.skill_name||'?'} on ${sr.device_hostname||'?'}\nStatus: ${er.status||m.status||'?'}\n\nSteps:\n${steps.map(s=>`${s.status==='complete'?'OK':'FAIL'} ${s.step_name}: ${(s.output||'').substring(0,800)}`).join('\n')}\n${er.analysis?'\nAnalysis: '+er.analysis:''}${er.error?'\nError: '+er.error:''}`;
      h.push({role:'user',content:s});h.push({role:'assistant',content:'I have the execution results above in context.'});}}return h};
  const checkApproval=useCallback(async(n)=>{try{const s=await api.getSkill(n);return s?.safety?.requires_approval!==false}catch(e){return true}},[]);

  const send=async()=>{if(!input.trim()||loading)return;const userMsg={role:'user',content:input.trim()};
    let cur=[...messages,userMsg];setMessages(cur);setInput('');setLoading(true);
    let cId=convId;if(!cId){try{const c=await api.createConversation();cId=c.id;setConvId(cId);loadConvs()}catch(e){}}
    await persist(cId,{role:'user',content:userMsg.content});
    try{let chain=5;while(chain-->0){const r=await api.chat(buildLLM(cur));const sk=r.skill_request;
      if(!sk){cur=[...cur,{role:'assistant',content:r.response}];setMessages(cur);await persist(cId,{role:'assistant',content:r.response});break}
      const na=await checkApproval(sk.skill_name);
      if(na){const m={role:'assistant',content:r.response,skill_request:sk,status:'pending'};cur=[...cur,m];setMessages(cur);
        setPendingSkill(sk);setPendingIdx(cur.length-1);await persist(cId,{role:'assistant',content:r.response,skill_request:sk,status:'pending'});break}
      const m={role:'assistant',content:r.response,skill_request:sk,status:'running'};cur=[...cur,m];setMessages(cur);
      let fr=null;try{await api.chatExecuteStream(sk,(ev)=>{
        if(ev.type==='step_start')setStreamProg({step:ev.step_index,total:ev.total_steps,label:ev.step_label});
        if(ev.type==='step_complete')setStreamProg({step:ev.step_index+1,total:ev.total_steps,label:ev.step_name});
        if(ev.type==='execution_complete')fr=ev.result;
      })}catch(e){fr={status:'failed',error:e.message}}setStreamProg(null);
      if(!fr)fr=await api.chatExecute(sk);const idx=cur.length-1;
      cur=cur.map((m,i)=>i===idx?{...m,execution_result:fr,status:fr.status||'complete'}:m);setMessages([...cur]);
      await persist(cId,{role:'assistant',content:r.response,skill_request:sk,execution_result:fr,status:fr.status});
    }}catch(e){const em={role:'assistant',content:`Error: ${e.message}`};setMessages(p=>[...p,em]);await persist(cId,em)}setLoading(false)};

  const approve=async()=>{if(!pendingSkill||loading)return;setLoading(true);
    setMessages(p=>p.map((m,i)=>i===pendingIdx?{...m,status:'running'}:m));
    let fr=null;try{await api.chatExecuteStream(pendingSkill,(ev)=>{
      if(ev.type==='step_start')setStreamProg({step:ev.step_index,total:ev.total_steps,label:ev.step_label});
      if(ev.type==='step_complete'){setStreamProg({step:ev.step_index+1,total:ev.total_steps,label:ev.step_name});
        if(ev.status==='complete')addToast(`Done: ${ev.step_name}`,'success',2000)}
      if(ev.type==='execution_complete')fr=ev.result;
    })}catch(e){fr={status:'failed',error:e.message}}setStreamProg(null);
    if(!fr)try{fr=await api.chatExecute(pendingSkill)}catch(e){fr={status:'failed',error:e.message}}
    setMessages(p=>p.map((m,i)=>i===pendingIdx?{...m,execution_result:fr,status:fr.status||'complete'}:m));
    try{const up=messages.map((m,i)=>i===pendingIdx?{...m,execution_result:fr,status:fr.status,skill_request:pendingSkill}:m);
      const fu=buildLLM(up);fu.push({role:'user',content:'Analyze the results and provide assessment.'});
      const a=await api.chat(fu);setMessages(p=>[...p,{role:'assistant',content:a.response}]);
      if(convId)await persist(convId,{role:'assistant',content:a.response})}catch(e){}
    setPendingSkill(null);setPendingIdx(null);setLoading(false);addToast(`Skill ${fr?.status}`,fr?.status==='complete'?'success':'error')};
  const reject=()=>{setMessages(p=>p.map((m,i)=>i===pendingIdx?{...m,status:'rejected'}:m));setPendingSkill(null);setPendingIdx(null)};

  const renderCard=(msg)=>{const sr=msg.skill_request;if(!sr)return null;
    const bc={pending:colors.amber,running:colors.accent,complete:colors.green,failed:colors.red,rejected:colors.textDim}[msg.status]||colors.border;
    return <div style={{margin:'12px 0',padding:16,background:colors.surfaceAlt,border:`1px solid ${colors.border}`,borderRadius:12,borderLeft:`4px solid ${bc}`}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{width:32,height:32,borderRadius:8,background:colors.accentLight,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>&#x1f527;</span>
          <div><div style={{fontWeight:600,fontSize:14}}>{sr.skill_name}</div><div style={{fontSize:12,color:colors.textDim}}>&#x2192; {sr.device_hostname}</div></div></div>
        {msg.status&&<Badge status={msg.status}>{msg.status}</Badge>}</div>
      {sr.explanation&&<p style={{fontSize:13,color:colors.textMuted,marginBottom:10}}>{sr.explanation}</p>}
      <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:msg.status==='pending'?12:0}}>
        {Object.entries(sr.parameters||{}).map(([k,v])=><span key={k} style={{padding:'3px 10px',background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:6,fontFamily:fonts.mono,fontSize:12}}><span style={{color:colors.textDim}}>{k}:</span> <span style={{color:colors.accent}}>{String(v).substring(0,60)}</span></span>)}</div>
      {msg.status==='running'&&streamProg&&<div style={{marginTop:8,padding:8,background:colors.surface,borderRadius:6}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{fontWeight:600,color:colors.accent}}>{streamProg.label}</span><span style={{color:colors.textDim}}>{streamProg.step}/{streamProg.total}</span></div>
        <div style={{height:4,background:colors.border,borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',background:colors.accent,borderRadius:2,transition:'width 0.3s',width:`${(streamProg.step/streamProg.total)*100}%`}}/></div></div>}
      {msg.status==='pending'&&<div style={{display:'flex',gap:8}}><button onClick={approve} disabled={loading} style={{...btnSuccess,padding:'9px 24px',opacity:loading?0.5:1}}>{loading?'Running...':'Approve'}</button>
        <button onClick={reject} style={{...btnS,padding:'9px 18px',color:colors.red}}>Reject</button></div>}
      {msg.execution_result?.steps&&<div style={{marginTop:12}}>{msg.execution_result.steps.map((s,i)=><div key={i} style={{padding:'6px 0',borderTop:i?`1px solid ${colors.border}`:'none'}}>
        <div style={{fontSize:12,fontWeight:500,color:s.status==='complete'?colors.green:colors.red}}>{s.status==='complete'?'OK':'FAIL'} {s.step_name} ({s.duration_ms}ms)</div>
        {s.output&&<pre style={{marginTop:4,padding:8,background:colors.surface,borderRadius:6,fontSize:11,fontFamily:fonts.mono,maxHeight:120,overflow:'auto',whiteSpace:'pre-wrap'}}>{s.output.substring(0,1000)}</pre>}</div>)}</div>}
      {msg.execution_result?.error&&<div style={{padding:8,background:colors.redBg,borderRadius:6,marginTop:8,fontSize:12,color:colors.red}}>{msg.execution_result.error}</div>}
    </div>};

  return <div style={{display:'flex',height:'calc(100vh - 48px)'}}>
    <div style={{width:showHist?260:0,overflow:'hidden',transition:'width 0.2s',borderRight:showHist?`1px solid ${colors.border}`:'none',background:colors.surfaceAlt,flexShrink:0}}>
      {showHist&&<div style={{padding:12,height:'100%',display:'flex',flexDirection:'column'}}>
        <button onClick={newConv} style={{...btnP,fontSize:13,marginBottom:12,width:'100%'}}>+ New Chat</button>
        <div style={{flex:1,overflow:'auto'}}>{conversations.map(c=><div key={c.id} onClick={()=>loadConv(c.id)}
          style={{padding:'10px 12px',borderRadius:8,marginBottom:4,cursor:'pointer',display:'flex',justifyContent:'space-between',
            background:convId===c.id?colors.accentLight:'transparent',border:convId===c.id?`1px solid ${colors.accent}`:'1px solid transparent'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:convId===c.id?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.title}</div>
            <div style={{fontSize:11,color:colors.textDim}}>{c.message_count||0} msgs</div></div>
          <button onClick={e=>delConv(c.id,e)} style={{background:'none',border:'none',color:colors.textDim,padding:4,opacity:0.5}}>x</button>
        </div>)}</div></div>}
    </div>
    <div style={{flex:1,display:'flex',flexDirection:'column'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',marginBottom:4}}>
        <button onClick={()=>setShowHist(!showHist)} style={{...btnS,padding:'6px 10px',fontSize:12}} title="History">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
        <span style={{fontSize:13,color:colors.textDim,flex:1}}>{convId?conversations.find(c=>c.id===convId)?.title||'Chat':'New Conversation'}</span>
        {convId&&<button onClick={newConv} style={{...btnS,fontSize:12,padding:'5px 12px'}}>+ New</button>}</div>
      <div style={{flex:1,overflow:'auto',display:'flex',flexDirection:'column',gap:12,paddingBottom:12}}>
        {messages.length===0&&<div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{textAlign:'center',maxWidth:480}}>
            <div style={{width:64,height:64,borderRadius:16,background:colors.accentLight,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',fontSize:28}}>&#x2726;</div>
            <h3 style={{fontSize:18,fontWeight:600,marginBottom:6}}>AI Assistant</h3>
            <p style={{fontSize:14,color:colors.textMuted,marginBottom:20}}>Ask about your BIG-IP configuration or request insights.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {['Check pool status','Show VS config for luke','Run tcpdump on 443','Disable a pool member','Show ARP table','Create UCS backup'].map((ex,i)=>
                <button key={i} onClick={()=>setInput(ex)} style={{padding:'10px 14px',background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:10,color:colors.text,fontSize:13,textAlign:'left',cursor:'pointer'}}>{ex}</button>)}</div>
          </div></div>}
        {messages.map((m,i)=><div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',paddingRight:m.role==='user'?0:60,paddingLeft:m.role==='user'?60:0}}>
          <div style={{display:'flex',gap:10,maxWidth:'100%',alignItems:'flex-start'}}>
            {m.role==='assistant'&&<div style={{width:32,height:32,borderRadius:10,background:colors.accentLight,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0,color:colors.accent,fontWeight:700}}>&#x2726;</div>}
            <div style={{padding:'12px 16px',borderRadius:14,background:m.role==='user'?colors.chatBubbleUser:colors.chatBubbleAssistant,
              border:m.role==='user'?'none':`1px solid ${colors.border}`,color:m.role==='user'?'#fff':colors.text,fontSize:14,lineHeight:1.6,
              borderTopRightRadius:m.role==='user'?4:14,borderTopLeftRadius:m.role==='user'?14:4}}>
              <div style={{whiteSpace:'pre-wrap'}}>{m.content}</div>{m.skill_request&&renderCard(m)}</div></div></div>)}
        {loading&&!pendingSkill&&<div style={{display:'flex',gap:10,paddingRight:60}}>
          <div style={{width:32,height:32,borderRadius:10,background:colors.accentLight,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:colors.accent,animation:'pulse 1.2s infinite'}}/></div>
          <div style={{padding:'12px 16px',background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:14,borderTopLeftRadius:4,color:colors.textDim}}>Thinking...</div></div>}
        <div ref={bottomRef}/></div>
      {topoView&&<div style={{padding:'0 0 12px',flexShrink:0}}><TrafficFlowVisualizer deviceHostname={topoView.device} virtualServerName={topoView.vs} onClose={()=>setTopoView(null)} embedded/></div>}
      <div style={{background:colors.surface,borderRadius:14,border:`1px solid ${colors.border}`,padding:6,display:'flex',gap:6}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}
          placeholder="Ask about your BIG-IP..." style={{flex:1,border:'none',background:'transparent',padding:'10px 14px',fontSize:14,outline:'none'}} disabled={loading}/>
        <button onClick={send} disabled={loading||!input.trim()} style={{...btnP,borderRadius:10,padding:'10px 20px',opacity:loading||!input.trim()?0.4:1}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>
    </div></div>;
}

// ═══════════════════════════════════════════════════════════
// IMAGE MANAGER
// ═══════════════════════════════════════════════════════════
function ImageManager(){
  const[staged,setStaged]=useState([]);const[devices,setDevices]=useState([]);const[uploading,setUploading]=useState(false);
  const[pushing,setPushing]=useState(null);const[pushTarget,setPushTarget]=useState('');const[pushResult,setPushResult]=useState(null);
  const[devImgs,setDevImgs]=useState(null);const fileRef=useRef(null);const{addToast}=useToast();
  const load=useCallback(async()=>{try{const[s,d]=await Promise.all([api.listStagedImages(),api.listDevices()]);setStaged(s);setDevices(d);if(d.length>0&&!pushTarget)setPushTarget(d[0].hostname)}catch(e){}},[]);
  useEffect(()=>{load()},[load]);
  const upload=async(e)=>{const f=e.target.files?.[0];if(!f||!f.name.endsWith('.iso'))return;setUploading(true);try{await api.uploadImage(f);load();addToast('Upload complete','success')}catch(e){alert(e.message)}setUploading(false);if(fileRef.current)fileRef.current.value=''};
  const push=async(fn)=>{if(!pushTarget)return;setPushing(fn);setPushResult(null);try{const r=await api.pushImage(fn,pushTarget);setPushResult({ok:true,...r});addToast('Pushed','success')}catch(e){setPushResult({ok:false,error:e.message})}setPushing(null)};
  const checkDev=async(h)=>{try{setDevImgs(await api.deviceImages(h))}catch(e){setDevImgs({error:e.message})}};
  const bigs=devices.filter(d=>d.device_type==='bigip');
  return <div><PageHeader title="Software Images" subtitle="Upload, stage, and push BIG-IP ISO images."/>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
      <Card><h3 style={{fontSize:16,fontWeight:600,marginBottom:16}}>Upload ISO</h3>
        <input ref={fileRef} type="file" accept=".iso" onChange={upload} disabled={uploading} style={{marginBottom:12}}/>
        <h4 style={{fontSize:14,fontWeight:600,marginTop:20,marginBottom:10}}>Staged</h4>
        {staged.length===0?<div style={{color:colors.textDim,fontSize:13}}>None</div>
        :staged.map(img=><div key={img.filename} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${colors.border}`}}>
          <div><div style={{fontWeight:500,fontSize:13}}>{img.filename}</div><div style={{fontSize:11,color:colors.textDim}}>{img.size_mb?.toFixed(0)} MB</div></div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>push(img.filename)} disabled={pushing===img.filename} style={{...btnP,fontSize:12,padding:'5px 12px'}}>{pushing===img.filename?'...':'Push'}</button>
            <button onClick={async()=>{await api.deleteStagedImage(img.filename);load()}} style={{...btnS,fontSize:12,padding:'5px 8px',color:colors.red}}>x</button></div></div>)}
        {pushResult&&<div style={{marginTop:12,padding:10,borderRadius:8,fontSize:13,background:pushResult.ok?colors.greenBg:colors.redBg,color:pushResult.ok?colors.green:colors.red}}>{pushResult.ok?'Pushed!':pushResult.error}</div>}
      </Card>
      <Card><h3 style={{fontSize:16,fontWeight:600,marginBottom:16}}>Target</h3>
        <select value={pushTarget} onChange={e=>setPushTarget(e.target.value)} style={{marginBottom:12}}>
          {bigs.map(d=><option key={d.hostname} value={d.hostname}>{d.hostname}</option>)}</select>
        {pushTarget&&<button onClick={()=>checkDev(pushTarget)} style={{...btnS,fontSize:13,marginBottom:12}}>Check Images</button>}
        {devImgs&&(devImgs.error?<div style={{color:colors.red,fontSize:13}}>{devImgs.error}</div>
          :<div>{(devImgs.images||[]).map((img,i)=><div key={i} style={{padding:'8px 0',borderBottom:`1px solid ${colors.border}`,fontSize:13}}><div style={{fontWeight:500}}>{img.product}</div><div style={{fontSize:11,color:colors.textDim}}>{img.version}</div></div>)}</div>)}
      </Card></div></div>;
}

// ═══════════════════════════════════════════════════════════
// TOPOLOGY
// ═══════════════════════════════════════════════════════════
function TopologyPage(){
  const[devices,setDevices]=useState([]);const[selDev,setSelDev]=useState('');const[vsList,setVsList]=useState([]);
  const[selVS,setSelVS]=useState('');const[loadVS,setLoadVS]=useState(false);
  useEffect(()=>{api.listDevices().then(d=>{setDevices(d);const b=d.filter(x=>x.device_type==='bigip');if(b.length>0)setSelDev(b[0].hostname)}).catch(console.error)},[]);
  useEffect(()=>{if(!selDev)return;setLoadVS(true);setVsList([]);setSelVS('');api.listVirtualServers(selDev).then(setVsList).catch(console.error).finally(()=>setLoadVS(false))},[selDev]);
  const bigs=devices.filter(d=>d.device_type==='bigip');
  return <div><PageHeader title="Traffic Flow Topology"/>
    <Card style={{marginBottom:20}}><div style={{display:'flex',gap:16,alignItems:'end'}}>
      <div style={{flex:1}}><FL label="Device"/><select value={selDev} onChange={e=>setSelDev(e.target.value)}>
        {bigs.map(d=><option key={d.hostname} value={d.hostname}>{d.hostname} ({d.mgmt_ip})</option>)}</select></div>
      <div style={{flex:1}}><FL label="Virtual Server"/>
        <select value={selVS} onChange={e=>setSelVS(e.target.value)} disabled={loadVS||!vsList.length}>
          <option value="">{loadVS?'Loading...':'Select VS...'}</option>
          {vsList.map(v=><option key={v.name} value={v.name}>{v.name} ({v.destination})</option>)}</select></div></div></Card>
    {selDev&&selVS&&<TrafficFlowVisualizer deviceHostname={selDev} virtualServerName={selVS} onClose={()=>setSelVS('')}/>}
    {!selVS&&vsList.length>0&&<Card><div style={{textAlign:'center',padding:20,color:colors.textDim}}>Select a virtual server to visualize. {vsList.length} found.</div></Card>}
  </div>;
}

// ═══════════════════════════════════════════════════════════
// INTEGRATIONS (Webhooks + MCP Client)
// ═══════════════════════════════════════════════════════════
function Integrations(){
  const[tab,setTab]=useState('webhooks');
  return <div><PageHeader title="Integrations" subtitle="Webhooks, MCP clients, and external tools."/>
    <div style={{display:'flex',gap:4,marginBottom:20}}>
      {[['webhooks','Webhooks'],['mcp','MCP Clients']].map(([id,l])=>
        <button key={id} onClick={()=>setTab(id)} style={{...tab===id?btnP:btnS,fontSize:13,padding:'8px 20px'}}>{l}</button>)}</div>
    {tab==='webhooks'?<WebhooksPanel/>:<McpClientsPanel/>}</div>;
}

function WebhooksPanel(){
  const[ints,setInts]=useState([]);const[showForm,setShowForm]=useState(false);const[editId,setEditId]=useState(null);const[logs,setLogs]=useState(null);const[logsFor,setLogsFor]=useState(null);
  const[form,setForm]=useState({name:'',type:'incoming_webhook',callback_url:'',url:'',events:'skill_complete,skill_failed',payload_mapping:''});
  const{addToast}=useToast();
  const load=useCallback(()=>{api.listIntegrations().then(setInts).catch(console.error)},[]);
  useEffect(()=>{load()},[load]);
  const resetForm=()=>{setForm({name:'',type:'incoming_webhook',callback_url:'',url:'',events:'skill_complete,skill_failed',payload_mapping:''});setEditId(null);setShowForm(false)};
  const startEdit=(int)=>{
    const c=int.config||{};
    setForm({name:int.name,type:int.type,callback_url:c.callback_url||'',url:c.url||'',
      events:(c.events||[]).join(','),payload_mapping:c.payload_mapping?JSON.stringify(c.payload_mapping,null,2):''});
    setEditId(int.id);setShowForm(true)};
  const submit=async()=>{if(!form.name)return alert('Name required');const config={};
    if(form.type==='incoming_webhook'||form.type==='bidirectional_webhook'){config.callback_url=form.callback_url;if(form.payload_mapping){try{config.payload_mapping=JSON.parse(form.payload_mapping)}catch(e){return alert('Invalid JSON')}}}
    if(form.type.includes('outgoing')||form.type==='bidirectional_webhook'){config.url=form.url;config.events=form.events.split(',').map(e=>e.trim())}
    try{
      if(editId){await api.updateIntegration(editId,{name:form.name,config});addToast('Updated','success')}
      else{await api.createIntegration({name:form.name,type:form.type,config});addToast('Created','success')}
      resetForm();load()}catch(e){alert(e.message)}};
  const toggle=async(int)=>{try{await api.updateIntegration(int.id,{enabled:!int.enabled});load()}catch(e){}};
  const viewLogs=async(id)=>{try{setLogs(await api.integrationLogs(id));setLogsFor(id)}catch(e){}};
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}>
      <div style={{fontSize:15,fontWeight:600}}>Webhook Integrations</div>
      <button onClick={()=>{if(showForm){resetForm()}else{setShowForm(true)}}} style={{...btnP,fontSize:12}}>{showForm?'Cancel':'+ Add'}</button></div>
    {showForm&&<Card style={{marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:600,marginBottom:10,color:editId?colors.accent:colors.text}}>{editId?'Edit Integration':'New Integration'}</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div><FL label="Name" required/><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="ServiceNow"/></div>
        <div><FL label="Type"/><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} disabled={!!editId}>
          <option value="incoming_webhook">Incoming</option><option value="outgoing_webhook">Outgoing</option><option value="bidirectional_webhook">Bidirectional</option></select></div>
        {(form.type==='incoming_webhook'||form.type==='bidirectional_webhook')&&<><div><FL label="Callback URL"/><input value={form.callback_url} onChange={e=>setForm({...form,callback_url:e.target.value})} placeholder="https://..."/></div>
          <div style={{gridColumn:'1/-1'}}><FL label="Payload Mapping (JSON)"/><textarea value={form.payload_mapping} onChange={e=>setForm({...form,payload_mapping:e.target.value})} rows={3} style={{fontFamily:fonts.mono,fontSize:12}} placeholder='{"title":"$.issue.summary","description":"$.issue.description","device":"$.issue.configuration_item"}'/></div></>}
        {(form.type.includes('outgoing')||form.type==='bidirectional_webhook')&&<><div><FL label="URL" required/><input value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/></div>
          <div><FL label="Events"/><input value={form.events} onChange={e=>setForm({...form,events:e.target.value})}/></div></>}</div>
      <div style={{marginTop:12,display:'flex',gap:8}}><button onClick={submit} style={btnSuccess}>{editId?'Save Changes':'Create'}</button><button onClick={resetForm} style={btnS}>Cancel</button></div></Card>}
    {ints.length===0?<Card><div style={{textAlign:'center',padding:30,color:colors.textDim}}>No integrations.</div></Card>
    :ints.map(int=><Card key={int.id} style={{marginBottom:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div><div style={{fontWeight:600,fontSize:15,display:'flex',alignItems:'center',gap:8}}>{int.name} <Badge status={int.enabled?'complete':'rejected'}>{int.enabled?'Active':'Off'}</Badge>
          <span style={{fontSize:11,color:colors.textDim,fontFamily:fonts.mono}}>{int.type}</span></div>
          {int.config?.webhook_token&&<div style={{fontSize:11,color:colors.textDim,fontFamily:fonts.mono,marginTop:4}}>POST /api/integrations/webhook/{int.config.webhook_token}</div>}
          {int.config?.callback_url&&<div style={{fontSize:11,color:colors.textDim,fontFamily:fonts.mono,marginTop:2}}>↩ {int.config.callback_url}</div>}
          {int.config?.url&&<div style={{fontSize:11,color:colors.textDim,fontFamily:fonts.mono,marginTop:2}}>→ {int.config.url}</div>}</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>startEdit(int)} style={{...btnS,fontSize:12,padding:'5px 12px'}}>Edit</button>
          <button onClick={()=>viewLogs(int.id)} style={{...btnS,fontSize:12,padding:'5px 12px'}}>Logs</button>
          <button onClick={()=>toggle(int)} style={{...btnS,fontSize:12,padding:'5px 12px'}}>{int.enabled?'Disable':'Enable'}</button>
          <button onClick={async()=>{if(window.confirm('Delete?')){await api.deleteIntegration(int.id);load()}}} style={{...btnS,fontSize:12,padding:'5px 12px',color:colors.red}}>Del</button></div></div>
    </Card>)}
    {logsFor&&logs&&<Card style={{marginTop:16}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
      <h3 style={{fontSize:15,fontWeight:600}}>Logs</h3><button onClick={()=>{setLogs(null);setLogsFor(null)}} style={{...btnS,fontSize:12}}>Close</button></div>
      {logs.length===0?<div style={{color:colors.textDim,fontSize:13}}>No logs.</div>:logs.map(l=><div key={l.id} style={{padding:'8px 0',borderBottom:`1px solid ${colors.border}`,fontSize:12}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontWeight:500}}>{l.direction} {l.status}</span><span style={{color:colors.textDim,fontFamily:fonts.mono}}>{l.created_at}</span></div>
        {l.payload&&<pre style={{marginTop:4,padding:6,background:colors.surfaceAlt,borderRadius:6,fontSize:11,fontFamily:fonts.mono,maxHeight:80,overflow:'auto',whiteSpace:'pre-wrap'}}>{l.payload.substring(0,500)}</pre>}</div>)}</Card>}
  </div>;
}

function McpClientsPanel(){
  const[conns,setConns]=useState([]);const[showForm,setShowForm]=useState(false);
  const[form,setForm]=useState({name:'',url:'',transport:'streamable-http'});const[disc,setDisc]=useState(null);const{addToast}=useToast();
  const load=useCallback(()=>{api.listMcpClients().then(setConns).catch(console.error)},[]);
  useEffect(()=>{load()},[load]);
  const submit=async()=>{if(!form.name||!form.url)return alert('Name and URL required');try{await api.addMcpClient(form);addToast('Added','success');setShowForm(false);load()}catch(e){alert(e.message)}};
  const discover=async(id)=>{setDisc(id);try{const r=await api.discoverMcpTools(id);addToast(`Found ${r.tool_count} tools`,'success');load()}catch(e){addToast(`Failed: ${e.message}`,'error')}setDisc(null)};
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}>
      <div style={{fontSize:15,fontWeight:600}}>External MCP Servers</div>
      <button onClick={()=>setShowForm(!showForm)} style={{...btnP,fontSize:12}}>+ Add</button></div>
    {showForm&&<Card style={{marginBottom:16}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>
        <div><FL label="Name" required/><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="ServiceNow MCP"/></div>
        <div><FL label="URL" required/><input value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="http://localhost:8200/mcp"/></div>
        <div><FL label="Transport"/><select value={form.transport} onChange={e=>setForm({...form,transport:e.target.value})}><option value="streamable-http">HTTP</option><option value="sse">SSE</option></select></div></div>
      <div style={{marginTop:12,display:'flex',gap:8}}><button onClick={submit} style={btnSuccess}>Add</button><button onClick={()=>setShowForm(false)} style={btnS}>Cancel</button></div></Card>}
    {conns.length===0?<Card><div style={{textAlign:'center',padding:30,color:colors.textDim}}>No MCP connections.</div></Card>
    :conns.map(c=><Card key={c.id} style={{marginBottom:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}>
        <div><div style={{fontWeight:600,fontSize:15,display:'flex',alignItems:'center',gap:8}}>{c.name} <Badge status={c.status}>{c.status}</Badge></div>
          <div style={{fontSize:12,color:colors.textDim,fontFamily:fonts.mono,marginTop:4}}>{c.url}</div>
          {c.tools?.length>0&&<div style={{marginTop:8,display:'flex',gap:6,flexWrap:'wrap'}}>
            {c.tools.map((t,i)=><span key={i} style={{padding:'2px 8px',background:colors.accentLight,borderRadius:6,fontSize:11,color:colors.accent}}>{t.name}</span>)}</div>}</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>discover(c.id)} disabled={disc===c.id} style={{...btnP,fontSize:12,padding:'5px 12px'}}>{disc===c.id?'...':'Discover'}</button>
          <button onClick={async()=>{if(window.confirm('Delete?')){await api.deleteMcpClient(c.id);load()}}} style={{...btnS,fontSize:12,padding:'5px 12px',color:colors.red}}>Del</button></div></div>
    </Card>)}</div>;
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════
const NAV = [
  {id:'chat',label:'AI Assistant',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>},
  {id:'devices',label:'Devices',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/></svg>},
  {id:'images',label:'Images',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>},
  {id:'topology',label:'Topology',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>},
  {id:'skills',label:'Skills',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>},
  {id:'builder',label:'Builder',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18m-7-7h14"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>},
  {id:'automation',label:'Automation',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>},
  {id:'visual',label:'Visual Editor',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><line x1="10" y1="6.5" x2="14" y2="6.5"/><line x1="6.5" y1="10" x2="6.5" y2="14"/></svg>},
  {id:'integrations',label:'Integrations',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>},
  {id:'history',label:'History',icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>},
];

export default function App(){
  const[view,setView]=useState('chat');const[runSkill,setRunSkill]=useState(null);const[editSkill,setEditSkill]=useState(null);const[health,setHealth]=useState(null);
  useEffect(()=>{api.health().then(setHealth).catch(()=>setHealth({status:'error',vault:'unavailable'}))},[]);
  const content=()=>{
    if(editSkill)return <SkillBuilder initialSkill={editSkill} onCreated={()=>{setEditSkill(null);setView('skills')}} onBack={()=>setEditSkill(null)}/>;
    if(runSkill)return <SkillRunner skillName={runSkill} onBack={()=>setRunSkill(null)} onEdit={async(name)=>{const s=await api.getSkill(name);setRunSkill(null);setEditSkill(s)}}/>;
    switch(view){
      case 'chat': return <Chat/>;case 'devices': return <DeviceManager/>;case 'images': return <ImageManager/>;
      case 'topology': return <TopologyPage/>;case 'skills': return <SkillInventory onRun={setRunSkill} onView={setRunSkill}/>;
      case 'builder': return <SkillBuilder onCreated={()=>setView('skills')}/>;case 'automation': return <AutomationTab/>;case 'visual': return <VisualWorkflowEditor/>;case 'integrations': return <Integrations/>;
      case 'history': return <History/>;default: return <Chat/>;}};

  return <ToastProvider><div style={{display:'flex',height:'100vh',background:colors.bg}}>
    <style>{globalStyles}{`
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      @keyframes slideIn { from{transform:translateX(100px);opacity:0} to{transform:translateX(0);opacity:1} }
    `}</style>
    <div style={{width:240,background:colors.sidebar,display:'flex',flexDirection:'column',flexShrink:0}}>
      <div style={{padding:'20px 20px 16px'}}><div style={{display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg, #3b82f6, #1d4ed8)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg></div>
        <div><div style={{fontSize:16,fontWeight:700,color:'#fff'}}>F5 Insight</div><div style={{fontSize:11,color:colors.sidebarText,opacity:0.6}}>Skills Agent</div></div></div></div>
      <nav style={{padding:'4px 10px',flex:1}}>{NAV.map(n=>{const a=view===n.id&&!runSkill&&!editSkill;
        return <button key={n.id} onClick={()=>{setView(n.id);setRunSkill(null);setEditSkill(null)}} style={{
          display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 14px',marginBottom:2,borderRadius:8,
          background:a?colors.sidebarActive:'transparent',color:a?colors.sidebarTextActive:colors.sidebarText,border:'none',
          textAlign:'left',fontSize:14,fontWeight:a?600:400,transition:'all 0.15s'}}
          onMouseEnter={e=>{if(!a)e.currentTarget.style.background=colors.sidebarHover}}
          onMouseLeave={e=>{if(!a)e.currentTarget.style.background='transparent'}}>{n.icon}{n.label}</button>})}</nav>
      <div style={{padding:'14px 16px',borderTop:'1px solid rgba(255,255,255,0.1)',fontSize:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,color:health?.vault==='connected'?'#4ade80':'#f87171'}}>
          <span style={{width:8,height:8,borderRadius:'50%',background:'currentColor'}}/><span style={{color:colors.sidebarText}}>Vault: {health?.vault||'...'}</span></div>
        <div style={{display:'flex',alignItems:'center',gap:8,color:health?.llm_configured?'#4ade80':'#fbbf24'}}>
          <span style={{width:8,height:8,borderRadius:'50%',background:'currentColor'}}/><span style={{color:colors.sidebarText}}>LLM: {health?.llm_provider||'...'}</span></div>
        {health?.llm_model&&<div style={{color:'rgba(255,255,255,0.35)',marginTop:4,marginLeft:16,fontSize:11}}>{health.llm_model}</div>}
      </div></div>
    <div style={{flex:1,overflow:'auto',padding:28}}>{content()}</div>
  </div></ToastProvider>;
}
