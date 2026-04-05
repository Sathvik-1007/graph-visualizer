// ─────────────────────────────────────────────────────────────
// FORCE-DIRECTED GRAPH VISUALIZER
// Physics model:
//   Repulsion  →  Coulomb:  F = k_r · q_i·q_j / r²   (pushes apart)
//   Attraction →  Hooke:    F = k_s · (r − L₀)        (pulls along edge)
//   Gravity    →  Linear:   F = k_g · dist_center      (prevents drift)
//   Integration→  Verlet-ish Euler + velocity damping
// ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

// Physics config
const cfg = {
  repulsion:      5000,
  springLen:      100,
  springStr:      0.1,
  gravity:        0.01,
  damping:        0.85,
  maxVelocity:    18,
  massBase:       1.0,
  massPerDeg:     0.4,
};

// Graph data
let nodes   = [];
let edges   = [];
let adjMap  = new Map();   // id → Set<id>
let edgeKey = new Set();   // "a,b" dedup

// Sim state
let alpha   = 1.0;
let running = true;

// View transform (pan + zoom, canvas-centered origin)
let vx = 0, vy = 0, vz = 1.0;

// Interaction
let dragNode   = null;
let panning    = false;
let px = 0, py = 0;
let hoverNode  = null;

// Click-to-center animation
let panAnim      = null;   // {tx, ty} — smooth pan target in world coords
let selectedNode = null;   // node that was just clicked-to-center
let selectedAnim = 0;      // 1→0 fade-out for the pulse ring
// Click vs drag detection
let clickOriginSX = 0, clickOriginSY = 0;
let clickCandidateNode = null;
let hasDragged = false;

// ─── Color / geometry helpers ─────────────────────────────

function nodeColor(deg) {
  if (deg <= 1)  return { fill:'#252422', stroke:'#4a4947', glow:'rgba(74,73,71,0.35)' };
  if (deg <= 4)  return { fill:'#213050', stroke:'#5591c7', glow:'rgba(85,145,199,0.45)' };
  if (deg <= 9)  return { fill:'#14404a', stroke:'#4f98a3', glow:'rgba(79,152,163,0.55)' };
  if (deg <= 18) return { fill:'#4a3200', stroke:'#e8af34', glow:'rgba(232,175,52,0.65)' };
                 return { fill:'#522800', stroke:'#fdab43', glow:'rgba(253,171,67,0.80)' };
}

function nodeR(deg) { return Math.max(5, Math.min(28, 5 + Math.sqrt(deg + 1) * 3.5)); }
function nodeMass(deg) { return cfg.massBase + deg * cfg.massPerDeg; }

// ─── Graph mutators ───────────────────────────────────────

function mkNode(label, x, y) {
  const id = nodes.length;
  const W  = canvas.width  / 2;
  const H  = canvas.height / 2;
  const node = {
    id, label: label || `n${id}`,
    x: x ?? (Math.random() - 0.5) * 240,
    y: y ?? (Math.random() - 0.5) * 240,
    vx: 0, vy: 0, degree: 0, pinned: false
  };
  nodes.push(node);
  adjMap.set(id, new Set());
  return node;
}

function mkEdge(a, b) {
  if (a === b) return false;
  const k = `${Math.min(a,b)},${Math.max(a,b)}`;
  if (edgeKey.has(k)) return false;
  edges.push({ src: a, tgt: b });
  edgeKey.add(k);
  adjMap.get(a).add(b);
  adjMap.get(b).add(a);
  nodes[a].degree++;
  nodes[b].degree++;
  return true;
}

function clearAll() {
  nodes = []; edges = [];
  adjMap.clear(); edgeKey.clear();
  alpha = 1.0; updateStats();
}

// ─── Simulation ───────────────────────────────────────────

