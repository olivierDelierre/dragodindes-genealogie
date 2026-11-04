(() => {
  'use strict';

  const DATA = window.MOUNTS;
  const byId = new Map(DATA.map(m => [m.id, m]));
  const FAMILIES = [
    { id: 'dragodinde', label: 'dragodindes', one: 'dragodinde' },
    { id: 'muldo', label: 'muldos', one: 'muldo' },
    { id: 'volkorne', label: 'volkornes', one: 'volkorne' },
  ];
  const famMounts = new Map(FAMILIES.map(f => [f.id, DATA.filter(m => m.type === f.id)]));

  // ---------- Stockage local ----------
  const STORE_KEY = 'dragodindes-genealogie-v1';
  const AUTH_KEY = 'haras-auth-v1';
  const state = Object.assign(
    { type: 'dragodinde', selected: null, sel: {}, rc: {}, view: 'tree', depth: 3, zoom: 1, owned: [], onlyOwned: false, planQty: 1, planDone: {}, gauge: { fence: 200000, cur: 0, target: 20000 }, fwd: true, theme: null },
    load()
  );
  // Anciennes sauvegardes (dragodindes seules, ids sans préfixe)
  const legacy = id => (typeof id === 'string' && !id.includes(':') ? 'd:' + id : id);
  if (state.selected && !state.selected.includes(':')) { state.planDone = {}; }
  state.selected = legacy(state.selected);
  state.owned = (state.owned || []).map(legacy);
  const mobileMQ = matchMedia('(max-width: 760px)');
  // Sur petit écran, on démarre un peu dézoomé tant que l'utilisatrice n'a pas choisi de zoom.
  if (load().zoom === undefined && mobileMQ.matches) state.zoom = 0.8;
  const owned = new Set(state.owned);
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  // En mode compte, les montures possédées vivent sur le serveur : on ne les garde pas dans le navigateur
  // (un autre pseudo sur le même appareil ne doit pas les voir).
  function save() {
    const out = Object.assign({}, state, { owned: account.user ? [] : [...owned] });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch { /* stockage indisponible */ }
  }
  const fam = () => famMounts.get(state.type);
  const MAX_GEN = 10;
  if (!famMounts.has(state.type)) state.type = 'dragodinde';
  if (!byId.has(state.selected) || byId.get(state.selected).type !== state.type) {
    state.selected = state.sel[state.type] && byId.has(state.sel[state.type]) ? state.sel[state.type] : fam()[fam().length - 1].id;
  }
  state.sel[state.type] = state.selected;

  // ---------- Recettes ----------
  // Une monture peut avoir plusieurs recettes (couples de parents) ; state.rc[id] mémorise celle qui est choisie.
  const rcIndex = m => Math.min(state.rc[m.id] || 0, (m.recipes ? m.recipes.length : 1) - 1);
  const recipeOf = m => (m.recipes ? m.recipes[rcIndex(m)] : null);
  const parentsOf = m => (recipeOf(m) || []).map(id => byId.get(id));
  const recipeText = r => r.map(id => byId.get(id).name).join(' + ');
  // Enfants de chaque monture : [{ child, partner, role, rc }] (toutes recettes confondues)
  const childrenOf = new Map(DATA.map(m => [m.id, []]));
  for (const m of DATA) {
    (m.recipes || []).forEach((r, rc) => r.forEach((pid, i) => {
      childrenOf.get(pid).push({ child: m, partner: byId.get(r[1 - i]), role: i, rc });
    }));
  }

  // ---------- Éléments ----------
  const $ = s => document.querySelector(s);
  const listEl = $('#list'), detailEl = $('#detail'), canvas = $('#canvas'), viewport = $('#viewport');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ROLE = ['Parent 1', 'Parent 2'];
  // Sens de lecture : true = parents à gauche → enfant à droite ; false = enfant à gauche ← parents à droite.
  const fwd = () => state.fwd !== false;

  // ---------- Barre latérale ----------
  function renderList() {
    const q = norm($('#search').value.trim());
    let html = '';
    for (let g = 1; g <= MAX_GEN; g++) {
      const items = fam().filter(m => m.gen === g
        && (!q || norm(m.name).includes(q))
        && (!state.onlyOwned || owned.has(m.id)));
      if (!items.length) continue;
      html += `<div class="gen-title">Génération ${g}</div>`;
      for (const m of items) {
        html += `<div class="item${m.id === state.selected ? ' sel' : ''}" data-id="${m.id}">
          <img data-mid="${m.id}" src="${m.img}" alt="" loading="lazy">
          <span class="nm">${esc(m.name)}</span>
          <input type="checkbox" data-own="${m.id}" title="Je la possède" ${owned.has(m.id) ? 'checked' : ''}>
        </div>`;
      }
    }
    listEl.innerHTML = html || '<p style="color:var(--muted)">Aucun résultat.</p>';
    document.querySelectorAll('#famTabs .chip').forEach(b => {
      const ms = famMounts.get(b.dataset.fam);
      b.querySelector('b').textContent = `${ms.filter(m => owned.has(m.id)).length}/${ms.length}`;
    });
    $('#ownedCount').textContent = `${fam().filter(m => owned.has(m.id)).length}/${fam().length} possédées`;
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
    save(); scheduleSync(); renderAll(false);
  }

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ owned: [...owned] }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'haras-montures.json' });
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      owned.clear();
      (json.owned || []).map(legacy).filter(id => byId.has(id)).forEach(id => owned.add(id));
      save(); scheduleSync(); renderAll(false);
    } catch { alert('Fichier invalide.'); }
    e.target.value = '';
  });

  // ---------- Fiche détail ----------
  function pill(m, cls, role, rc) {
    return `<span class="pill ${cls}" data-go="${m.id}"${rc === undefined ? '' : ` data-rc="${rc}"`}>
      <img data-mid="${m.id}" src="${m.img}" alt="">${role ? `<span class="role">${role}</span>` : ''}
      ${esc(m.name)} <span class="gbadge">G${m.gen}</span>${owned.has(m.id) ? ' <span class="owned-badge">✓</span>' : ''}
    </span>`;
  }
  function renderDetail() {
    const m = byId.get(state.selected);
    const ps = parentsOf(m);
    const kids = childrenOf.get(m.id);
    detailEl.innerHTML = `
      <div class="hero">
        <img data-mid="${m.id}" src="${m.img}" alt="${esc(m.name)}">
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
      ${m.recipes && m.recipes.length > 1 ? `<div class="alts"><span>${m.recipes.length} recettes possibles :</span>${m.recipes.map((r, i) =>
        `<button class="br-btn br-btn--sm ${i === rcIndex(m) ? 'br-btn--primary' : 'br-btn--secondary'}" data-rcset="${i}" aria-pressed="${i === rcIndex(m)}">${esc(recipeText(r))}</button>`).join('')}</div>` : ''}
      ${kids.length ? `<details class="children" ${state.kidsOpen ? 'open' : ''}><summary>Sert à obtenir ${kids.length} monture${kids.length > 1 ? 's' : ''}</summary>${kids.map(k =>
        `<span class="kid">${pill(k.child, 'ch', '', k.rc)}<span class="with">avec ${esc(k.partner.name)}</span></span>`).join('')}</details>` : ''}`;
    detailEl.querySelector('details')?.addEventListener('toggle', e => { state.kidsOpen = e.target.open; save(); });
  }
  detailEl.addEventListener('click', e => {
    const own = e.target.closest('[data-own]');
    if (own) { toggleOwned(own.dataset.own, own.checked); return; }
    const set = e.target.closest('[data-rcset]');
    if (set) { state.rc[state.selected] = +set.dataset.rcset; save(); renderAll(false); return; }
    const go = e.target.closest('[data-go]');
    if (go) select(go.dataset.go, true, go.dataset.rc);
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
    if (m.recipes && isOpen(path, depth)) {
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
      <img data-mid="${m.id}" src="${m.img}" alt="" loading="lazy">
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
      const hasParents = !!n.m.recipes;
      const open = n.kids.length > 0;
      const tog = (hasParents
        ? `<button class="tog" data-tog="${n.path}" title="${open ? 'Replier' : 'Voir les parents'}">${open ? '−' : '+'}</button>` : '')
        + (n.m.recipes && n.m.recipes.length > 1
          ? `<button class="cyc" data-cyc="${n.m.id}" title="Changer de recette : ${esc(recipeText(n.m.recipes[rcIndex(n.m)]))}">↻ ${rcIndex(n.m) + 1}/${n.m.recipes.length}</button>` : '');
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
      const col = fam().filter(m => m.gen === g);
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
    for (const m of fam()) parentsOf(m).forEach(p => { dim += edge(p, m, 'var(--edge-dim)', 1.5); });
    ps.forEach((p, i) => { hl += edge(p, sel, i ? 'var(--p2)' : 'var(--p1)', 3.5); });
    kids.forEach(k => { hl += edge(sel, k, 'var(--ch)', 3); });
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.innerHTML = `<svg width="${W}" height="${H}">${dim}${hl}</svg>${heads}${cards}`;
  }

  // ---------- Interactions canvas ----------
  canvas.addEventListener('click', e => {
    if (dragMoved) return;
    const cy = e.target.closest('[data-cyc]');
    if (cy) {
      const m = byId.get(cy.dataset.cyc);
      state.rc[m.id] = (rcIndex(m) + 1) % m.recipes.length; save(); expanded.clear(); renderTree(); renderDetail();
      return;
    }
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
    const byGenDesc = [...fam()].sort((a, b) => b.gen - a.gen);
    for (const m of byGenDesc) {
      const n = need.get(m.id) || 0;
      if (!n) continue;
      const use = m === target ? 0 : Math.min(owned.has(m.id) ? 1 : 0, n);
      const make = n - use;
      rows.push({ m, need: n, use, make });
      if (make && m.recipes) parentsOf(m).forEach(p => need.set(p.id, (need.get(p.id) || 0) + make));
    }
    rows.reverse(); // de la génération la plus basse à la plus haute
    return {
      rows,
      captures: rows.filter(r => !r.m.recipes && r.make),
      breedings: rows.filter(r => r.m.recipes && r.make),
      fromStock: rows.filter(r => r.use),
    };
  }
  function mini(m, cls = '') {
    return `<span class="pill ${cls}"><img data-mid="${m.id}" src="${m.img}" alt="">${esc(m.name)} <span class="gbadge">G${m.gen}</span></span>`;
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
          <img data-mid="${target.id}" src="${target.img}" alt="">
          <div>
            <div class="lbl">Objectif</div>
            <div class="gname">${esc(target.name)} <span class="gbadge">G${target.gen}</span></div>
            ${owned.has(target.id) ? '<div class="lbl">Tu en possèdes déjà une : calcul pour en obtenir en plus.</div>' : ''}
          </div>
          <label class="qtyin">Quantité <input class="br-input" type="number" id="planQty" min="1" max="50" value="${qty}"></label>
        </div>
        <div class="tiles">
          <div class="tile"><b>${nCaptures}</b><span>G1 à capturer</span></div>
          <div class="tile"><b>${nBreed}</b><span>accouplements</span></div>
          <div class="tile"><b>${plan.fromStock.length}</b><span>pris dans ton stock</span></div>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="plan-actions">
          <span>${nDone}/${steps.length} étapes faites</span>
          <button id="planCopy" class="br-btn br-btn--primary br-btn--sm">Copier la liste</button>
          <button id="planReset" class="br-btn br-btn--ghost br-btn--sm">Réinitialiser les coches</button>
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
        const choice = r.m.recipes.length > 1
          ? `<select class="br-input br-input--sm rc-sel" data-rcsel="${r.m.id}" title="Recette utilisée" aria-label="Recette de ${esc(r.m.name)}">${r.m.recipes.map((rc, i) =>
            `<option value="${i}"${i === rcIndex(r.m) ? ' selected' : ''}>Recette ${i + 1}/${r.m.recipes.length} · ${esc(recipeText(rc))}</option>`).join('')}</select>` : '';
        return stepRow(r, (fwd()
          ? `${parents}<span class="op">=</span>${mini(r.m, 'ch')}`
          : `${mini(r.m, 'ch')}<span class="op">=</span>${parents}`) + choice);
      }).join('');
    });
    if (plan.fromStock.length) {
      html += `<h3>Pris dans ton stock</h3><div class="stock">${plan.fromStock.map(r => mini(r.m)).join('')}</div>`;
    }
    html += `<p class="hint">Hypothèse : chaque accouplement consomme un exemplaire de chaque parent et donne un bébé de la monture visée.
      Une monture cochée « possédée » compte pour un exemplaire. Quand une monture a plusieurs recettes, la liste suit celle que tu as choisie. Les échecs éventuels ne sont pas comptés.</p>`;
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
            ? `- ${r.make} × ${parentsOf(r.m).map(p => p.name).join(' + ')} = ${r.m.name}`
            : `- ${r.make} × ${r.m.name} = ${parentsOf(r.m).map(p => p.name).join(' + ')}`));
      });
      if (plan.fromStock.length) lines.push('', 'Pris dans le stock : ' + plan.fromStock.map(r => r.m.name).join(', '));
      navigator.clipboard.writeText(lines.join('\n')).then(
        () => { e.target.textContent = 'Copié !'; setTimeout(() => { e.target.textContent = 'Copier la liste'; }, 1500); },
        () => alert(lines.join('\n')));
    });
  }
  planEl.addEventListener('change', e => {
    const rs = e.target.closest('[data-rcsel]');
    if (rs) { state.rc[rs.dataset.rcsel] = +rs.value; save(); renderPlan(); return; }
    const d = e.target.closest('[data-done]');
    if (!d) return;
    const t = (state.planDone[state.selected] ||= {});
    d.checked ? (t[d.dataset.done] = true) : delete t[d.dataset.done];
    save(); renderPlan();
  });


  // ---------- Jauge d'enclos : temps pour remplir la jauge d'une monture ----------
  // Règles (Dofus 3.7) : la jauge d'enclos (0 à 200 000) se vide toutes les 10 s au rythme du palier où elle se trouve,
  // et chaque monture gagne autant de points que la jauge d'enclos en perd, quel que soit le nombre de montures.
  // Une jauge de monture (endurance, maturité, amour) va de 0 à 20 000.
  const TICK = 10, MOUNT_GAUGE_MAX = 20000, FENCE_MAX = 200000;
  const TIERS = [
    { n: 1, from: 0, to: 80000, rate: 10 },
    { n: 2, from: 80000, to: 140000, rate: 20 },
    { n: 3, from: 140000, to: 180000, rate: 30 },
    { n: 4, from: 180000, to: 200000, rate: 40 },
  ];
  /** Durée pour consommer `need` points en partant d'une jauge d'enclos à `level`, palier par palier (du haut vers le bas). */
  function drain(level, need) {
    let remaining = Math.min(need, level), pos = level;
    const parts = [];
    for (let i = TIERS.length - 1; i >= 0 && remaining > 0; i--) {
      const t = TIERS[i];
      const top = Math.min(pos, t.to);
      const points = Math.min(remaining, top - t.from);
      if (points <= 0) continue;
      parts.push({ tier: t, from: top, to: top - points, points, seconds: points / t.rate * TICK });
      remaining -= points; pos = top - points;
    }
    return { parts, points: parts.reduce((s, p) => s + p.points, 0), seconds: Math.ceil(parts.reduce((s, p) => s + p.seconds, 0)) };
  }
  const fmtInt = n => Math.round(n).toLocaleString('fr-FR');
  function fmtDuration(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return [h ? `${h} h` : '', (h || m) ? `${String(m).padStart(h ? 2 : 1, '0')} min` : '', !h || s ? `${s} s` : ''].filter(Boolean).join(' ') || '0 s';
  }
  const gaugeEl = $('#gauge');
  const clampInt = (v, max) => Math.min(max, Math.max(0, Math.round(+v) || 0));
  function renderGauge() {
    if (!gaugeEl.querySelector('form')) {
      gaugeEl.innerHTML = `
        <form class="plan-head gauge-form" autocomplete="off">
          <div class="gauge-intro">
            <div class="gname">Temps pour remplir une jauge</div>
            <div class="lbl">La jauge d'enclos se vide plus vite quand elle est pleine ; la monture gagne autant de points qu'elle en perd.</div>
          </div>
          <div class="gauge-fields">
            <label class="gfield">Jauge d'enclos <span class="lbl">0 à 200 000</span>
              <input class="br-input" type="number" id="gFence" min="0" max="${FENCE_MAX}" step="1000" inputmode="numeric"></label>
            <label class="gfield">Jauge de la monture <span class="lbl">actuelle, 0 à 20 000</span>
              <input class="br-input" type="number" id="gCur" min="0" max="${MOUNT_GAUGE_MAX}" step="100" inputmode="numeric"></label>
            <label class="gfield">Objectif <span class="lbl">0 à 20 000</span>
              <input class="br-input" type="number" id="gTarget" min="0" max="${MOUNT_GAUGE_MAX}" step="100" inputmode="numeric"></label>
          </div>
          <div class="gauge-presets">
            <button type="button" class="br-btn br-btn--ghost br-btn--sm" data-gset="fence" data-v="${FENCE_MAX}">Enclos plein</button>
            <button type="button" class="br-btn br-btn--ghost br-btn--sm" data-gset="cur" data-v="0">Monture à 0</button>
            <button type="button" class="br-btn br-btn--ghost br-btn--sm" data-gset="target" data-v="${MOUNT_GAUGE_MAX}">Objectif max</button>
          </div>
        </form>
        <div id="gaugeOut"></div>`;
      const sync = () => {
        const g = state.gauge;
        g.fence = clampInt($('#gFence').value, FENCE_MAX); g.cur = clampInt($('#gCur').value, MOUNT_GAUGE_MAX); g.target = clampInt($('#gTarget').value, MOUNT_GAUGE_MAX);
        save(); renderGaugeOut();
      };
      gaugeEl.addEventListener('input', e => { if (e.target.matches('input')) sync(); });
      gaugeEl.addEventListener('change', e => { if (e.target.matches('input')) { fillGaugeInputs(); } });
      gaugeEl.addEventListener('click', e => {
        const b = e.target.closest('[data-gset]'); if (!b) return;
        state.gauge[b.dataset.gset] = +b.dataset.v; save(); fillGaugeInputs(); renderGaugeOut();
      });
    }
    fillGaugeInputs(); renderGaugeOut();
  }
  function fillGaugeInputs() {
    const g = state.gauge;
    $('#gFence').value = g.fence; $('#gCur').value = g.cur; $('#gTarget').value = g.target;
  }
  function renderGaugeOut() {
    const g = state.gauge, need = Math.max(0, g.target - g.cur);
    const r = drain(g.fence, need), full = drain(g.fence, g.fence);
    const short = need > g.fence;
    const end = new Date(Date.now() + r.seconds * 1000);
    const endTxt = end.toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    let html = `<div class="plan-head gauge-out">
      <div class="tiles">
        <div class="tile"><b>${need ? fmtDuration(r.seconds) : '0 s'}</b><span>pour gagner ${fmtInt(r.points)} points</span></div>
        <div class="tile"><b>${need ? endTxt : '—'}</b><span>fin estimée si lancé maintenant</span></div>
        <div class="tile"><b>${fmtDuration(full.seconds)}</b><span>pour vider tout l'enclos (${fmtInt(g.fence)})</span></div>
      </div>
      ${short ? `<p class="gauge-warn" role="alert"><strong>Enclos insuffisant :</strong> il ne reste que ${fmtInt(g.fence)} points pour les ${fmtInt(need)} demandés. La monture n'atteindra que ${fmtInt(Math.min(MOUNT_GAUGE_MAX, g.cur + g.fence))}.</p>` : ''}
      ${g.target <= g.cur ? '<p class="gauge-warn">L\'objectif est déjà atteint : rien à remplir.</p>' : ''}
    </div>`;
    if (r.parts.length) {
      html += `<h3>Détail par palier</h3>`;
      html += r.parts.map(p => `<div class="step">
        <span class="gbadge">Palier ${p.tier.n}</span>
        <span class="qty">${fmtDuration(p.seconds)}</span>
        <span class="lbl">enclos de ${fmtInt(p.from)} à ${fmtInt(p.to)} · ${fmtInt(p.points)} points à ${p.tier.rate} toutes les ${TICK} s</span>
      </div>`).join('');
    }
    html += `<h3>Les 4 paliers de l'enclos</h3><div class="gauge-tiers">` + TIERS.map(t => {
      const sec = (t.to - t.from) / t.rate * TICK;
      return `<div class="tile"><span>Palier ${t.n} · ${fmtInt(t.from)} à ${fmtInt(t.to)}</span><b>${t.rate} / ${TICK} s</b><span>${fmtDuration(sec)} pour le vider</span></div>`;
    }).join('') + `</div>
      <p class="hint">Hypothèse : le palier utilisé est celui de la jauge d'enclos à l'instant considéré ; le nombre de montures dans l'enclos ne change pas la vitesse.
      Source : Dofus pour les Noobs, guide de l'éleveur (paliers de la version 3.7).</p>`;
    $('#gaugeOut').innerHTML = html;
  }

  // ---------- Petit « pop » au clic sur un bouton Brume ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('.br-btn');
    if (!b) return;
    b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
  });
  document.addEventListener('animationend', e => e.target.classList?.remove('is-pop'));

  // ---------- Thème clair / sombre ----------
  // Tant que l'utilisatrice n'a pas choisi (« Auto »), on suit le thème du système.
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme;
    else delete document.documentElement.dataset.theme;
    markSeg('#themeSeg', 'themeSet', state.theme || 'auto');
  }
  systemDark.addEventListener('change', applyTheme);

  // ---------- Popup d'options (bouton engrenage) ----------
  const optBtn = $('#optBtn'), optPop = $('#options');
  function markSeg(sel, key, val) {
    document.querySelectorAll(sel + ' button').forEach(b => {
      const on = b.dataset[key] === val;
      b.classList.toggle('br-btn--primary', on); b.classList.toggle('br-btn--secondary', !on);
      b.setAttribute('aria-pressed', on);
    });
  }
  function placeOptions() { // la popup est hors de l'en-tête : on l'ancre sous l'engrenage
    const r = optBtn.getBoundingClientRect();
    optPop.style.top = Math.round(r.bottom + 8) + 'px';
    optPop.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px';
  }
  window.addEventListener('resize', () => { if (!optPop.hidden) placeOptions(); });
  function setOptions(open) {
    if (open) placeOptions();
    optPop.hidden = !open;
    optBtn.setAttribute('aria-expanded', open);
    if (open) optPop.querySelector('button')?.focus({ preventScroll: true });
  }
  optBtn.addEventListener('click', () => setOptions(optPop.hidden));
  document.addEventListener('click', e => {
    if (!optPop.hidden && !e.target.closest('.opt-wrap, #options')) setOptions(false);
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !optPop.hidden) { setOptions(false); optBtn.focus(); } });
  $('#themeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-theme-set]'); if (!b) return;
    state.theme = b.dataset.themeSet === 'auto' ? null : b.dataset.themeSet; save(); applyTheme();
  });
  $('#dirSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-dir-set]'); if (!b) return;
    const f = b.dataset.dirSet === 'fwd';
    if (f === fwd()) return;
    state.fwd = f; save(); renderAll(true); centerOverview('auto');
  });
  $('#logoutBtn').addEventListener('click', logout);
  applyTheme();


  // ---------- Fiche de stats au survol de l'image d'une monture ----------
  // Même principe que les fiches d'objets de dofus-job : carte en verre Brume dans le <body>, ouverte après un court
  // délai, placée au-dessus de l'image (ou dessous s'il n'y a pas la place), sans jamais capter la souris.
  const TIP_LABEL = { dragodinde: 'Dragodinde', muldo: 'Muldo', volkorne: 'Volkorne' };
  const tip = Object.assign(document.createElement('div'), { className: 'mount-tip br-glass', hidden: true });
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let tipTimer = null, tipFor = null;
  // Icônes des caractéristiques (images/stats). Les dommages élémentaires reprennent l'icône de la caractéristique
  // de l'élément ; sans icône connue (poussée, retrait…), la ligne garde un emplacement vide pour rester alignée.
  const STAT_ICON = {
    'PA': 'actionPoints', 'PM': 'movementPoints', 'Vitalité': 'vitality', 'Critique': 'crit', 'Initiative': 'initiative',
    'Soins': 'heal', 'Prospection': 'prospecting', 'Portée': 'range', 'Puissance': 'damagesPercent',
    'Force': 'strength', 'Intelligence': 'intelligence', 'Chance': 'chance', 'Agilité': 'agility',
    'Fuite': 'escape', 'Tacle': 'tackle', 'Esquive PA': 'dodgeAP', 'Esquive PM': 'dodgeMP',
    'Dommages Critiques': 'criticalDamage', 'Dommages Poussée': 'damage',
    'Dommages Terre': 'strength', 'Dommages Feu': 'intelligence', 'Dommages Eau': 'chance', 'Dommages Air': 'agility',
    'Résistance Terre': 'res_earth', 'Résistance Feu': 'res_fire', 'Résistance Eau': 'res_water', 'Résistance Air': 'res_air',
    'Invocation': 'summonableCreaturesBoost', 'Invocations': 'summonableCreaturesBoost',
  };
  function statRow(s) {
    const m = /^(-?\d+)(%?)\s+(.+)$/.exec(s);
    const label = m ? m[3] : s, icon = STAT_ICON[label];
    const img = icon ? `<img class="st-ico" src="images/stats/${icon}.png" alt="" draggable="false">` : '<i class="st-ico"></i>';
    return `<li><span class="st">${img}<span>${esc(label)}</span></span>${m ? `<b>${(+m[1]).toLocaleString('fr-FR')}${m[2]}</b>` : ''}</li>`;
  }
  function tipHTML(m) {
    const stats = m.stats || [];
    return `<header>
        <img src="${m.img}" alt="" draggable="false">
        <div>
          <div class="tip-name">${esc(m.name)}</div>
          <div class="tip-sub"><span>${TIP_LABEL[m.type]}</span><span class="gbadge">G${m.gen}</span></div>
        </div>
      </header>
      ${stats.length ? `<div class="tip-title">Bonus niveau 200</div><ul class="tip-stats">${stats.map(statRow).join('')}</ul>` : ''}`;
  }
  function placeTip(a) {
    const M = 8, r = a.getBoundingClientRect(), c = tip.getBoundingClientRect();
    const left = Math.min(Math.max(M, r.left + r.width / 2 - c.width / 2), innerWidth - c.width - M);
    const above = r.top - c.height - M >= 0;
    const top = above ? r.top - c.height - M : Math.min(r.bottom + M, innerHeight - c.height - M);
    tip.style.left = left + 'px'; tip.style.top = Math.max(M, top) + 'px';
  }
  function hideTip() { clearTimeout(tipTimer); tipFor = null; tip.hidden = true; }
  document.addEventListener('mouseover', e => {
    const img = e.target.closest && e.target.closest('img[data-mid]');
    if (img === tipFor) return;
    hideTip();
    if (!img || !byId.has(img.dataset.mid)) return;
    tipFor = img;
    tipTimer = setTimeout(() => {
      tip.innerHTML = tipHTML(byId.get(img.dataset.mid));
      tip.hidden = false; placeTip(img);
    }, 120);
  });
  document.documentElement.addEventListener('mouseleave', hideTip);
  document.addEventListener('pointerdown', hideTip);
  document.addEventListener('scroll', hideTip, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });

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
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) setMenu(false); });
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

  // ---------- Onglets (vues et familles) ----------
  function tabsState(sel, attr, current) {
    const tabs = [...document.querySelectorAll(sel + ' button')];
    tabs.forEach(b => {
      const on = b.dataset[attr] === current;
      b.classList.toggle('active', on); b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });
    $(sel).style.setProperty('--i', tabs.findIndex(b => b.dataset[attr] === current)); // fait glisser le fond
  }
  $('#viewTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    state.view = b.dataset.view; save(); renderAll(true); centerOverview('auto');
  });
  $('#famTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-fam]'); if (!b || b.dataset.fam === state.type) return;
    state.type = b.dataset.fam; expanded.clear();
    state.selected = state.sel[state.type] && byId.has(state.sel[state.type]) ? state.sel[state.type] : fam()[fam().length - 1].id;
    state.sel[state.type] = state.selected;
    $('#search').value = '';
    save(); renderAll(true); centerOverview('auto');
    listEl.querySelector('.item.sel')?.scrollIntoView({ block: 'center' });
  });

  // ---------- Rendu global ----------
  function renderCanvas() {
    if (state.view === 'plan') { renderPlan(); return; }
    if (state.view === 'gauge') { renderGauge(); return; }
    state.view === 'tree' ? renderTree() : renderOverview(); applyZoom();
  }
  function renderAll(resetScroll) {
    document.body.dataset.view = state.view;
    document.body.classList.toggle('rev', !fwd());
    markSeg('#dirSeg', 'dirSet', fwd() ? 'fwd' : 'rev');
    tabsState('#viewTabs', 'view', state.view);
    tabsState('#famTabs', 'fam', state.type);
    const f = FAMILIES.find(x => x.id === state.type);
    $('#menuLabel').textContent = f.label[0].toUpperCase() + f.label.slice(1);
    $('#subtitle').innerHTML = `Généalogie des ${f.label} · ${fam().length} montures · 10 générations · recettes <a href="https://dofuselevage.fr/tools/reproduction/${f.id}/genealogie" target="_blank" rel="noopener">DofusElevage</a>`;
    renderList(); renderDetail(); renderCanvas();
    if (resetScroll) {
      if (state.view === 'tree') { // on se place sur la cible (à droite ou à gauche selon le sens)
        const root = canvas.querySelector('.card.root');
        viewport.scrollTo(fwd() ? viewport.scrollWidth : 0, root ? root.offsetTop * state.zoom - viewport.clientHeight / 2 : 0);
      } else viewport.scrollTo(0, 0);
      planEl.scrollTo(0, 0);
    }
  }
  function select(id, scrollList, rc) {
    if (rc !== undefined && rc !== null) state.rc[id] = +rc; // on arrive par une recette précise
    state.selected = id; state.sel[state.type] = id; expanded.clear(); save();
    renderAll(state.view === 'tree');
    centerOverview('smooth');
    if (scrollList !== true) listEl.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function centerOverview(behavior) {
    if (state.view !== 'overview') return;
    const p = ovPos.get(state.selected);
    viewport.scrollTo({ left: p.x * state.zoom - viewport.clientWidth / 3, top: p.y * state.zoom - viewport.clientHeight / 3, behavior });
  }

  // ---------- Compte : pseudo sans mot de passe, « se souvenir de moi », montures possédées sur le serveur ----------
  const account = { user: null, backend: false };
  const authEl = $('#auth'), authErr = $('#authErr');
  const readToken = () => { try { return localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY); } catch { return null; } };
  function writeToken(token, remember) {
    try {
      localStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(AUTH_KEY);
      if (token) (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, token);
    } catch { /* stockage indisponible : on reste connecté le temps de la page */ }
  }
  let token = readToken();
  async function api(path, method = 'GET', body) {
    let res;
    try {
      res = await fetch(path, {
        method, cache: 'no-store',
        headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw Object.assign(new Error('Serveur injoignable.'), { status: 0 }); }
    const ct = res.headers.get('content-type') || '';
    const json = ct.includes('json') ? await res.json().catch(() => ({})) : null;
    if (!res.ok || json === null) throw Object.assign(new Error((json && json.error) || 'Erreur ' + res.status), { status: json === null ? 404 : res.status });
    return json;
  }

  function setOwned(ids) {
    owned.clear(); ids.map(legacy).filter(id => byId.has(id)).forEach(id => owned.add(id));
  }
  function showAccountUI() {
    $('#acct').hidden = !account.user;
    if (account.user) {
      $('#avatar').textContent = [...account.user][0].toUpperCase();
      $('#userName').textContent = account.user;
      $('#acct').title = 'Connecté : ' + account.user;
    }
    const note = $('#optNote');
    note.hidden = account.backend;
    note.textContent = account.backend ? '' : 'Mode local : pas de serveur détecté, les montures possédées restent dans ce navigateur. Lance « python3 server.py » pour avoir des comptes.';
  }
  async function openAuth(msg) {
    authEl.hidden = false; document.body.classList.add('auth-open');
    authErr.hidden = !msg; authErr.textContent = msg || '';
    $('#authName').value = '';
    let users = [];
    try { users = (await api('/api/users')).users; } catch { /* on propose quand même la création */ }
    $('#authUsers').hidden = !users.length;
    $('#authList').innerHTML = users.map(u =>
      `<button type="button" class="auth-user" data-user="${esc(u)}" role="listitem"><span class="br-nav__avatar">${esc([...u][0].toUpperCase())}</span><span class="nm">${esc(u)}</span></button>`).join('');
    $('#authNewLbl').textContent = users.length ? 'Ou crée un nouveau compte (un pseudo suffit, pas de mot de passe) :' : 'Crée ton compte : un pseudo suffit, pas de mot de passe.';
    (users.length ? authEl.querySelector('.auth-user') : $('#authName')).focus();
  }
  function closeAuth() { authEl.hidden = true; document.body.classList.remove('auth-open'); }
  function enter(res, remember) {
    token = res.token; writeToken(token, remember);
    account.user = res.username; setOwned(res.owned || []);
    state.owned = []; save(); showAccountUI(); closeAuth(); renderAll(false);
  }
  async function submitAuth(kind, name) {
    const username = (name ?? $('#authName').value).trim().replace(/\s+/g, ' ');
    if (username.length < 2) { authErr.hidden = false; authErr.textContent = 'Entre un pseudo (2 caractères minimum).'; return; }
    const remember = $('#authRemember').checked;
    const btns = authEl.querySelectorAll('button'); btns.forEach(b => { b.disabled = true; });
    try {
      // À la création, on reprend les montures déjà cochées dans ce navigateur (mode local).
      const res = await api('/api/' + kind, 'POST', kind === 'register' ? { username, remember, owned: [...owned] } : { username, remember });
      enter(res, remember);
    } catch (err) {
      authErr.hidden = false; authErr.textContent = err.message;
      if (err.status === 404 && kind === 'login') openAuth(err.message); // le profil a disparu : on rafraîchit la liste
    } finally { btns.forEach(b => { b.disabled = false; }); }
  }
  $('#authForm').addEventListener('submit', e => { e.preventDefault(); submitAuth('register'); });
  $('#authList').addEventListener('click', e => {
    const b = e.target.closest('[data-user]'); if (b) submitAuth('login', b.dataset.user);
  });
  async function logout() {
    try { await api('/api/logout', 'POST'); } catch { /* déjà déconnectée côté serveur */ }
    token = null; writeToken(null); account.user = null; owned.clear(); state.owned = [];
    save(); showAccountUI(); renderAll(false);
    openAuth();
  }

  // Envoi des montures possédées (regroupé : un seul envoi après une série de coches)
  let syncTimer = null;
  function scheduleSync() {
    if (!account.user) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try { await api('/api/owned', 'PUT', { owned: [...owned] }); }
      catch (err) { if (err.status === 401) { account.user = null; token = null; writeToken(null); showAccountUI(); openAuth('Session expirée, reconnecte-toi.'); } }
    }, 400);
  }
  window.addEventListener('pagehide', () => {
    if (!account.user || syncTimer === null) return;
    fetch('/api/owned', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ owned: [...owned] }) });
  });

  async function boot() {
    renderAll(true);
    centerOverview('auto');
    listEl.querySelector('.item.sel')?.scrollIntoView({ block: 'center' });
    if (location.protocol === 'file:') { showAccountUI(); return; }
    const hadToken = !!token;
    try {
      const me = await api('/api/me');
      account.backend = true; account.user = me.username; setOwned(me.owned); state.owned = []; save();
      showAccountUI(); renderAll(false);
    } catch (err) {
      if (err.status === 0 || err.status === 404) { account.backend = false; showAccountUI(); return; } // pas de serveur : mode local
      account.backend = true; showAccountUI();
      if (err.status === 401) { token = null; writeToken(null); openAuth(hadToken ? 'Session expirée, reconnecte-toi.' : ''); }
      else openAuth(err.message);
    }
  }
  boot();
})();
