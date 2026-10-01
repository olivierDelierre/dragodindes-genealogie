(() => {
  'use strict';

  const DATA = window.DRAGODINDES;
  const byName = new Map(DATA.map(m => [m.name, m]));
  const byId = new Map(DATA.map(m => [m.id, m]));
  const MAX_GEN = Math.max(...DATA.map(m => m.gen));

  // Enfants de chaque monture : [{ child, partner, role }]
  const childrenOf = new Map(DATA.map(m => [m.id, []]));
  for (const m of DATA) {
    if (!m.parents) continue;
    m.parents.forEach((pn, i) => {
      const p = byName.get(pn);
      childrenOf.get(p.id).push({ child: m, partner: byName.get(m.parents[1 - i]), role: i });
    });
  }
  const parentsOf = m => (m.parents || []).map(n => byName.get(n));

  // ---------- Stockage local ----------
  const STORE_KEY = 'dragodindes-genealogie-v1';
  const state = Object.assign(
    { selected: 'prune-et-emeraude', view: 'tree', depth: 3, zoom: 1, owned: [], onlyOwned: false, planQty: 1, planDone: {}, fwd: true, theme: null },
    load()
  );
  const mobileMQ = matchMedia('(max-width: 760px)');
  // Sur petit écran, on démarre un peu dézoomé tant que l'utilisatrice n'a pas choisi de zoom.
  if (load().zoom === undefined && mobileMQ.matches) state.zoom = 0.8;
  const owned = new Set(state.owned);
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  function save() {
    state.owned = [...owned];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ }
  }
  if (!byId.has(state.selected)) state.selected = DATA[DATA.length - 1].id;

  // ---------- Éléments ----------
  const $ = s => document.querySelector(s);
  const listEl = $('#list'), detailEl = $('#detail'), canvas = $('#canvas'), viewport = $('#viewport');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ROLE = ['Parent 1', 'Parent 2'];
  // Sens de lecture : true = parents à gauche → enfant à droite ; false = enfant à gauche ← parents à droite.
  const fwd = () => state.fwd !== false;

  // ---------- Barre latérale ----------
  function renderList() {
    const q = $('#search').value.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    let html = '';
    for (let g = 1; g <= MAX_GEN; g++) {
      const items = DATA.filter(m => m.gen === g
        && (!q || m.id.replace(/-/g, ' ').includes(q))
        && (!state.onlyOwned || owned.has(m.id)));
      if (!items.length) continue;
      html += `<div class="gen-title">Génération ${g}</div>`;
      for (const m of items) {
        html += `<div class="item${m.id === state.selected ? ' sel' : ''}" data-id="${m.id}">
          <img src="${m.img}" alt="" loading="lazy">
          <span class="nm">${esc(m.name)}</span>
          <input type="checkbox" data-own="${m.id}" title="Je la possède" ${owned.has(m.id) ? 'checked' : ''}>
        </div>`;
      }
    }
    listEl.innerHTML = html || '<p style="color:var(--muted)">Aucun résultat.</p>';
    $('#ownedCount').textContent = `${owned.size}/${DATA.length} possédées`;
  }
  listEl.addEventListener('click', e => {
    const own = e.target.closest('[data-own]');
    if (own) { toggleOwned(own.dataset.own, own.checked); return; }
    const it = e.target.closest('.item');
    if (it) { select(it.dataset.id, true); setMenu(false); }
  });
  $('#search').addEventListener('input', renderList);
  $('#onlyOwned').checked = state.onlyOwned;
  $('#onlyOwned').addEventListener('change', e => { state.onlyOwned = e.target.checked; save(); renderList(); });

  function toggleOwned(id, on) {
    on ? owned.add(id) : owned.delete(id);
    save(); renderAll(false);
  }

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ owned: [...owned] }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'mes-dragodindes.json' });
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      owned.clear();
      (json.owned || []).filter(id => byId.has(id)).forEach(id => owned.add(id));
      save(); renderAll(false);
    } catch { alert('Fichier invalide.'); }
    e.target.value = '';
  });

  // ---------- Fiche détail ----------
  function pill(m, cls, role) {
    return `<span class="pill ${cls}" data-go="${m.id}">
      <img src="${m.img}" alt="">${role ? `<span class="role">${role}</span>` : ''}
      ${esc(m.name)} <span class="gbadge">G${m.gen}</span>${owned.has(m.id) ? ' <span class="owned-badge">✓</span>' : ''}
    </span>`;
  }
  function renderDetail() {
    const m = byId.get(state.selected);
    const ps = parentsOf(m);
    const kids = childrenOf.get(m.id);
    detailEl.innerHTML = `
      <div class="hero">
        <img src="${m.img}" alt="${esc(m.name)}">
        <div>
          <h2>${esc(m.name)}</h2>
          <div class="sub"><span class="gbadge">Génération ${m.gen}</span>
            <label class="chk"><input type="checkbox" data-own="${m.id}" ${owned.has(m.id) ? 'checked' : ''}> Je la possède</label>
          </div>
        </div>
      </div>
      <div class="recipe">${ps.length
        ? `${pill(ps[0], 'p1', ROLE[0])}<span class="op">+</span>${pill(ps[1], 'p2', ROLE[1])}`
        : '<span style="color:var(--muted)">Monture de base — capture sauvage</span>'}</div>
      ${kids.length ? `<details class="children" ${state.kidsOpen ? 'open' : ''}><summary>Sert à obtenir ${kids.length} monture${kids.length > 1 ? 's' : ''}</summary>${kids.map(k =>
        `<span class="kid">${pill(k.child, 'ch')}<span class="with">avec ${esc(k.partner.name)}</span></span>`).join('')}</details>` : ''}`;
    detailEl.querySelector('details')?.addEventListener('toggle', e => { state.kidsOpen = e.target.open; save(); });
  }
  detailEl.addEventListener('click', e => {
    const own = e.target.closest('[data-own]');
    if (own) { toggleOwned(own.dataset.own, own.checked); return; }
    const go = e.target.closest('[data-go]');
    if (go) select(go.dataset.go, true);
  });

  // ---------- Arbre d'ascendance ----------
  // Enfant à droite, ses deux parents à gauche : Parent 1 au-dessus (bleu), Parent 2 en dessous (orange).
  // La génération la plus haute est donc à droite, la plus basse à gauche.
  const T = { w: 220, h: 66, colGap: 70, rowGap: 14 };
  const expanded = new Map(); // chemin -> bool (surcharge de la profondeur par défaut)

  function isOpen(path, depth) {
    return expanded.has(path) ? expanded.get(path) : depth < state.depth;
  }
  function buildTree(m, depth = 0, path = 'r', role = null) {
    const node = { m, depth, path, role, kids: [] };
    if (m.parents && isOpen(path, depth)) {
      node.kids = parentsOf(m).map((p, i) => buildTree(p, depth + 1, `${path}.${i}`, i));
    }
    return node;
  }
  function layoutTree(root) {
    let row = 0; const nodes = [];
    (function walk(n) {
      n.x = n.depth * (T.w + T.colGap);
      if (n.kids.length) {
        n.kids.forEach(walk);
        n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2;
      } else {
        n.y = row++ * (T.h + T.rowGap);
      }
      nodes.push(n);
    })(root);
    return nodes;
  }
  function cardHTML(m, { x, y, w, h, cls = '', role = '', tog = '', extra = '' }) {
    return `<div class="card ${cls}" data-go="${m.id}" ${extra} style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
      <img src="${m.img}" alt="" loading="lazy">
      <div class="info">
        <div class="name">${esc(m.name)}</div>
        <div class="meta"><span class="gbadge">G${m.gen}</span>${role}</div>
      </div>
      ${owned.has(m.id) ? '<span class="owned" title="Possédée">✓</span>' : ''}
      ${tog}
    </div>`;
  }
  function renderTree() {
    canvas.className = 'canvas';
    const root = buildTree(byId.get(state.selected));
    const nodes = layoutTree(root);
    const maxX = Math.max(...nodes.map(n => n.x));
    if (fwd()) nodes.forEach(n => { n.x = maxX - n.x + 20; }); // miroir : la cible passe à droite
    const W = maxX + T.w + 20;
    const H = Math.max(...nodes.map(n => n.y)) + T.h;
    let paths = '', cards = '';
    for (const n of nodes) {
      for (const k of n.kids) {
        const x1 = fwd() ? k.x + T.w : k.x, y1 = k.y + T.h / 2;          // côté parent
        const x2 = fwd() ? n.x : n.x + T.w, y2 = n.y + T.h / 2, mx = (x1 + x2) / 2; // côté enfant
        const col = k.role === 0 ? 'var(--p1)' : 'var(--p2)';
        paths += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" stroke="${col}" stroke-width="3" fill="none"/>`;
        paths += `<circle cx="${x1}" cy="${y1}" r="4" fill="${col}"/>`;
      }
      const hasParents = !!n.m.parents;
      const open = n.kids.length > 0;
      const tog = hasParents
        ? `<button class="tog" data-tog="${n.path}" title="${open ? 'Replier' : 'Voir les parents'}">${open ? '−' : '+'}</button>` : '';
      const role = n.role === null
        ? (n.depth === 0 ? '<span class="role" style="color:var(--accent)">Cible</span>' : '')
        : `<span class="role">${ROLE[n.role]}</span>`;
      const note = !hasParents ? '<span>· sauvage</span>' : '';
      cards += cardHTML(n.m, {
        x: n.x, y: n.y, w: T.w, h: T.h,
        cls: n.depth === 0 ? 'root' : n.role === 0 ? 'p1' : 'p2',
        role: role + note, tog
      });
    }
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.innerHTML = `<svg width="${W}" height="${H}">${paths}</svg>${cards}`;
  }

  // ---------- Vue d'ensemble ----------
  const O = { w: 196, h: 48, colGap: 90, rowGap: 8, head: 30 };
  let ovPos = null;
  function renderOverview() {
    canvas.className = 'canvas ov focus';
    const sel = byId.get(state.selected);
    const ps = parentsOf(sel);
    const kids = childrenOf.get(sel.id).map(k => k.child);
    ovPos = new Map();
    let cards = '', heads = '', maxRows = 0;
    for (let g = 1; g <= MAX_GEN; g++) {
      const col = DATA.filter(m => m.gen === g);
      maxRows = Math.max(maxRows, col.length);
      const x = (fwd() ? g - 1 : MAX_GEN - g) * (O.w + O.colGap);
      heads += `<div class="colhead" style="left:${x}px;width:${O.w}px">Génération ${g}</div>`;
      col.forEach((m, i) => {
        const y = O.head + i * (O.h + O.rowGap);
        ovPos.set(m.id, { x, y });
        let cls = '', role = '';
        const pi = ps.indexOf(m);
        if (m === sel) cls = 'sel hl';
        else if (pi >= 0) { cls = `p${pi + 1} hl`; role = `<span class="role">${ROLE[pi]}</span>`; }
        else if (kids.includes(m)) { cls = 'ch hl'; role = '<span class="role" style="color:var(--ch)">Enfant</span>'; }
        cards += cardHTML(m, { x, y, w: O.w, h: O.h, cls, role });
      });
    }
    const W = MAX_GEN * (O.w + O.colGap) - O.colGap;
    const H = O.head + maxRows * (O.h + O.rowGap);
    const edge = (a, b, col, wdt) => {
      const p = ovPos.get(a.id), q = ovPos.get(b.id);
      const x1 = fwd() ? p.x + O.w : p.x, x2 = fwd() ? q.x : q.x + O.w;
      const y1 = p.y + O.h / 2, y2 = q.y + O.h / 2, mx = (x1 + x2) / 2;
      return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" stroke="${col}" stroke-width="${wdt}" fill="none"/>`;
    };
    let dim = '', hl = '';
    for (const m of DATA) parentsOf(m).forEach(p => { dim += edge(p, m, 'var(--edge-dim)', 1.5); });
    ps.forEach((p, i) => { hl += edge(p, sel, i ? 'var(--p2)' : 'var(--p1)', 3.5); });
    kids.forEach(k => { hl += edge(sel, k, 'var(--ch)', 3); });
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.innerHTML = `<svg width="${W}" height="${H}">${dim}${hl}</svg>${heads}${cards}`;
  }

  // ---------- Interactions canvas ----------
  canvas.addEventListener('click', e => {
    if (dragMoved) return;
    const t = e.target.closest('[data-tog]');
    if (t) {
      const path = t.dataset.tog, depth = path.split('.').length - 1;
      expanded.set(path, !isOpen(path, depth));
      renderTree();
      return;
    }
    const c = e.target.closest('[data-go]');
    if (c && c.dataset.go !== state.selected) select(c.dataset.go, false);
  });

  // Glisser pour se déplacer
  let drag = null, dragMoved = false;
  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    drag = { x: e.clientX, y: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop };
    dragMoved = false;
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragMoved && Math.hypot(dx, dy) < 5) return;
    dragMoved = true; viewport.classList.add('drag');
    viewport.scrollLeft = drag.sl - dx; viewport.scrollTop = drag.st - dy;
  });
  window.addEventListener('pointerup', () => {
    drag = null; viewport.classList.remove('drag');
    setTimeout(() => { dragMoved = false; }, 0);
  });

  // ---------- Zoom ----------
  function applyZoom() {
    canvas.style.zoom = state.zoom;
    $('#zoomVal').textContent = Math.round(state.zoom * 100) + '%';
  }
  function setZoom(z) { state.zoom = Math.min(2, Math.max(0.2, Math.round(z * 100) / 100)); applyZoom(); save(); }
  $('#zoomIn').addEventListener('click', () => setZoom(state.zoom + 0.1));
  $('#zoomOut').addEventListener('click', () => setZoom(state.zoom - 0.1));
  $('#zoomFit').addEventListener('click', () => {
    const w = parseFloat(canvas.style.width) + 48, h = parseFloat(canvas.style.height) + 48;
    setZoom(Math.min(1, viewport.clientWidth / w, viewport.clientHeight / h));
    viewport.scrollTo(0, 0);
  });
  viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });

  // ---------- Profondeur ----------
  $('#depth').value = String(state.depth);
  $('#depth').addEventListener('change', e => {
    state.depth = +e.target.value; expanded.clear(); save(); renderCanvas();
  });

  // ---------- Liste de courses ----------
  // Hypothèse : chaque accouplement consomme 1 exemplaire de chaque parent et donne 1 bébé de la monture visée.
  // Une monture cochée « possédée » compte pour 1 exemplaire disponible (sauf la cible elle-même).
  const planEl = $('#plan');
  function computePlan(target, qty) {
    const need = new Map([[target.id, qty]]);
    const rows = [];
    const byGenDesc = [...DATA].sort((a, b) => b.gen - a.gen);
    for (const m of byGenDesc) {
      const n = need.get(m.id) || 0;
      if (!n) continue;
      const use = m === target ? 0 : Math.min(owned.has(m.id) ? 1 : 0, n);
      const make = n - use;
      rows.push({ m, need: n, use, make });
      if (make && m.parents) parentsOf(m).forEach(p => need.set(p.id, (need.get(p.id) || 0) + make));
    }
    rows.reverse(); // de la génération la plus basse à la plus haute
    return {
      rows,
      captures: rows.filter(r => !r.m.parents && r.make),
      breedings: rows.filter(r => r.m.parents && r.make),
      fromStock: rows.filter(r => r.use),
    };
  }
  function mini(m, cls = '') {
    return `<span class="pill ${cls}"><img src="${m.img}" alt="">${esc(m.name)} <span class="gbadge">G${m.gen}</span></span>`;
  }
  function renderPlan() {
    const target = byId.get(state.selected);
    const qty = state.planQty;
    const plan = computePlan(target, qty);
    const done = state.planDone[target.id] || {};
    const steps = [...plan.captures, ...plan.breedings];
    const nDone = steps.filter(r => done[r.m.id]).length;
    const nCaptures = plan.captures.reduce((t, r) => t + r.make, 0);
    const nBreed = plan.breedings.reduce((t, r) => t + r.make, 0);
    const pct = steps.length ? Math.round(nDone / steps.length * 100) : 100;

    const stepRow = (r, body) => `
      <label class="step${done[r.m.id] ? ' done' : ''}">
        <input type="checkbox" data-done="${r.m.id}" ${done[r.m.id] ? 'checked' : ''}>
        <span class="qty">×${r.make}</span>
        ${body}
        ${r.use ? `<span class="stocknote">besoin ${r.need} · 1 dans ton stock</span>` : ''}
      </label>`;

    let html = `
      <div class="plan-head">
        <div class="goal">
          <img src="${target.img}" alt="">
          <div>
            <div class="lbl">Objectif</div>
            <div class="gname">${esc(target.name)} <span class="gbadge">G${target.gen}</span></div>
            ${owned.has(target.id) ? '<div class="lbl">Tu en possèdes déjà une : calcul pour en obtenir en plus.</div>' : ''}
          </div>
          <label class="qtyin">Quantité <input type="number" id="planQty" min="1" max="50" value="${qty}"></label>
        </div>
        <div class="tiles">
          <div class="tile"><b>${nCaptures}</b><span>G1 à capturer</span></div>
          <div class="tile"><b>${nBreed}</b><span>accouplements</span></div>
          <div class="tile"><b>${plan.fromStock.length}</b><span>pris dans ton stock</span></div>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="plan-actions">
          <span>${nDone}/${steps.length} étapes faites</span>
          <button id="planCopy">Copier la liste</button>
          <button id="planReset">Réinitialiser les coches</button>
        </div>
      </div>`;

    if (!steps.length) {
      html += `<p class="empty">Rien à faire : tout est déjà dans ton stock.</p>`;
    }
    if (plan.captures.length) {
      html += `<h3>Étape 1 · Captures sauvages <span class="gbadge">G1</span></h3>` +
        plan.captures.map(r => stepRow(r, mini(r.m))).join('');
    }
    const gens = [...new Set(plan.breedings.map(r => r.m.gen))];
    gens.forEach((g, i) => {
      html += `<h3>Étape ${i + (plan.captures.length ? 2 : 1)} · Accouplements génération ${g}</h3>`;
      html += plan.breedings.filter(r => r.m.gen === g).map(r => {
        const [p1, p2] = parentsOf(r.m);
        const parents = `${mini(p1, 'p1')}<span class="op">+</span>${mini(p2, 'p2')}`;
        return stepRow(r, fwd()
          ? `${parents}<span class="op">=</span>${mini(r.m, 'ch')}`
          : `${mini(r.m, 'ch')}<span class="op">=</span>${parents}`);
      }).join('');
    });
    if (plan.fromStock.length) {
      html += `<h3>Pris dans ton stock</h3><div class="stock">${plan.fromStock.map(r => mini(r.m)).join('')}</div>`;
    }
    html += `<p class="hint">Hypothèse : chaque accouplement consomme un exemplaire de chaque parent et donne un bébé de la monture visée.
      Une monture cochée « possédée » compte pour un exemplaire. Les échecs éventuels ne sont pas comptés.</p>`;
    planEl.innerHTML = html;

    planEl.querySelector('#planQty').addEventListener('change', e => {
      state.planQty = Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)); save(); renderPlan();
    });
    planEl.querySelector('#planReset').addEventListener('click', () => {
      delete state.planDone[target.id]; save(); renderPlan();
    });
    planEl.querySelector('#planCopy').addEventListener('click', e => {
      const lines = [`Liste de courses : ${qty} × ${target.name} (G${target.gen})`,
        `${nCaptures} captures G1 · ${nBreed} accouplements`, ''];
      if (plan.captures.length) {
        lines.push('Captures :');
        plan.captures.forEach(r => lines.push(`- ${r.make} × ${r.m.name}`));
      }
      gens.forEach(g => {
        lines.push('', `Génération ${g} :`);
        plan.breedings.filter(r => r.m.gen === g).forEach(r =>
          lines.push(fwd()
            ? `- ${r.make} × ${r.m.parents[0]} + ${r.m.parents[1]} = ${r.m.name}`
            : `- ${r.make} × ${r.m.name} = ${r.m.parents[0]} + ${r.m.parents[1]}`));
      });
      if (plan.fromStock.length) lines.push('', 'Pris dans le stock : ' + plan.fromStock.map(r => r.m.name).join(', '));
      navigator.clipboard.writeText(lines.join('\n')).then(
        () => { e.target.textContent = 'Copié !'; setTimeout(() => { e.target.textContent = 'Copier la liste'; }, 1500); },
        () => alert(lines.join('\n')));
    });
  }
  planEl.addEventListener('change', e => {
    const d = e.target.closest('[data-done]');
    if (!d) return;
    const t = (state.planDone[state.selected] ||= {});
    d.checked ? (t[d.dataset.done] = true) : delete t[d.dataset.done];
    save(); renderPlan();
  });

  // ---------- Thème clair / sombre ----------
  // Tant que l'utilisatrice n'a pas choisi, on suit le thème du système.
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => state.theme ? state.theme === 'dark' : systemDark.matches;
  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme;
    else delete document.documentElement.dataset.theme;
    const b = $('#themeBtn');
    b.textContent = isDark() ? '☀️' : '🌙';
    b.title = isDark() ? 'Passer en thème clair' : 'Passer en thème sombre';
  }
  $('#themeBtn').addEventListener('click', () => { state.theme = isDark() ? 'light' : 'dark'; save(); applyTheme(); });
  systemDark.addEventListener('change', applyTheme);
  applyTheme();

  // ---------- Tiroir des montures (mobile) ----------
  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    $('#menuBtn').setAttribute('aria-expanded', open);
  }
  $('#menuBtn').addEventListener('click', () => {
    setMenu(true);
    listEl.querySelector('.item.sel')?.scrollIntoView({ block: 'center' });
  });
  $('#closeMenu').addEventListener('click', () => setMenu(false));
  $('#backdrop').addEventListener('click', () => setMenu(false));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  mobileMQ.addEventListener('change', () => setMenu(false));

  // ---------- Pincer pour zoomer (tactile) ----------
  let pinch = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  viewport.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) { pinch = null; return; }
    const r = viewport.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    pinch = { d: dist(e.touches), z: state.zoom, mx, my,
      cx: (viewport.scrollLeft + mx) / state.zoom, cy: (viewport.scrollTop + my) / state.zoom };
  }, { passive: true });
  viewport.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    setZoom(pinch.z * dist(e.touches) / pinch.d);
    // garde le point entre les doigts à la même place à l'écran
    viewport.scrollLeft = pinch.cx * state.zoom - pinch.mx;
    viewport.scrollTop = pinch.cy * state.zoom - pinch.my;
  }, { passive: false });
  viewport.addEventListener('touchend', () => { pinch = null; });

  // ---------- Sens de lecture ----------
  $('#dirBtn').addEventListener('click', () => {
    state.fwd = !fwd(); save(); renderAll(true); centerOverview('auto');
  });

  // ---------- Onglets ----------
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view; save(); renderAll(true); centerOverview('auto');
  }));

  // ---------- Rendu global ----------
  function renderCanvas() {
    if (state.view === 'plan') { renderPlan(); return; }
    state.view === 'tree' ? renderTree() : renderOverview(); applyZoom();
  }
  function renderAll(resetScroll) {
    document.body.dataset.view = state.view;
    document.body.classList.toggle('rev', !fwd());
    $('#dirBtn').innerHTML = `<span class="lg">Sens : </span>${fwd() ? 'Parents → Enfant' : 'Enfant ← Parents'}`;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    renderList(); renderDetail(); renderCanvas();
    if (resetScroll) {
      if (state.view === 'tree') { // on se place sur la cible (à droite ou à gauche selon le sens)
        const root = canvas.querySelector('.card.root');
        viewport.scrollTo(fwd() ? viewport.scrollWidth : 0, root ? root.offsetTop * state.zoom - viewport.clientHeight / 2 : 0);
      } else viewport.scrollTo(0, 0);
      planEl.scrollTo(0, 0);
    }
  }
  function select(id, scrollList) {
    state.selected = id; expanded.clear(); save();
    renderAll(state.view === 'tree');
    centerOverview('smooth');
    if (scrollList !== true) listEl.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function centerOverview(behavior) {
    if (state.view !== 'overview') return;
    const p = ovPos.get(state.selected);
    viewport.scrollTo({ left: p.x * state.zoom - viewport.clientWidth / 3, top: p.y * state.zoom - viewport.clientHeight / 3, behavior });
  }

  renderAll(true);
  centerOverview('auto');
  listEl.querySelector('.item.sel')?.scrollIntoView({ block: 'center' });
})();