function tick() {
  if (!running || alpha < 8e-4) return;

  const n  = nodes.length;
  const cx = 0, cy = 0; // world origin = canvas center

  // Reset acceleration
  for (const nd of nodes) { nd.ax = 0; nd.ay = 0; }

  // ── 1. Repulsion (Coulomb's law) ──────────────────────
  // Each node carries "charge" proportional to its radius.
  // F_rep = k_r · (r_i · r_j) / d²   →   directed away
  // We use O(n²) here; Barnes-Hut quad-tree is O(n log n)
  // but unnecessary for < ~500 nodes.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d  = Math.sqrt(dx*dx + dy*dy);
      if (d < 1) { dx = Math.random()*2-1; dy = Math.random()*2-1; d = 1; }

      const qi = nodeR(a.degree), qj = nodeR(b.degree);
      const F  = cfg.repulsion * qi * qj / (d * d);
      const fx = dx/d * F, fy = dy/d * F;

      const mi = nodeMass(a.degree), mj = nodeMass(b.degree);
      a.ax -= fx / mi;  a.ay -= fy / mi;
      b.ax += fx / mj;  b.ay += fy / mj;
    }
  }

  // ── 2. Spring attraction (Hooke's law) ────────────────
  // F_spring = k_s · (d − L₀)   →   directed towards partner
  // High-mass (hub) nodes accelerate less → settle at center.
  for (const e of edges) {
    const a = nodes[e.src], b = nodes[e.tgt];
    let dx = b.x - a.x, dy = b.y - a.y;
    let d  = Math.sqrt(dx*dx + dy*dy) || 0.01;
    const stretch = d - cfg.springLen;
    const F  = cfg.springStr * stretch;
    const fx = dx/d * F, fy = dy/d * F;
    const mi = nodeMass(a.degree), mj = nodeMass(b.degree);
    a.ax += fx / mi;  a.ay += fy / mi;
    b.ax -= fx / mj;  b.ay -= fy / mj;
  }

  // ── 3. Center gravity ─────────────────────────────────
  // F_grav = k_g · r_from_center   (linear, constant per-node)
  // Combined with high mass for hubs → hubs land at center first.
  for (const nd of nodes) {
    nd.ax += (cx - nd.x) * cfg.gravity;
    nd.ay += (cy - nd.y) * cfg.gravity;
  }

  // ── 4. Euler integration + velocity damping ───────────
  // v_(t+1) = (v_t + a) · damping
  // x_(t+1) = x_t + v_(t+1)
  for (const nd of nodes) {
    if (nd.pinned) { nd.vx = 0; nd.vy = 0; continue; }
    nd.vx = (nd.vx + nd.ax) * cfg.damping;
    nd.vy = (nd.vy + nd.ay) * cfg.damping;
    const spd = Math.sqrt(nd.vx*nd.vx + nd.vy*nd.vy);
    if (spd > cfg.maxVelocity) { nd.vx *= cfg.maxVelocity/spd; nd.vy *= cfg.maxVelocity/spd; }
    nd.x += nd.vx;
    nd.y += nd.vy;
  }

  // Simulated annealing cool-down
  alpha *= 0.9985;
  updateStats();
}

// ─── Rendering ────────────────────────────────────────────

function w2s(x, y) {
  return { x: (x + vx)*vz + canvas.width/2, y: (y + vy)*vz + canvas.height/2 };
}
function s2w(sx, sy) {
  return { x: (sx - canvas.width/2) / vz - vx, y: (sy - canvas.height/2) / vz - vy };
}

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#0c0c0a';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  drawGrid(W, H);

  // World-space transform
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.scale(vz, vz);
  ctx.translate(vx, vy);

  drawEdges();
  drawNodes();

  ctx.restore();
}

