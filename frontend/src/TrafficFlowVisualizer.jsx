import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api';

// ═══════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════
const t = {
  bg: '#0a0e1a', surface: '#111827', surfaceLight: '#1a2236',
  border: '#1e293b', borderLight: '#334155',
  accent: '#3b82f6', accentGlow: 'rgba(59,130,246,0.15)',
  text: '#e2e8f0', textDim: '#94a3b8', textMuted: '#64748b',
  packet: '#fbbf24', packetGlow: 'rgba(251,191,36,0.4)',
  irule: '#a78bfa', iruleGlow: 'rgba(167,139,250,0.2)',
  green: '#059669', red: '#dc2626', purple: '#9333ea', gray: '#6b7280',
  orange: '#ea580c',
};
const mono = "'JetBrains Mono','SF Mono','Fira Code',monospace";
const sans = "'Inter',-apple-system,system-ui,sans-serif";

const ST = {
  available: { bg: t.green, label: 'Available' },
  offline: { bg: t.red, label: 'Offline' },
  'forced-offline': { bg: t.purple, label: 'Forced Offline' },
  unknown: { bg: t.gray, label: 'Unknown' },
};

const LB_INFO = {
  'round-robin': 'Evenly distributes in sequence',
  'least-connections-member': 'Fewest active connections',
  'least-connections-node': 'Fewest connections per node',
  'ratio-member': 'Weighted by member ratio',
  'ratio-node': 'Weighted by node ratio',
  'fastest-app-response': 'Fastest response time',
  'observed-member': 'Connection + response hybrid',
  'predictive-member': 'Historical trend analysis',
};

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function TrafficFlowVisualizer({ deviceHostname, virtualServerName, onClose, embedded = false }) {
  const [topology, setTopology] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [packetProgress, setPacketProgress] = useState(-1);
  const [currentStage, setCurrentStage] = useState(null);
  const [targetNode, setTargetNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showIRule, setShowIRule] = useState(null);
  const [activeCondition, setActiveCondition] = useState(null); // {iruleIdx, condIdx, branch:'true'|'false'}
  const [packetLabels, setPacketLabels] = useState([]); // header modifications shown on packet
  const [packetLog, setPacketLog] = useState([]);
  const [expanded, setExpanded] = useState(!embedded);
  const animRef = useRef(null);
  const startTimeRef = useRef(null);
  const rrIndexRef = useRef(0);

  // ── Load ──────────────────────────────────────────────
  useEffect(() => {
    if (!deviceHostname || !virtualServerName) return;
    setLoading(true); setError(null);
    api.getTopology(deviceHostname, virtualServerName)
      .then(data => { setTopology(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [deviceHostname, virtualServerName]);

  const vs = topology?.virtualServer || {};
  const pool = topology?.pool || { members: [] };
  const irules = topology?.irules || [];
  const healthyMembers = (pool.members || []).filter(m => m.status === 'available');
  const otherAttachments = topology?.otherAttachments || {};

  // ── LB Selection ─────────────────────────────────────
  const selectTarget = useCallback(() => {
    const allMembers = pool.members || [];
    if (allMembers.length === 0) return null;

    // If healthy members exist, use LB method
    if (healthyMembers.length > 0) {
      const method = (pool.lbMethod || 'round-robin').toLowerCase();
      if (method.includes('least-connection'))
        return [...healthyMembers].sort((a, b) => a.connections - b.connections)[0];
      if (method.includes('ratio')) {
        const w = []; healthyMembers.forEach(m => { for (let i = 0; i < (m.ratio || 1); i++) w.push(m); });
        return w[Math.floor(Math.random() * w.length)];
      }
      if (method.includes('fastest')) {
        const wr = healthyMembers.filter(m => m.responseTime != null);
        return wr.length ? [...wr].sort((a, b) => a.responseTime - b.responseTime)[0] : healthyMembers[0];
      }
      const tgt = healthyMembers[rrIndexRef.current % healthyMembers.length];
      rrIndexRef.current++;
      return tgt;
    }

    // All members down — pick first offline member to show the failed path
    return allMembers[0];
  }, [healthyMembers, pool.members, pool.lbMethod]);

  // ── Determine if iRule overrides pool ────────────────
  const getIRulePoolOverride = useCallback(() => {
    for (const ir of irules) {
      for (const ev of (ir.events || [])) {
        if (ev.canSelectPool) {
          for (const cond of (ev.conditions || [])) {
            if (cond.trueBranch?.action === 'pool_select' && cond.trueBranch?.targetPool) {
              // 50% chance to take the true branch for demo
              if (Math.random() > 0.5) return { pool: cond.trueBranch.targetPool, condition: cond, irule: ir.name, branch: 'true' };
            }
          }
        }
      }
    }
    return null;
  }, [irules]);

  // ── Animation stages ─────────────────────────────────
  const DURATION = 4500;

  const buildStages = useCallback(() => {
    const stages = [{ name: 'client', start: 0, end: 0.12 }];
    const totalIruleEvents = irules.reduce((sum, ir) => sum + (ir.events?.length || 1), 0);
    const iruleTimeEach = Math.min(0.12, 0.4 / Math.max(totalIruleEvents, 1));
    let idx = 0;
    irules.forEach((ir, irIdx) => {
      const eventCount = ir.events?.length || 1;
      for (let e = 0; e < eventCount; e++) {
        const prev = stages[stages.length - 1].end;
        stages.push({ name: `irule_${irIdx}_${e}`, start: prev, end: prev + iruleTimeEach, iruleIdx: irIdx, eventIdx: e });
        idx++;
      }
    });
    const prev1 = stages[stages.length - 1].end;
    stages.push({ name: 'lb', start: prev1, end: Math.min(prev1 + 0.15, 0.7) });
    const prev2 = stages[stages.length - 1].end;
    stages.push({ name: 'node', start: prev2, end: 1.0 });
    return stages;
  }, [irules]);

  // ── Play ─────────────────────────────────────────────
  const playPacket = useCallback(() => {
    const target = selectTarget();
    if (!target) return;

    const allDown = healthyMembers.length === 0;

    // Check for iRule pool override
    const override = getIRulePoolOverride();

    setTargetNode(target);
    setPlaying(true);
    setCurrentStage('client');
    setActiveCondition(null);
    setPacketLabels([]);
    startTimeRef.current = Date.now();

    const stages = buildStages();

    const animate = () => {
      const p = Math.min((Date.now() - startTimeRef.current) / DURATION, 1);
      setPacketProgress(p);

      for (const s of stages) {
        if (p >= s.start && p < s.end) {
          setCurrentStage(s.name);
          if (s.name.startsWith('irule_') && s.iruleIdx !== undefined) {
            const ir = irules[s.iruleIdx];
            const ev = ir?.events?.[s.eventIdx];
            if (ev?.conditions?.length > 0) {
              const stageProgress = (p - s.start) / (s.end - s.start);
              const condIdx = Math.floor(stageProgress * ev.conditions.length);
              const cond = ev.conditions[Math.min(condIdx, ev.conditions.length - 1)];
              setActiveCondition({ iruleIdx: s.iruleIdx, eventIdx: s.eventIdx, condIdx, condition: cond, branch: override?.irule === ir.name ? override.branch : 'false' });
            }
            if (ev?.packetModifications?.length > 0) {
              setPacketLabels(ev.packetModifications.slice(0, 2));
            }
            if (ev?.unconditionalActions?.length > 0) {
              setPacketLabels(prev => [...new Set([...prev, ...ev.unconditionalActions.map(a => a.detail).slice(0, 1)])].slice(0, 2));
            }
          }
          break;
        }
      }

      if (p < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        setPlaying(false); setCurrentStage(null); setActiveCondition(null);
        const entries = [];
        if (allDown) {
          entries.push({ msg: `✗ ${vs.destination} → ALL MEMBERS DOWN`, type: 'error' });
          entries.push({ msg: `  Attempted: ${target.name} (${target.address}:${target.port}) — ${target.status}`, type: 'error' });
          entries.push({ msg: `  Client would receive: connection reset or timeout`, type: 'warn' });
        } else {
          entries.push({ msg: `→ ${vs.destination} → ${target.name} (${target.address}:${target.port})`, type: 'success' });
        }
        irules.forEach(ir => {
          (ir.events || []).forEach(ev => {
            entries.push({ msg: `  iRule: ${ir.name} @ ${ev.event}`, type: 'irule' });
            if (ev.canBlock) entries.push({ msg: `    ⚠ Can block/rate-limit traffic`, type: 'warn' });
            if (ev.canRedirect) entries.push({ msg: `    ↩ Can redirect traffic`, type: 'warn' });
            if (ev.canSelectPool) entries.push({ msg: `    🔀 Can override pool selection`, type: 'warn' });
            (ev.packetModifications || []).forEach(mod => entries.push({ msg: `    ✎ ${mod}`, type: 'mod' }));
          });
        });
        entries.push({ msg: `  LB: ${pool.lbMethod || 'round-robin'} → ${allDown ? 'NO HEALTHY MEMBERS' : target.name}`, type: allDown ? 'error' : 'info' });
        setPacketLog(prev => [...entries, ...prev].slice(0, 30));
      }
    };
    animRef.current = requestAnimationFrame(animate);
  }, [selectTarget, getIRulePoolOverride, buildStages, vs, pool, irules, healthyMembers, DURATION]);

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  // ── Loading / Error ──────────────────────────────────
  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: t.textDim, background: t.bg, borderRadius: 16, border: `1px solid ${t.border}` }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      <div style={{ width: 24, height: 24, border: `3px solid ${t.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      Discovering topology for {virtualServerName}...
    </div>
  );
  if (error) return <div style={{ padding: 20, background: '#1c1017', borderRadius: 12, border: `1px solid ${t.red}33`, color: t.red, fontSize: 13 }}>Topology error: {error}</div>;
  if (!topology) return null;

  // ── Collapsed ────────────────────────────────────────
  if (!expanded) return (
    <div onClick={() => setExpanded(true)} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: t.accentGlow, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill={t.accent}><polygon points="5 3 19 12 5 21"/></svg>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text, fontFamily: sans }}>{vs.name}</div>
        <div style={{ fontSize: 11, color: t.textDim, fontFamily: mono }}>{vs.destination} → {pool.name} ({healthyMembers.length}/{(pool.members||[]).length})</div>
      </div>
      <div style={{ marginLeft: 'auto', fontSize: 11, color: t.textMuted }}>Expand ▸</div>
    </div>
  );

  // ── Layout math ──────────────────────────────────────
  const memberCount = (pool.members || []).length || 1;
  const memberSpacing = 155;
  const W = Math.max(900, memberCount * memberSpacing + 100);
  const memberStartX = (W - memberCount * memberSpacing) / 2 + 10;
  const CX = W / 2;
  const VIP_Y = 50;

  // iRule stages — one row per event
  const iruleRows = [];
  irules.forEach((ir, irIdx) => {
    (ir.events || [{ event: 'RULE_INIT' }]).forEach((ev, evIdx) => {
      iruleRows.push({ irule: ir, irIdx, event: ev, evIdx });
    });
  });
  const IRULE_START_Y = 135;
  const IRULE_ROW_H = 65;
  const iruleHeight = iruleRows.length * IRULE_ROW_H;

  const POOL_Y = IRULE_START_Y + (iruleRows.length > 0 ? iruleHeight + 15 : 0);
  const NODE_Y = POOL_Y + 88;
  const SVG_H = NODE_Y + 135;

  const stages = buildStages();

  // ── Packet position ──────────────────────────────────
  const getPacketPos = () => {
    if (packetProgress < 0 || !playing) return null;
    const stage = stages.find(s => packetProgress >= s.start && packetProgress < s.end);
    if (!stage) return null;
    const sp = (packetProgress - stage.start) / (stage.end - stage.start);

    if (stage.name === 'client') return { x: CX, y: VIP_Y - 20 + (VIP_Y + 55 - VIP_Y + 20) * sp, label: 'SYN' };
    if (stage.name.startsWith('irule_')) {
      const rowIdx = iruleRows.findIndex((_, i) => `irule_${iruleRows[i].irIdx}_${iruleRows[i].evIdx}` === stage.name);
      if (rowIdx >= 0) {
        const iy = IRULE_START_Y + rowIdx * IRULE_ROW_H;
        return { x: CX, y: iy + sp * 52, label: iruleRows[rowIdx].event?.event || '' };
      }
    }
    if (stage.name === 'lb') return { x: CX, y: POOL_Y + sp * 44, label: (pool.lbMethod || 'LB').split('-')[0] };
    if (stage.name === 'node' && targetNode) {
      const idx = (pool.members || []).findIndex(m => m.address === targetNode.address && m.port === targetNode.port);
      if (idx < 0) return null;
      const mx = memberStartX + idx * memberSpacing + 70;
      return { x: CX + (mx - CX) * sp, y: POOL_Y + 44 + (NODE_Y - POOL_Y - 44) * sp, label: `→ ${targetNode.name}` };
    }
    return null;
  };
  const pkt = getPacketPos();

  return (
    <div style={{ background: t.bg, borderRadius: 16, border: `1px solid ${t.border}`, overflow: 'hidden', fontFamily: sans }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Header ──────────────────────────────────── */}
      <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `1px solid ${t.border}`, background: t.surface }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{vs.name}</div>
          <div style={{ fontSize: 11, color: t.textDim, fontFamily: mono, marginTop: 2 }}>
            {vs.destination} · {pool.lbMethod || 'round-robin'}{vs.persistence ? ` · persist:${vs.persistence}` : ''} · {irules.length} iRule{irules.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: (ST[vs.status] || ST.unknown).bg }} />
          <span style={{ fontSize: 11, color: t.textDim }}>{(ST[vs.status] || ST.unknown).label}</span>
        </div>
        <button onClick={playPacket} disabled={playing || (pool.members || []).length === 0}
          style={{ background: playing ? t.surfaceLight : t.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 22px', fontSize: 12, fontWeight: 600, cursor: playing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: playing ? 0.6 : 1, boxShadow: playing ? 'none' : `0 0 20px ${t.accentGlow}` }}>
          {playing
            ? <><span style={{ width: 10, height: 10, borderRadius: '50%', background: t.packet, animation: 'pulse 0.8s infinite' }} />Simulating...</>
            : <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>Play Packet</>}
        </button>
        {embedded && <button onClick={() => setExpanded(false)} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, color: t.textDim, padding: '7px 12px', cursor: 'pointer', fontSize: 11 }}>Collapse</button>}
        {onClose && <button onClick={onClose} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, color: t.textDim, padding: '7px 12px', cursor: 'pointer', fontSize: 14 }}>×</button>}
      </div>

      {/* ── SVG Canvas ──────────────────────────────── */}
      <div style={{ padding: '0 24px', overflowX: 'auto' }}>
        <svg width={W} height={SVG_H} style={{ display: 'block' }}>
          <defs>
            <filter id="pGlow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <filter id="tGlow"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>

          {/* ── VIP ──────────────────────── */}
          <rect x={CX - 110} y={VIP_Y} width={220} height={55} rx={12}
            fill={currentStage === 'client' ? t.accentGlow : t.surface} stroke={t.accent} strokeWidth={1.5} />
          <text x={CX} y={VIP_Y + 22} textAnchor="middle" fontSize={14} fontWeight="700" fill={t.text} fontFamily={sans}>{vs.name}</text>
          <text x={CX} y={VIP_Y + 40} textAnchor="middle" fontSize={10} fill={t.textDim} fontFamily={mono}>VIP {vs.destination}</text>

          {/* Profiles */}
          {(vs.profiles || []).slice(0, 5).map((p, i) => (
            <g key={p}><rect x={CX + 120 + i * 54} y={VIP_Y + 10} width={48} height={18} rx={9} fill={t.surfaceLight} stroke={t.border} strokeWidth={1} />
              <text x={CX + 144 + i * 54} y={VIP_Y + 22} textAnchor="middle" fontSize={8} fill={t.textMuted} fontFamily={mono}>{p}</text></g>
          ))}
          {/* SNAT */}
          {vs.snat && vs.snat !== 'none' && (
            <g><rect x={CX - 190} y={VIP_Y + 16} width={70} height={18} rx={9} fill={t.surfaceLight} stroke={t.border} strokeWidth={1} />
              <text x={CX - 155} y={VIP_Y + 28} textAnchor="middle" fontSize={8} fill={t.textMuted} fontFamily={mono}>snat:{vs.snat}</text></g>
          )}

          {/* ── iRule Stages ─────────────── */}
          {iruleRows.map((row, rowIdx) => {
            const iy = IRULE_START_Y + rowIdx * IRULE_ROW_H;
            const stageKey = `irule_${row.irIdx}_${row.evIdx}`;
            const active = currentStage === stageKey;
            const ev = row.event;
            const hasConditions = (ev.conditions || []).length > 0;
            const cardW = 360;

            return (
              <g key={stageKey}>
                {/* Connector */}
                <line x1={CX} y1={rowIdx === 0 ? VIP_Y + 55 : IRULE_START_Y + (rowIdx - 1) * IRULE_ROW_H + 52}
                  x2={CX} y2={iy} stroke={active ? t.irule : t.borderLight} strokeWidth={active ? 2 : 1} strokeDasharray="6 4" strokeOpacity={active ? 0.9 : 0.3} />

                {/* iRule card */}
                <rect x={CX - cardW / 2} y={iy} width={cardW} height={52} rx={8}
                  fill={active ? t.iruleGlow : t.surface}
                  stroke={t.irule} strokeWidth={active ? 2 : 1} strokeDasharray="4 3" strokeOpacity={active ? 1 : 0.4} />

                {/* Event + iRule name */}
                <text x={CX - cardW / 2 + 14} y={iy + 18} fontSize={10} fontWeight="600" fill={t.irule} fontFamily={sans}>
                  {row.irule.name} → {ev.event || 'RULE_INIT'}
                </text>
                <text x={CX - cardW / 2 + 14} y={iy + 34} fontSize={9} fill={t.textDim} fontFamily={mono}>
                  {ev.description || (ev.packetModifications || []).join(', ') || 'Processing...'}
                </text>

                {/* Impact badges */}
                {ev.canBlock && <g><rect x={CX + cardW / 2 - 130} y={iy + 4} width={44} height={16} rx={8} fill={`${t.red}22`} stroke={`${t.red}55`} strokeWidth={1} />
                  <text x={CX + cardW / 2 - 108} y={iy + 15} textAnchor="middle" fontSize={7} fill={t.red} fontFamily={mono}>BLOCK</text></g>}
                {ev.canRedirect && <g><rect x={CX + cardW / 2 - 80} y={iy + 4} width={54} height={16} rx={8} fill={`${t.orange}22`} stroke={`${t.orange}55`} strokeWidth={1} />
                  <text x={CX + cardW / 2 - 53} y={iy + 15} textAnchor="middle" fontSize={7} fill={t.orange} fontFamily={mono}>REDIRECT</text></g>}
                {ev.canSelectPool && <g><rect x={CX + cardW / 2 - 130} y={iy + 24} width={54} height={16} rx={8} fill={`${t.accent}22`} stroke={`${t.accent}55`} strokeWidth={1} />
                  <text x={CX + cardW / 2 - 103} y={iy + 35} textAnchor="middle" fontSize={7} fill={t.accent} fontFamily={mono}>POOL SEL</text></g>}

                {/* Code button */}
                <rect x={CX + cardW / 2 + 6} y={iy + 14} width={22} height={22} rx={6}
                  fill={showIRule === row.irule.name ? t.iruleGlow : t.surfaceLight} stroke={t.irule} strokeWidth={1}
                  style={{ cursor: 'pointer' }} onClick={() => setShowIRule(showIRule === row.irule.name ? null : row.irule.name)} />
                <text x={CX + cardW / 2 + 17} y={iy + 29} textAnchor="middle" fontSize={9} fill={t.irule} fontFamily={mono} style={{ pointerEvents: 'none' }}>{`</>`}</text>

                {/* Active condition highlight */}
                {active && activeCondition && activeCondition.iruleIdx === row.irIdx && activeCondition.eventIdx === row.evIdx && activeCondition.condition && (
                  <g>
                    <rect x={CX - cardW / 2 - 8} y={iy - 8} width={cardW + 16} height={68} rx={12}
                      fill="none" stroke={t.packet} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} />
                    <text x={CX} y={iy + 62} textAnchor="middle" fontSize={8} fill={t.packet} fontFamily={mono}>
                      {activeCondition.condition.check || ''}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* ── Pool ─────────────────────── */}
          <line x1={CX} y1={iruleRows.length > 0 ? IRULE_START_Y + (iruleRows.length - 1) * IRULE_ROW_H + 52 : VIP_Y + 55}
            x2={CX} y2={POOL_Y}
            stroke={currentStage === 'lb' ? t.accent : t.borderLight} strokeWidth={currentStage === 'lb' ? 2 : 1} strokeOpacity={currentStage === 'lb' ? 0.9 : 0.3} />
          <rect x={CX - 130} y={POOL_Y} width={260} height={44} rx={10}
            fill={currentStage === 'lb' ? t.accentGlow : t.surface} stroke={t.accent} strokeWidth={1.5} />
          <text x={CX} y={POOL_Y + 18} textAnchor="middle" fontSize={12} fontWeight="600" fill={t.text} fontFamily={sans}>{pool.name || 'No pool'}</text>
          <text x={CX} y={POOL_Y + 33} textAnchor="middle" fontSize={9} fill={t.textDim} fontFamily={mono}>
            {pool.monitor || 'default'} · {healthyMembers.length}/{(pool.members || []).length} healthy
          </text>

          {/* LB badge */}
          <rect x={CX + 145} y={POOL_Y + 4} width={170} height={34} rx={17} fill={t.accentGlow} stroke={t.accent} strokeWidth={1} />
          <text x={CX + 230} y={POOL_Y + 17} textAnchor="middle" fontSize={8} fontWeight="600" fill={t.accent} fontFamily={sans}>
            {(pool.lbMethod || 'round-robin').toUpperCase()}
          </text>
          <text x={CX + 230} y={POOL_Y + 29} textAnchor="middle" fontSize={7} fill={t.textDim} fontFamily={mono}>
            {(LB_INFO[pool.lbMethod] || 'Standard distribution').substring(0, 35)}
          </text>

          {/* ── Lines to nodes ────────────── */}
          {(pool.members || []).map((m, i) => {
            const mx = memberStartX + i * memberSpacing + 70;
            const isTgt = targetNode && m.address === targetNode.address && m.port === targetNode.port;
            return <line key={`l${i}`} x1={CX} y1={POOL_Y + 44} x2={mx} y2={NODE_Y}
              stroke={isTgt && currentStage === 'node' ? t.packet : m.status === 'available' ? t.borderLight : `${t.red}33`}
              strokeWidth={isTgt && currentStage === 'node' ? 2.5 : 1}
              strokeDasharray={m.status !== 'available' ? '6 4' : 'none'} strokeOpacity={m.status === 'available' ? 0.4 : 0.2} />;
          })}

          {/* ── Nodes ────────────────────── */}
          {(pool.members || []).map((m, i) => {
            const mx = memberStartX + i * memberSpacing;
            const isTgt = targetNode && m.address === targetNode.address && m.port === targetNode.port;
            const st = ST[m.status] || ST.unknown;
            const key = `${m.address}:${m.port}`;
            const others = otherAttachments[key] || [];
            const hasOthers = others.length > 0;
            const cardH = hasOthers ? 105 : 85;
            const sel = selectedNode && selectedNode.address === m.address && selectedNode.port === m.port;

            return (
              <g key={key} onClick={() => setSelectedNode(sel ? null : m)} style={{ cursor: 'pointer' }}>
                <rect x={mx} y={NODE_Y} width={140} height={cardH} rx={10}
                  fill={sel ? t.surfaceLight : t.surface}
                  stroke={isTgt && (currentStage === 'node' || !playing) ? t.packet : st.bg}
                  strokeWidth={isTgt ? 2 : 1}
                  filter={isTgt && currentStage === 'node' ? 'url(#tGlow)' : 'none'} />
                <circle cx={mx + 16} cy={NODE_Y + 18} r={5} fill={st.bg}>
                  {m.status === 'available' && <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />}
                </circle>
                <text x={mx + 28} y={NODE_Y + 22} fontSize={11} fontWeight="600" fill={t.text} fontFamily={sans}>{m.name || m.address}</text>
                <text x={mx + 16} y={NODE_Y + 40} fontSize={10} fill={t.textDim} fontFamily={mono}>{m.address}:{m.port}</text>
                {m.status === 'available' ? (<>
                  <text x={mx + 16} y={NODE_Y + 56} fontSize={9} fill={t.textMuted} fontFamily={mono}>{m.connections} conn{m.responseTime != null ? ` · ${m.responseTime}ms` : ''}</text>
                  <text x={mx + 16} y={NODE_Y + 70} fontSize={9} fill={t.textMuted} fontFamily={mono}>ratio:{m.ratio || 1} · pri:{m.priority || 0}</text>
                </>) : (
                  <text x={mx + 16} y={NODE_Y + 56} fontSize={9} fill={st.bg} fontFamily={mono}>{st.label}</text>
                )}
                {hasOthers && (<>
                  <line x1={mx + 12} y1={NODE_Y + 80} x2={mx + 128} y2={NODE_Y + 80} stroke={t.border} strokeWidth={1} />
                  <text x={mx + 16} y={NODE_Y + 96} fontSize={8} fill={t.irule} fontFamily={mono}>+{others.length} other VS</text>
                </>)}
              </g>
            );
          })}

          {/* ── Animated Packet ────────────── */}
          {pkt && (() => {
            const packetColor = targetNode && targetNode.status !== 'available' ? t.red : t.packet;
            const opacity = packetProgress < 0.05 ? packetProgress / 0.05 : packetProgress > 0.95 ? (1 - packetProgress) / 0.05 : 1;
            return (
            <g style={{ opacity }}>
              <circle cx={pkt.x} cy={pkt.y} r={7} fill={packetColor} filter="url(#pGlow)" />
              <circle cx={pkt.x} cy={pkt.y} r={3} fill="#fff" />
              {pkt.label && <text x={pkt.x} y={pkt.y - 14} textAnchor="middle" fontSize={9} fill={t.textDim} fontFamily={mono}>{pkt.label}</text>}
              {/* Show header modifications near packet */}
              {packetLabels.length > 0 && currentStage?.startsWith('irule') && (
                <g>
                  {packetLabels.map((lbl, i) => (
                    <text key={i} x={pkt.x + 20} y={pkt.y + 4 + i * 12} fontSize={7} fill={t.packet} fontFamily={mono} opacity={0.8}>
                      ✎ {typeof lbl === 'string' ? lbl.substring(0, 40) : ''}
                    </text>
                  ))}
                </g>
              )}
            </g>
            );
          })()}
        </svg>
      </div>

      {/* ── Bottom Panels ──────────────────────────────── */}
      <div style={{ display: 'flex', borderTop: `1px solid ${t.border}`, minHeight: 100 }}>
        {/* Packet Log */}
        <div style={{ flex: 1, padding: 16, maxHeight: 180, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: t.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Packet Log</div>
          {packetLog.length === 0
            ? <div style={{ fontSize: 11, color: t.textMuted, fontFamily: mono }}>Press Play to simulate a packet through the topology</div>
            : packetLog.map((e, i) => (
              <div key={i} style={{ fontSize: 10, fontFamily: mono, lineHeight: 1.8,
                color: e.type === 'error' ? t.red : e.type === 'success' ? t.green : e.type === 'irule' ? t.irule : e.type === 'warn' ? t.orange : e.type === 'mod' ? t.packet : t.textDim }}>
                {e.msg}
              </div>
            ))}
        </div>

        {/* iRule code + impact panel */}
        {showIRule && (() => {
          const ir = irules.find(r => r.name === showIRule);
          if (!ir) return null;
          return (
            <div style={{ width: 380, padding: 16, borderLeft: `1px solid ${t.border}`, background: t.surface, maxHeight: 280, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.irule }}>iRule: {showIRule}</div>
                <button onClick={() => setShowIRule(null)} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>

              {/* Traffic impact summary */}
              {(ir.events || []).map((ev, ei) => (
                <div key={ei} style={{ marginBottom: 10, padding: 10, background: t.bg, borderRadius: 8, border: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: t.text, marginBottom: 4 }}>{ev.event}</div>
                  {(ev.conditions || []).map((cond, ci) => (
                    <div key={ci} style={{ fontSize: 9, fontFamily: mono, color: t.textDim, marginBottom: 6, paddingLeft: 8, borderLeft: `2px solid ${t.irule}44` }}>
                      <div style={{ color: t.irule }}>if {cond.check || cond.tcl || '...'}</div>
                      {cond.trueBranch && <div style={{ color: t.green, marginLeft: 8 }}>
                        → {cond.trueBranch.action}: {cond.trueBranch.detail || ''}
                        {cond.trueBranch.targetPool && <span style={{ color: t.accent }}> [{cond.trueBranch.targetPool}]</span>}
                      </div>}
                      {cond.falseBranch && <div style={{ color: t.red, marginLeft: 8 }}>
                        ✗ {cond.falseBranch.action}: {cond.falseBranch.detail || 'continue'}
                      </div>}
                    </div>
                  ))}
                  {(ev.unconditionalActions || []).map((ua, ui) => (
                    <div key={ui} style={{ fontSize: 9, fontFamily: mono, color: t.packet, marginLeft: 8 }}>
                      always: {ua.detail || ua.action}
                    </div>
                  ))}
                  {(ev.packetModifications || []).map((mod, mi) => (
                    <div key={mi} style={{ fontSize: 9, fontFamily: mono, color: t.textDim, marginLeft: 8 }}>✎ {mod}</div>
                  ))}
                </div>
              ))}

              {/* Raw code */}
              <div style={{ fontSize: 10, fontWeight: 600, color: t.textMuted, marginBottom: 4, marginTop: 8 }}>Source</div>
              <pre style={{ fontSize: 9, color: t.textDim, fontFamily: mono, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap', background: t.bg, padding: 10, borderRadius: 8, border: `1px solid ${t.border}`, maxHeight: 150, overflow: 'auto' }}>
                {ir.code || '(no code available)'}
              </pre>
            </div>
          );
        })()}

        {/* Node detail */}
        {selectedNode && (
          <div style={{ width: 240, padding: 16, borderLeft: `1px solid ${t.border}`, background: t.surface }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{selectedNode.name || selectedNode.address}</div>
              <button onClick={() => setSelectedNode(null)} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', fontSize: 14 }}>×</button>
            </div>
            <div style={{ fontSize: 10, fontFamily: mono, color: t.textDim, lineHeight: 2.2 }}>
              <div>Address: {selectedNode.address}:{selectedNode.port}</div>
              <div>Status: <span style={{ color: (ST[selectedNode.status] || ST.unknown).bg }}>{selectedNode.status}</span></div>
              <div>Connections: {selectedNode.connections}</div>
              <div>Priority: {selectedNode.priority || 0} · Ratio: {selectedNode.ratio || 1}</div>
            </div>
            {(() => {
              const key = `${selectedNode.address}:${selectedNode.port}`;
              const others = otherAttachments[key] || [];
              if (!others.length) return null;
              return (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: t.irule, marginBottom: 6 }}>Also attached to:</div>
                  {others.map((att, i) => (
                    <div key={i} style={{ fontSize: 10, fontFamily: mono, color: t.textDim, lineHeight: 1.8 }}>● {att.vs} → {att.pool}</div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