function drawGrid(W, H) {
  const sz  = 44 * vz;
  const ox  = ((vx * vz) % sz + W/2) % sz;
  const oy  = ((vy * vz) % sz + H/2) % sz;
  ctx.strokeStyle = 'rgba(255,255,255,0.022)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  for (let x = ox; x < W; x += sz) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = oy; y < H; y += sz) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}

function drawEdges() {
  const hlNeighbors = hoverNode ? adjMap.get(hoverNode.id) : null;

  for (const e of edges) {
    const a = nodes[e.src], b = nodes[e.tgt];
    const isHL = hlNeighbors && (a.id === hoverNode.id || b.id === hoverNode.id
                               || hlNeighbors.has(a.id) || hlNeighbors.has(b.id));

    const ca = nodeColor(a.degree), cb = nodeColor(b.degree);
    const grd = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grd.addColorStop(0, ca.stroke + (isHL ? 'aa' : '44'));
    grd.addColorStop(1, cb.stroke + (isHL ? 'aa' : '44'));

    ctx.strokeStyle = grd;
    ctx.lineWidth   = isHL ? 1.8 / vz : 1 / vz;
    ctx.globalAlpha = isHL ? 0.9 : 0.55;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawNodes() {
  // Draw selected-node pulse ring (click-to-center feedback)
  if (selectedNode && selectedAnim > 0) {
    const snd = selectedNode;
    const sr  = nodeR(snd.degree);
    const ringR = sr + (1 - selectedAnim) * sr * 5;
    ctx.strokeStyle = `rgba(79,152,163,${selectedAnim * 0.75})`;
    ctx.lineWidth   = 2.5 / vz;
    ctx.beginPath();
    ctx.arc(snd.x, snd.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    // Second inner ring
    const ringR2 = sr + (1 - selectedAnim) * sr * 2.5;
    ctx.strokeStyle = `rgba(232,175,52,${selectedAnim * 0.5})`;
    ctx.lineWidth   = 1.5 / vz;
    ctx.beginPath();
    ctx.arc(snd.x, snd.y, ringR2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Draw lowest-degree nodes first so hubs appear on top
  const sorted = [...nodes].sort((a, b) => a.degree - b.degree);

  for (const nd of sorted) {
    const r    = nodeR(nd.degree);
    const c    = nodeColor(nd.degree);
    const isHv = hoverNode && hoverNode.id === nd.id;
    const glowR = r * (isHv ? 4 : (nd.degree > 1 ? 2.8 : 1.5));

    // Glow halo
    if (nd.degree > 0 || isHv) {
      const grd = ctx.createRadialGradient(nd.x, nd.y, r * 0.3, nd.x, nd.y, glowR);
      grd.addColorStop(0, c.glow);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, glowR, 0, Math.PI*2);
      ctx.fill();
    }

    // Body
    ctx.fillStyle   = c.fill;
    ctx.strokeStyle = isHv ? '#ffffff' : c.stroke;
    ctx.lineWidth   = (isHv ? 2.5 : 1.5) / vz;
    ctx.beginPath();
    ctx.arc(nd.x, nd.y, r, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // Pin dot
    if (nd.pinned) {
      ctx.fillStyle = '#fdab43';
      ctx.beginPath();
      ctx.arc(nd.x + r*0.65, nd.y - r*0.65, 2.5/vz, 0, Math.PI*2);
      ctx.fill();
    }

    // Label (visible when zoomed in or hovered)
    if (vz > 0.65 || isHv) {
      const fs = Math.max(9, 10 / vz);
      ctx.font          = `${isHv?600:400} ${fs}px Satoshi,sans-serif`;
      ctx.textAlign     = 'center';
      ctx.textBaseline  = 'middle';
      ctx.fillStyle     = isHv ? '#ffffff' : 'rgba(200,199,196,0.65)';
      ctx.fillText(nd.label, nd.x, nd.y + r + 10/vz);
    }
  }
}

// ─── Hub-as-origin normalisation ──────────────────────────
// After generation, shift all world coords so the highest-degree
// node sits exactly at (0,0).  That way btn-center (vx=0,vy=0)
// always resets to the hub as the visual anchor point.
function normalizeToHub() {
  if (!nodes.length) return;
  const hub = nodes.reduce((a, b) => b.degree > a.degree ? b : a, nodes[0]);
  const ox = hub.x, oy = hub.y;
  for (const nd of nodes) { nd.x -= ox; nd.y -= oy; }
}

// ─── Graph generators ─────────────────────────────────────

function generate(type) {
  clearAll();
  switch (type) {

    case 'ba': {
      // Barabási–Albert preferential attachment
      // New nodes connect to existing nodes with probability
      // proportional to their current degree → natural hubs emerge.
      // This is why "large connection nodes" form first.
      const N = 55, M = 2;
      mkNode('hub-0', 0, 0);
      mkNode('hub-1', 40, 20);
      mkEdge(0, 1);

      for (let i = 2; i < N; i++) {
        const ang = Math.random()*Math.PI*2;
        const nd  = mkNode(`n${i}`,
          Math.cos(ang)*(60 + Math.random()*180),
          Math.sin(ang)*(60 + Math.random()*180));

        const pool = [];
        for (let j = 0; j < i; j++) {
          const deg = nodes[j].degree;
          const wt  = deg + 1; // +1 ensures even isolated nodes get a chance
          for (let w = 0; w < wt; w++) pool.push(j);
        }
        const targets = new Set();
        let tries = 0;
        while (targets.size < M && tries++ < pool.length * 3) {
          targets.add(pool[Math.floor(Math.random()*pool.length)]);
        }
        for (const t of targets) mkEdge(nd.id, t);
      }
      break;
    }

    case 'er': {
      // Erdős–Rényi G(n,p) — each edge exists independently with prob p
      const N = 45, p = 0.09;
      for (let i = 0; i < N; i++) {
        const ang = Math.random()*Math.PI*2;
        mkNode(`n${i}`, Math.cos(ang)*Math.random()*260, Math.sin(ang)*Math.random()*260);
      }
      for (let i = 0; i < N; i++)
        for (let j = i+1; j < N; j++)
          if (Math.random() < p) mkEdge(i, j);
      break;
    }

    case 'clusters': {
      // Community structure — high intra / low inter density
      const C = 4, perC = 12, intraP = 0.38, interP = 0.025;
      const centers = Array.from({length:C},(_,i)=>({
        x: Math.cos(i/C*Math.PI*2)*200,
        y: Math.sin(i/C*Math.PI*2)*200
      }));
      for (let c = 0; c < C; c++) {
        const base = nodes.length;
        for (let i = 0; i < perC; i++) {
          const a = Math.random()*Math.PI*2;
          mkNode(`c${c}n${i}`, centers[c].x + Math.cos(a)*70, centers[c].y + Math.sin(a)*70);
        }
        for (let i = base; i < nodes.length; i++)
          for (let j = i+1; j < nodes.length; j++)
            if (Math.random() < intraP) mkEdge(i, j);
      }
      for (let c1 = 0; c1 < C; c1++)
        for (let c2 = c1+1; c2 < C; c2++) {
          const s1 = c1*perC, s2 = c2*perC;
          for (let i = s1; i < s1+perC; i++)
            for (let j = s2; j < s2+perC; j++)
              if (Math.random() < interP) mkEdge(i, j);
        }
      break;
    }

    case 'grid': {
      const R = 6, C_ = 7, sp = 75;
      for (let r = 0; r < R; r++)
        for (let c = 0; c < C_; c++) {
          const id = r*C_+c;
          mkNode(`${r},${c}`, (c - C_/2)*sp, (r - R/2)*sp);
          if (c > 0) mkEdge(id, id-1);
          if (r > 0) mkEdge(id, id-C_);
        }
      break;
    }

    case 'star': {
      // Several star subgraphs with their hubs linked
      const S = 4, L = 9;
      const hubIds = [];
      for (let s = 0; s < S; s++) {
        const ca = s/S * Math.PI*2;
        const hx = Math.cos(ca)*190, hy = Math.sin(ca)*190;
        const hub = mkNode(`hub${s}`, hx, hy);
        hubIds.push(hub.id);
        for (let l = 0; l < L; l++) {
          const la = l/L*Math.PI*2;
          const leaf = mkNode(`s${s}l${l}`, hx+Math.cos(la)*75, hy+Math.sin(la)*75);
          mkEdge(hub.id, leaf.id);
        }
      }
      for (let i = 0; i < S; i++) mkEdge(hubIds[i], hubIds[(i+1)%S]);
      break;
    }

    case 'tree': {
      function subtree(pid, depth, maxD, x, y, spread) {
        if (depth >= maxD) return;
        [-1, 1].forEach(dir => {
          const child = mkNode(`n${nodes.length}`, x + dir*spread, y + 85);
          mkEdge(pid, child.id);
          subtree(child.id, depth+1, maxD, x + dir*spread, y + 85, spread/1.85);
        });
      }
      const root = mkNode('root', 0, -155);
      subtree(root.id, 0, 4, 0, -155, 170);
      break;
    }
  }

  normalizeToHub();
  vx = 0; vy = 0; vz = 1.0;  // reset view so hub (world origin) is centred
  alpha = 1.0;
  updateStats();
}

function addNode() {
  if (!nodes.length) { mkNode('n0', 0, 0); return; }
  const nd = mkNode(`n${nodes.length}`);
  const k  = Math.min(nodes.length-1, 1 + Math.floor(Math.random()*2));
  const pool = [...nodes.slice(0,-1)].sort(() => Math.random()-0.5);
  for (let i = 0; i < k; i++) mkEdge(nd.id, pool[i].id);
  alpha = Math.max(alpha, 0.5);
  updateStats();
}

function reheat() {
  alpha = 1.0;
  for (const nd of nodes) { nd.vx = (Math.random()-0.5)*8; nd.vy = (Math.random()-0.5)*8; }
}

// ─── Stats ────────────────────────────────────────────────

function updateStats() {
  const n = nodes.length, e = edges.length;
  const maxE = n*(n-1)/2;
  const dens = maxE > 0 ? (e/maxE*100).toFixed(1)+'%' : '—';
  const maxD = n ? Math.max(...nodes.map(x => x.degree)) : 0;
  document.getElementById('st-n').textContent  = n;
  document.getElementById('st-e').textContent  = e;
  document.getElementById('st-d').textContent  = dens;
  document.getElementById('st-md').textContent = maxD;
  const pct = Math.round(alpha * 100);
  document.getElementById('en-fill').style.width = pct + '%';
  document.getElementById('en-val').textContent  = pct + '%';
}

// ─── Interaction ──────────────────────────────────────────

function nodeAt(sx, sy) {
  const {x: wx, y: wy} = s2w(sx, sy);
  let best = null, bd = Infinity;
  for (const nd of nodes) {
    const dx = nd.x-wx, dy = nd.y-wy;
    const d  = Math.sqrt(dx*dx + dy*dy);
    const r  = nodeR(nd.degree) + 6/vz;
    if (d < r && d < bd) { best = nd; bd = d; }
  }
  return best;
}

canvas.addEventListener('mousedown', e => {
  const r   = canvas.getBoundingClientRect();
  const sx  = e.clientX - r.left, sy = e.clientY - r.top;
  const nd  = nodeAt(sx, sy);
  clickOriginSX = sx; clickOriginSY = sy;
  clickCandidateNode = nd;
  hasDragged = false;
  if (nd) { dragNode = nd; nd.pinned = true; canvas.style.cursor = 'grabbing'; }
  else     { panning = true; px = sx; py = sy; canvas.style.cursor = 'grabbing'; }
});

canvas.addEventListener('mousemove', e => {
  const r  = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  // Detect drag threshold (6px) so click vs drag is reliable
  if (!hasDragged) {
    const ddx = sx - clickOriginSX, ddy = sy - clickOriginSY;
    if (Math.sqrt(ddx*ddx + ddy*ddy) > 6) hasDragged = true;
  }
  if (dragNode) {
    const w = s2w(sx, sy);
    dragNode.x = w.x; dragNode.y = w.y;
    dragNode.vx = 0;  dragNode.vy = 0;
    alpha = Math.max(alpha, 0.25);
  } else if (panning) {
    vx += (sx-px)/vz; vy += (sy-py)/vz;
    px = sx; py = sy;
  } else {
    hoverNode = nodeAt(sx, sy);
    canvas.style.cursor = hoverNode ? 'pointer' : 'default';
    const tt = document.getElementById('tooltip');
    if (hoverNode) {
      tt.style.left = (sx+14) + 'px';
      tt.style.top  = (sy-10) + 'px';
      document.getElementById('tt-name').textContent = hoverNode.label;
      document.getElementById('tt-meta').textContent = `Degree: ${hoverNode.degree}  ·  ID: ${hoverNode.id}`;
      const nbrs = [...adjMap.get(hoverNode.id)].slice(0,5).map(i => nodes[i].label).join(', ');
      const extra = adjMap.get(hoverNode.id).size > 5 ? ` +${adjMap.get(hoverNode.id).size - 5} more` : '';
      document.getElementById('tt-nbrs').textContent = nbrs ? `↔ ${nbrs}${extra}` : '';
      tt.classList.add('on');
    } else {
      tt.classList.remove('on');
    }
  }
});

canvas.addEventListener('mouseup', e => {
  // Treat as click if mouse barely moved
  if (!hasDragged && clickCandidateNode) {
    const nd = clickCandidateNode;
    panAnim      = { tx: -nd.x, ty: -nd.y };
    selectedNode = nd;
    selectedAnim = 1.0;
  }
  if (dragNode) { dragNode.pinned = false; dragNode = null; }
  panning = false;
  clickCandidateNode = null;
  canvas.style.cursor = 'default';
});
canvas.addEventListener('mouseleave', () => {
  if (dragNode) { dragNode.pinned = false; dragNode = null; }
  panning = false;
  hoverNode = null;
  document.getElementById('tooltip').classList.remove('on');
});

canvas.addEventListener('dblclick', e => {
  const r = canvas.getBoundingClientRect();
  const nd = nodeAt(e.clientX - r.left, e.clientY - r.top);
  if (nd) nd.pinned = !nd.pinned;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r   = canvas.getBoundingClientRect();
  const sx  = e.clientX - r.left, sy = e.clientY - r.top;
  const wb  = s2w(sx, sy);
  const f   = e.deltaY > 0 ? 0.88 : 1.14;
  vz = Math.max(0.08, Math.min(6, vz * f));
  const wa  = s2w(sx, sy);
  vx += wa.x - wb.x;
  vy += wa.y - wb.y;
}, { passive: false });

// ─── HUD buttons ──────────────────────────────────────────

document.getElementById('btn-play').addEventListener('click', () => {
  running = !running;
  const btn = document.getElementById('btn-play');
  btn.classList.toggle('active', running);
  btn.innerHTML = running
    ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5v11L13 8z"/></svg>'
    : '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/></svg>';
});

document.getElementById('btn-fit').addEventListener('click', () => {
  if (!nodes.length) return;
  const pad = 80;
  const xs  = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const gw   = maxX - minX || 1, gh = maxY - minY || 1;
  vz = Math.min((canvas.width-pad*2)/gw, (canvas.height-pad*2)/gh, 3);
  vx = -(minX + maxX) / 2;
  vy = -(minY + maxY) / 2;
});
document.getElementById('btn-center').addEventListener('click', () => { vx = 0; vy = 0; vz = 1; });

// ─── Slider bindings ──────────────────────────────────────

const sliders = [
  ['s-rep',  'v-rep',  'repulsion',  v => Math.round(v),        v => v],
  ['s-spl',  'v-spl',  'springLen',  v => Math.round(v),        v => v],
  ['s-sps',  'v-sps',  'springStr',  v => v.toFixed(3),         v => v],
  ['s-grav', 'v-grav', 'gravity',    v => v.toFixed(3),         v => v],
  ['s-damp', 'v-damp', 'damping',    v => v.toFixed(2),         v => v],
];
for (const [sid, vid, key, fmt, parse] of sliders) {
  const el = document.getElementById(sid);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    document.getElementById(vid).textContent = fmt(v);
    cfg[key] = v;
    alpha = Math.max(alpha, 0.3);
  });
}

// ─── Resize ───────────────────────────────────────────────

function resize() {
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
window.addEventListener('resize', resize);

// ─── Main loop ────────────────────────────────────────────

function loop() {
  // Smooth pan animation (click-to-center)
  if (panAnim) {
    vx += (panAnim.tx - vx) * 0.10;
    vy += (panAnim.ty - vy) * 0.10;
    if (Math.abs(panAnim.tx - vx) < 0.15 && Math.abs(panAnim.ty - vy) < 0.15) {
      vx = panAnim.tx; vy = panAnim.ty;
      panAnim = null;
    }
  }
  // Decay the pulse ring
  if (selectedAnim > 0) {
    selectedAnim = Math.max(0, selectedAnim - 0.028);
    if (selectedAnim <= 0) selectedNode = null;
  }
  tick();
  render();
  requestAnimationFrame(loop);
}

resize();
generate('ba');
loop();
