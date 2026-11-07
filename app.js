/* 다인에듀 재무 대시보드
 * 데이터는 이 브라우저의 localStorage 에만 저장됩니다 (GitHub에 올라가지 않음).
 */
(function () {
  'use strict';

  const STORE_KEY = 'dainedu_budget_v1';
  const DEFAULT_CATS = {
    income: ['기관 출강', '학교 출강', '개인 레슨', '기업·단체 레슨', '온라인 강의', '교재·출판', '기타 수입'],
    expense: ['카드대금', '임대료·관리비', '인건비·강사료', '세금·공과금', '통신·소프트웨어', '교재·자료', '광고·마케팅', '대출 상환', '기타 지출']
  };
  const METHODS = ['계좌이체', '카드', '현금', '기타'];
  const SCOPES = ['미지정', '다인에듀', '다인원격', '개인'];
  const INC_STATUS = { done: '✔ 입금완료', pending: '⏳ 입금대기', expected: '◌ 예상' };
  const INC_ORDER = ['done', 'pending', 'expected'];
  const EXP_STATUS = { done: '✔ 납부완료', pending: '⏳ 미납' };

  // ---------- state ----------
  let state = load();
  const ui = {
    pt: 'month', year: null, sub: null, incExpected: false,
    entryMonth: null, stmtYear: null, stmtView: 'month', stmtExpected: false
  };

  function blank() {
    return { app: 'dainedu_budget', version: 1, categories: JSON.parse(JSON.stringify(DEFAULT_CATS)), months: {}, meta: { updatedAt: null, lastBackupAt: null } };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return normalize(s);
    } catch (e) { console.warn(e); return null; }
  }
  function normalize(s) {
    const b = blank();
    s = s || {};
    b.categories = s.categories && s.categories.income ? s.categories : b.categories;
    b.months = s.months || {};
    b.meta = Object.assign(b.meta, s.meta || {});
    Object.keys(b.months).forEach(k => {
      const m = b.months[k];
      m.income = (m.income || []).map(x => Object.assign({ id: uid(), name: '', category: '기타 수입', amount: 0, status: 'pending', method: '계좌이체', date: '', memo: '' }, x));
      m.expense = (m.expense || []).map(x => Object.assign({ id: uid(), name: '', category: '기타 지출', amount: 0, billed: 0, scope: '미지정', status: 'pending', memo: '' }, x));
      m.balances = (m.balances || []).map(x => Object.assign({ id: uid(), name: '', amount: 0 }, x));
      m.memo = m.memo || '';
    });
    return b;
  }
  let saveTimer = null;
  function save(immediate) {
    if (!state) return;
    state.meta.updatedAt = new Date().toISOString();
    const doit = () => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      catch (e) { toast('저장 실패: 브라우저 저장공간을 확인하세요'); }
      renderBanner();
    };
    clearTimeout(saveTimer);
    if (immediate) doit(); else saveTimer = setTimeout(doit, 250);
  }

  // ---------- helpers ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (Math.round(n || 0)).toLocaleString('ko-KR');
  const won = n => fmt(n) + '원';
  function parseAmt(v) {
    if (typeof v === 'number') return v;
    const s = String(v || '').replace(/[^\d-]/g, '');
    const neg = s.startsWith('-');
    const d = s.replace(/-/g, '');
    return d ? (neg ? -1 : 1) * parseInt(d, 10) : 0;
  }
  function compact(v) {
    const a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (a >= 1e8) return sg + trim(a / 1e8) + '억';
    if (a >= 1e4) return sg + trim(a / 1e4) + '만';
    return sg + fmt(a);
  }
  function trim(x) { return (Math.round(x * 10) / 10).toString(); }
  const mk = (y, m) => y + '-' + String(m).padStart(2, '0');
  const ym = k => { const [y, m] = k.split('-').map(Number); return { y, m }; };
  function monthsOf(type, year, sub) {
    let a = [];
    if (type === 'month') a = [sub];
    else if (type === 'quarter') a = [1, 2, 3].map(i => (sub - 1) * 3 + i);
    else if (type === 'half') a = [1, 2, 3, 4, 5, 6].map(i => (sub - 1) * 6 + i);
    else a = Array.from({ length: 12 }, (_, i) => i + 1);
    return a.map(m => mk(year, m));
  }
  function periodLabel(type, year, sub) {
    if (type === 'month') return `${year}년 ${sub}월`;
    if (type === 'quarter') return `${year}년 ${sub}분기 (${(sub - 1) * 3 + 1}~${sub * 3}월)`;
    if (type === 'half') return `${year}년 ${sub === 1 ? '상반기 (1~6월)' : '하반기 (7~12월)'}`;
    return `${year}년 연간`;
  }
  function prevPeriod(type, year, sub) {
    if (type === 'month') return sub === 1 ? [year - 1, 12] : [year, sub - 1];
    if (type === 'quarter') return sub === 1 ? [year - 1, 4] : [year, sub - 1];
    if (type === 'half') return sub === 1 ? [year - 1, 2] : [year, 1];
    return [year - 1, null];
  }
  function monthHasData(k) {
    const m = state && state.months[k];
    return !!(m && (m.income.length || m.expense.length || m.balances.length));
  }
  function dataYears() {
    const ys = new Set(Object.keys(state ? state.months : {}).filter(monthHasData).map(k => ym(k).y));
    ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => a - b);
  }
  function latestMonthKey() {
    const ks = Object.keys(state.months).filter(monthHasData).sort();
    if (ks.length) return ks[ks.length - 1];
    const d = new Date(); return mk(d.getFullYear(), d.getMonth() + 1);
  }
  function getMonth(k, create) {
    if (!state.months[k] && create) state.months[k] = { income: [], expense: [], balances: [], memo: '' };
    return state.months[k];
  }

  // ---------- aggregation ----------
  function aggregate(keys, incExpected) {
    const r = { income: 0, done: 0, pending: 0, expected: 0, expense: 0, billed: 0, unpaid: 0, balance: 0, balanceMonth: null, balances: {}, incByCat: {}, expByCat: {}, expByScope: {}, sources: {}, hasData: false, months: 0 };
    keys.slice().sort().forEach(k => {
      const m = state.months[k];
      if (!m || !monthHasData(k)) return;
      r.hasData = true; r.months++;
      m.income.forEach(x => {
        const a = Number(x.amount) || 0;
        r[x.status] = (r[x.status] || 0) + a;
        const counted = x.status !== 'expected' || incExpected;
        if (!counted) return;
        r.income += a;
        r.incByCat[x.category] = (r.incByCat[x.category] || 0) + a;
        const nm = (x.name || '(이름 없음)').trim();
        const s = r.sources[nm] || (r.sources[nm] = { amount: 0, count: 0, category: x.category });
        s.amount += a; s.count++;
      });
      m.expense.forEach(x => {
        const a = Number(x.amount) || 0;
        r.expense += a; r.billed += Number(x.billed) || a;
        if (x.status !== 'done') r.unpaid += a;
        r.expByCat[x.category] = (r.expByCat[x.category] || 0) + a;
        r.expByScope[x.scope || '미지정'] = (r.expByScope[x.scope || '미지정'] || 0) + a;
      });
      if (m.balances.length) {
        r.balanceMonth = k; r.balances = {};
        r.balance = m.balances.reduce((s, b) => { r.balances[b.name || '(계좌)'] = Number(b.amount) || 0; return s + (Number(b.amount) || 0); }, 0);
      }
    });
    r.net = r.income - r.expense;
    r.margin = r.income ? r.net / r.income : null;
    return r;
  }

  // ---------- tabs ----------
  function showTab(t) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t));
    if (t === 'dash') renderDash();
    if (t === 'entry') renderEntry();
    if (t === 'stmt') renderStmt();
    if (t === 'data') renderData();
    try { localStorage.setItem(STORE_KEY + '_tab', t); } catch (e) { }
  }
  $$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- dashboard ----------
  function fillPeriodSelectors() {
    const ys = dataYears();
    $('#selYear').innerHTML = ys.map(y => `<option value="${y}">${y}년</option>`).join('');
    $('#selYear').value = ui.year;
    const sub = $('#selSub');
    let opts = [];
    if (ui.pt === 'month') opts = Array.from({ length: 12 }, (_, i) => [i + 1, (i + 1) + '월']);
    if (ui.pt === 'quarter') opts = [[1, '1분기'], [2, '2분기'], [3, '3분기'], [4, '4분기']];
    if (ui.pt === 'half') opts = [[1, '상반기'], [2, '하반기']];
    sub.classList.toggle('hidden', ui.pt === 'year');
    sub.innerHTML = opts.map(([v, l]) => {
      const has = monthsOf(ui.pt, ui.year, v).some(monthHasData);
      return `<option value="${v}">${l}${has ? ' ●' : ''}</option>`;
    }).join('');
    if (ui.pt !== 'year') sub.value = ui.sub;
  }
  function setPT(pt) {
    const curMonth = ui.pt === 'month' ? ui.sub : ui.pt === 'quarter' ? (ui.sub - 1) * 3 + 1 : ui.pt === 'half' ? (ui.sub - 1) * 6 + 1 : ym(latestMonthKey()).m;
    ui.pt = pt;
    if (pt === 'month') ui.sub = curMonth;
    if (pt === 'quarter') ui.sub = Math.ceil(curMonth / 3);
    if (pt === 'half') ui.sub = curMonth <= 6 ? 1 : 2;
    if (pt === 'year') ui.sub = null;
    $$('#periodType button').forEach(b => b.classList.toggle('on', b.dataset.pt === pt));
    renderDash();
  }
  $$('#periodType button').forEach(b => b.addEventListener('click', () => setPT(b.dataset.pt)));
  $('#selYear').addEventListener('change', e => { ui.year = +e.target.value; renderDash(); });
  $('#selSub').addEventListener('change', e => { ui.sub = +e.target.value; renderDash(); });
  $('#incExpected').addEventListener('change', e => { ui.incExpected = e.target.checked; renderDash(); });

  function deltaHtml(cur, prev, upGood, prevHas) {
    if (!prevHas || prev == null) return '<div class="delta">이전 기간 기록 없음</div>';
    const d = cur - prev;
    if (d === 0) return '<div class="delta">이전 기간과 같음</div>';
    const good = upGood ? d > 0 : d < 0;
    const pct = prev !== 0 ? ` (${d > 0 ? '+' : ''}${Math.round(d / Math.abs(prev) * 100)}%)` : '';
    return `<div class="delta"><span class="${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}원${pct}</span> 이전 대비</div>`;
  }

  function renderDash() {
    if (!state) return;
    fillPeriodSelectors();
    const keys = monthsOf(ui.pt, ui.year, ui.sub);
    const a = aggregate(keys, ui.incExpected);
    const [py, ps] = prevPeriod(ui.pt, ui.year, ui.sub);
    const p = aggregate(monthsOf(ui.pt, py, ps), ui.incExpected);
    $('#periodTitle').innerHTML = `${periodLabel(ui.pt, ui.year, ui.sub)} ${a.hasData ? '' : '<span class="muted small" style="font-weight:500">· 기록 없음</span>'}`;

    const tiles = [
      { label: '총수입', key: 'var(--s1)', v: a.income, d: deltaHtml(a.income, p.income, true, p.hasData), note: ui.incExpected ? '예상 포함' : '확정 기준' },
      { label: '총지출', key: 'var(--s2)', v: a.expense, d: deltaHtml(a.expense, p.expense, false, p.hasData) },
      { label: '순이익', key: 'var(--s3)', v: a.net, d: `<div class="delta">이익률 ${a.margin == null ? '–' : Math.round(a.margin * 100) + '%'}</div>` },
      { label: '미수금 (입금대기)', v: a.pending, d: `<div class="delta">입금완료 ${fmt(a.done)}원</div>` },
      { label: '예상수입', v: a.expected, d: `<div class="delta">${ui.incExpected ? '총수입에 포함됨' : '총수입에 미포함'}</div>` },
      { label: '통장 잔고', v: a.balance, d: `<div class="delta">${a.balanceMonth ? ym(a.balanceMonth).m + '월 기록 기준' : '기록 없음'}</div>` }
    ];
    $('#kpis').innerHTML = tiles.map(t => `
      <div class="kpi"><div class="label">${t.key ? `<span class="key" style="background:${t.key}"></span>` : ''}${t.label}${t.note ? ` <span class="muted">· ${t.note}</span>` : ''}</div>
      <div class="value">${fmt(t.v)}<small>원</small></div>${t.d}</div>`).join('');

    // trend
    let buckets = [], title = '';
    if (ui.pt === 'month') { title = `${ui.year}년 월별 수입·지출`; buckets = Array.from({ length: 12 }, (_, i) => ({ label: (i + 1) + '월', keys: [mk(ui.year, i + 1)], sel: i + 1 === ui.sub, full: `${ui.year}년 ${i + 1}월` })); }
    if (ui.pt === 'quarter') { title = `${ui.year}년 분기별 수입·지출`; buckets = [1, 2, 3, 4].map(q => ({ label: q + '분기', keys: monthsOf('quarter', ui.year, q), sel: q === ui.sub, full: periodLabel('quarter', ui.year, q) })); }
    if (ui.pt === 'half') { title = `${ui.year}년 반기별 수입·지출`; buckets = [1, 2].map(h => ({ label: h === 1 ? '상반기' : '하반기', keys: monthsOf('half', ui.year, h), sel: h === ui.sub, full: periodLabel('half', ui.year, h) })); }
    if (ui.pt === 'year') { title = '연도별 수입·지출'; buckets = dataYears().map(y => ({ label: y + '년', keys: monthsOf('year', y), sel: y === ui.year, full: y + '년' })); }
    buckets.forEach(b => { const g = aggregate(b.keys, ui.incExpected); b.income = g.income; b.expense = g.expense; b.net = g.net; b.has = g.hasData; });
    $('#trendTitle').textContent = title;
    $('#trendLegend').innerHTML = `<span><span class="sw" style="background:var(--s1)"></span>수입</span><span><span class="sw" style="background:var(--s2)"></span>지출</span><span><span class="ln" style="background:var(--s3)"></span>순이익</span>`;
    columnChart($('#trendChart'), buckets);

    hbarChart($('#incCatChart'), toItems(a.incByCat), 'var(--s1)');
    hbarChart($('#expCatChart'), toItems(a.expByCat), 'var(--s2)');
    hbarChart($('#scopeChart'), toItems(a.expByScope), 'var(--s2)');

    // sources
    const src = Object.entries(a.sources).sort((x, y) => y[1].amount - x[1].amount);
    $('#srcCount').textContent = src.length ? `${src.length}곳` : '';
    const maxS = src.length ? src[0][1].amount : 1;
    $('#topSources').innerHTML = src.length ? `<table class="rank">${src.slice(0, 15).map(([n, s], i) => `
      <tr><td class="muted" style="width:24px">${i + 1}</td><td>${esc(n)} <span class="muted small">${esc(s.category)}${s.count > 1 ? ' · ' + s.count + '건' : ''}</span></td>
      <td class="barcell"><div class="bar" style="width:${Math.max(2, s.amount / maxS * 100)}%"></div></td><td class="num">${fmt(s.amount)}원</td></tr>`).join('')}</table>` : '<div class="empty">수입 기록이 없습니다</div>';

    // todo
    const todos = [];
    keys.forEach(k => {
      const m = state.months[k]; if (!m) return;
      m.income.forEach(x => { if (x.status === 'pending' || x.status === 'expected') todos.push({ k, kind: 'income', x }); });
      m.expense.forEach(x => { if (x.status !== 'done') todos.push({ k, kind: 'expense', x }); });
    });
    $('#todoList').innerHTML = todos.length ? todos.map(t => {
      const st = t.kind === 'income' ? `<span class="st ${t.x.status}">${INC_STATUS[t.x.status]}</span>` : `<span class="st unpaid">${EXP_STATUS.pending}</span>`;
      return `<div class="todo"><span class="mo">${ym(t.k).m}월</span>${st}<span class="nm">${esc(t.x.name)}${t.x.memo ? ` <span class="muted small">${esc(t.x.memo)}</span>` : ''}</span><span class="num">${t.kind === 'expense' ? '−' : ''}${fmt(t.x.amount)}원</span>
      <button class="btn" style="padding:4px 10px" data-done="${t.kind}|${t.k}|${t.x.id}">완료</button></div>`;
    }).join('') : '<div class="empty">모두 처리되었습니다 👍</div>';
  }
  $('#todoList').addEventListener('click', e => {
    const b = e.target.closest('[data-done]'); if (!b) return;
    const [kind, k, id] = b.dataset.done.split('|');
    const it = state.months[k][kind].find(x => x.id === id);
    if (it) { it.status = 'done'; save(true); renderDash(); toast(`'${it.name}' 완료 처리`); }
  });
  function toItems(o) { return Object.entries(o).filter(([, v]) => v !== 0).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); }

  // ---------- charts (SVG) ----------
  const NS = 'http://www.w3.org/2000/svg';
  function niceStep(range, n) {
    const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function barPath(x, y0, w, y1, r) {
    // grows from baseline y0 to y1, rounded at data end, square at baseline
    const up = y1 < y0, h = Math.abs(y0 - y1); r = Math.min(r, w / 2, h);
    if (h < 0.5) return '';
    if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }
  function columnChart(el, buckets) {
    const W = Math.max(320, el.clientWidth || 800), H = 290, m = { l: 58, r: 14, t: 14, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = buckets.flatMap(b => b.has ? [b.income, b.expense, b.net] : [0]);
    let max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    if (max === 0 && min === 0) max = 1000000;
    const step = niceStep(max - min, 4);
    max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
    const y = v => m.t + ih - (v - min) / (max - min) * ih;
    const gw = iw / buckets.length;
    const bw = Math.min(24, Math.max(6, gw * 0.28));
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="수입 지출 추이 차트">`;
    buckets.forEach((b, i) => { if (b.sel) s += `<rect x="${m.l + gw * i + 2}" y="${m.t}" width="${gw - 4}" height="${ih}" rx="8" fill="var(--brand)" opacity=".07"/>`; });
    for (let v = min; v <= max + 1e-6; v += step) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>`;
      s += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" style="font-variant-numeric:tabular-nums">${compact(v)}</text>`;
    }
    const y0 = y(0);
    buckets.forEach((b, i) => {
      const cx = m.l + gw * i + gw / 2, op = b.sel || buckets.every(x => !x.sel) ? 1 : 0.45;
      if (b.has) {
        s += `<path d="${barPath(cx - bw - 1, y0, bw, y(b.income), 4)}" fill="var(--s1)" opacity="${op}"/>`;
        s += `<path d="${barPath(cx + 1, y0, bw, y(b.expense), 4)}" fill="var(--s2)" opacity="${op}"/>`;
      }
      s += `<text x="${cx}" y="${H - 12}" text-anchor="middle" font-size="12" fill="${b.sel ? 'var(--ink)' : 'var(--muted)'}" font-weight="${b.sel ? 700 : 400}">${esc(b.label)}</text>`;
    });
    // net line (breaks where no data)
    let seg = [];
    const segs = [];
    buckets.forEach((b, i) => { const cx = m.l + gw * i + gw / 2; if (b.has) seg.push([cx, y(b.net)]); else { if (seg.length) segs.push(seg); seg = []; } });
    if (seg.length) segs.push(seg);
    segs.forEach(sg => { if (sg.length > 1) s += `<polyline points="${sg.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--s3)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`; });
    segs.flat().forEach(([x, yy]) => { s += `<circle cx="${x}" cy="${yy}" r="4.5" fill="var(--s3)" stroke="var(--surface)" stroke-width="2"/>`; });
    // selected label (selective direct label: net of selected bucket)
    const sb = buckets.findIndex(b => b.sel && b.has);
    if (sb >= 0) {
      const b = buckets[sb], cx = m.l + gw * sb + gw / 2;
      const top = Math.min(y(b.income), y(b.expense), y(b.net));
      s += `<text x="${cx}" y="${Math.max(m.t + 10, top - 10)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">순이익 ${compact(b.net)}</text>`;
    }
    buckets.forEach((b, i) => { s += `<rect class="hit" data-i="${i}" x="${m.l + gw * i}" y="${m.t}" width="${gw}" height="${ih + 20}" fill="transparent"/>`; });
    s += '</svg>';
    el.innerHTML = s;
    $$('.hit', el).forEach(r => {
      r.addEventListener('mousemove', e => {
        const b = buckets[+r.dataset.i];
        showTip(e, `<div class="tt-h">${esc(b.full)}</div>` + (b.has ? [
          ['var(--s1)', '수입', b.income], ['var(--s2)', '지출', b.expense], ['var(--s3)', '순이익', b.net]
        ].map(([c, l, v]) => `<div class="tt-r"><span><i class="sw" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c}"></i>${l}</span><span>${fmt(v)}원</span></div>`).join('') : '<div class="muted">기록 없음</div>'));
      });
      r.addEventListener('mouseleave', hideTip);
      r.addEventListener('click', () => {
        const b = buckets[+r.dataset.i];
        if (ui.pt === 'year') ui.year = +b.label.replace('년', '');
        else ui.sub = +r.dataset.i + 1;
        renderDash();
      });
      r.style.cursor = 'pointer';
    });
  }
  function hbarChart(el, items, color) {
    if (!items.length) { el.innerHTML = '<div class="empty">기록이 없습니다</div>'; return; }
    const W = Math.max(300, el.clientWidth || 500), rowH = 30, lw = Math.min(140, W * 0.32), vw = 120;
    const H = items.length * rowH + 6, bw = W - lw - vw - 8;
    const total = items.reduce((s, x) => s + x.value, 0);
    const max = Math.max(...items.map(x => Math.abs(x.value))) || 1;
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" role="img">`;
    s += `<line x1="${lw}" x2="${lw}" y1="0" y2="${H}" stroke="var(--axis)"/>`;
    items.forEach((it, i) => {
      const yy = i * rowH + 8, w = Math.max(2, Math.abs(it.value) / max * bw);
      s += `<text x="${lw - 8}" y="${yy + 11}" text-anchor="end" font-size="12" fill="var(--ink-2)">${esc(it.label)}</text>`;
      s += `<path d="M${lw},${yy}H${lw + w - 4}Q${lw + w},${yy} ${lw + w},${yy + 4}V${yy + 10}Q${lw + w},${yy + 14} ${lw + w - 4},${yy + 14}H${lw}Z" fill="${color}"/>`;
      s += `<text x="${lw + w + 6}" y="${yy + 11}" font-size="12" fill="var(--ink)" style="font-variant-numeric:tabular-nums">${fmt(it.value)}원 <tspan fill="var(--muted)">${total ? Math.round(it.value / total * 100) : 0}%</tspan></text>`;
      s += `<rect class="hit" data-i="${i}" x="0" y="${yy - 7}" width="${W}" height="${rowH}" fill="transparent"/>`;
    });
    s += '</svg>';
    el.innerHTML = s;
    $$('.hit', el).forEach(r => {
      r.addEventListener('mousemove', e => { const it = items[+r.dataset.i]; showTip(e, `<div class="tt-h">${esc(it.label)}</div><div class="tt-r"><span>금액</span><span>${fmt(it.value)}원</span></div><div class="tt-r"><span>비중</span><span>${total ? (it.value / total * 100).toFixed(1) : 0}%</span></div>`); });
      r.addEventListener('mouseleave', hideTip);
    });
  }
  function showTip(e, html) {
    const t = $('#tooltip'); t.innerHTML = html; t.classList.remove('hidden');
    const r = t.getBoundingClientRect();
    let x = e.clientX + 14, yy = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
    t.style.left = x + 'px'; t.style.top = yy + 'px';
  }
  function hideTip() { $('#tooltip').classList.add('hidden'); }

  // ---------- monthly entry ----------
  function catOptions(kind, cur) {
    const list = state.categories[kind].slice();
    if (cur && !list.includes(cur)) list.push(cur);
    return list.map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }
  function opts(list, cur) { const l = list.slice(); if (cur && !l.includes(cur)) l.push(cur); return l.map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join(''); }

  function renderEntry() {
    if (!state) return;
    if (!ui.entryMonth) ui.entryMonth = latestMonthKey();
    $('#entryMonth').value = ui.entryMonth;
    const m = getMonth(ui.entryMonth, false) || { income: [], expense: [], balances: [], memo: '' };

    $('#incTable tbody').innerHTML = m.income.map(x => `
      <tr data-kind="income" data-id="${x.id}" class="${x.status === 'expected' ? 'is-expected' : ''}">
        <td><span class="st ${x.status}" data-cycle="income">${INC_STATUS[x.status]}</span></td>
        <td><input data-f="name" value="${esc(x.name)}" placeholder="이름 / 기관"></td>
        <td><select data-f="category">${catOptions('income', x.category)}</select></td>
        <td><select data-f="method">${opts(METHODS, x.method)}</select></td>
        <td><input data-f="amount" class="num" inputmode="numeric" value="${fmt(x.amount)}"></td>
        <td><input data-f="date" type="date" value="${esc(x.date)}"></td>
        <td><input data-f="memo" value="${esc(x.memo)}" placeholder="메모"></td>
        <td><button class="del" data-del title="삭제">×</button></td>
      </tr>`).join('') || `<tr><td colspan="8" class="empty">수입 항목이 없습니다. 아래 버튼으로 추가하거나 '지난달 항목 복사'를 누르세요.</td></tr>`;

    $('#expTable tbody').innerHTML = m.expense.map(x => `
      <tr data-kind="expense" data-id="${x.id}">
        <td><span class="st ${x.status === 'done' ? 'done' : 'unpaid'}" data-cycle="expense">${EXP_STATUS[x.status === 'done' ? 'done' : 'pending']}</span></td>
        <td><input data-f="name" value="${esc(x.name)}" placeholder="카드·거래처"></td>
        <td><select data-f="category">${catOptions('expense', x.category)}</select></td>
        <td><select data-f="scope">${opts(SCOPES, x.scope)}</select></td>
        <td><input data-f="billed" class="num" inputmode="numeric" value="${fmt(x.billed)}"></td>
        <td><input data-f="amount" class="num" inputmode="numeric" value="${fmt(x.amount)}"></td>
        <td><input data-f="memo" value="${esc(x.memo)}" placeholder="메모"></td>
        <td><button class="del" data-del title="삭제">×</button></td>
      </tr>`).join('') || `<tr><td colspan="8" class="empty">지출 항목이 없습니다.</td></tr>`;

    $('#balTable tbody').innerHTML = m.balances.map(x => `
      <tr data-kind="balances" data-id="${x.id}">
        <td><input data-f="name" value="${esc(x.name)}" placeholder="은행 / 계좌"></td>
        <td><input data-f="amount" class="num" inputmode="numeric" value="${fmt(x.amount)}"></td>
        <td><button class="del" data-del title="삭제">×</button></td>
      </tr>`).join('') || `<tr><td colspan="3" class="empty">잔고 기록이 없습니다.</td></tr>`;

    $('#monthMemo').value = m.memo || '';
    renderEntryTotals();
  }
  function renderEntryTotals() {
    const m = getMonth(ui.entryMonth, false) || { income: [], expense: [], balances: [] };
    const sum = (arr, f, fl) => arr.filter(fl || (() => true)).reduce((s, x) => s + (Number(x[f]) || 0), 0);
    const done = sum(m.income, 'amount', x => x.status === 'done'), pend = sum(m.income, 'amount', x => x.status === 'pending'), expd = sum(m.income, 'amount', x => x.status === 'expected');
    const exp = sum(m.expense, 'amount'), billed = sum(m.expense, 'billed'), unpaid = sum(m.expense, 'amount', x => x.status !== 'done');
    const bal = sum(m.balances, 'amount');
    $('#incTable tfoot').innerHTML = m.income.length ? `<tr><td colspan="4">확정 수입 ${fmt(done + pend)}원 <span class="muted small" style="font-weight:500">(완료 ${fmt(done)} · 대기 ${fmt(pend)})</span></td><td class="num">${fmt(done + pend)}</td><td colspan="3" class="muted small" style="font-weight:500">+ 예상 ${fmt(expd)}원 → 전체 ${fmt(done + pend + expd)}원</td></tr>` : '';
    $('#expTable tfoot').innerHTML = m.expense.length ? `<tr><td colspan="4">지출 합계 <span class="muted small" style="font-weight:500">(미납 ${fmt(unpaid)}원)</span></td><td class="num">${fmt(billed)}</td><td class="num">${fmt(exp)}</td><td colspan="2" class="muted small" style="font-weight:500">${billed !== exp ? '청구 대비 ' + fmt(billed - exp) + '원 차이' : ''}</td></tr>` : '';
    $('#balTable tfoot').innerHTML = m.balances.length ? `<tr><td>잔고 합계</td><td class="num">${fmt(bal)}</td><td></td></tr>` : '';
    const net = done + pend - exp;
    $('#monthSummary').innerHTML = [
      ['확정 수입', done + pend], ['예상수입', expd], ['지출 (실지출)', exp], ['순이익', net], ['통장 잔고', bal]
    ].map(([l, v]) => `<div class="ms"><div class="l">${l}</div><div class="v" ${l === '순이익' && v < 0 ? 'style="color:var(--crit-text)"' : ''}>${fmt(v)}원</div></div>`).join('');
  }
  function findItem(tr) { const m = getMonth(ui.entryMonth, true); return m[tr.dataset.kind].find(x => x.id === tr.dataset.id); }

  const entry = $('#tab-entry');
  entry.addEventListener('input', e => {
    const f = e.target.dataset.f; if (!f) return;
    const tr = e.target.closest('tr'); const it = findItem(tr); if (!it) return;
    if (['amount', 'billed'].includes(f)) {
      const old = it[f];
      it[f] = parseAmt(e.target.value);
      // 청구액과 실지출이 같았으면 함께 맞춰 줌
      if (tr.dataset.kind === 'expense' && f === 'billed' && (it.amount === old || !it.amount)) {
        it.amount = it[f]; const a = $('input[data-f="amount"]', tr); if (a) a.value = fmt(it.amount);
      }
    } else it[f] = e.target.value;
    save(); renderEntryTotals();
  });
  entry.addEventListener('change', e => {
    const f = e.target.dataset.f;
    if (f && ['amount', 'billed'].includes(f)) e.target.value = fmt(parseAmt(e.target.value));
    if (e.target.tagName === 'SELECT' && f) { const it = findItem(e.target.closest('tr')); if (it) { it[f] = e.target.value; save(); } }
  });
  entry.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('num') && e.target.tagName === 'INPUT') setTimeout(() => e.target.select(), 0); });
  entry.addEventListener('click', e => {
    const cyc = e.target.closest('[data-cycle]');
    if (cyc) {
      const tr = cyc.closest('tr'); const it = findItem(tr);
      if (cyc.dataset.cycle === 'income') it.status = INC_ORDER[(INC_ORDER.indexOf(it.status) + 1) % 3];
      else it.status = it.status === 'done' ? 'pending' : 'done';
      save(); renderEntry(); return;
    }
    if (e.target.closest('[data-del]')) {
      const tr = e.target.closest('tr'); const m = getMonth(ui.entryMonth, true);
      const it = findItem(tr);
      if (it && (it.name || it.amount) && !confirm(`'${it.name || '항목'}'을(를) 삭제할까요?`)) return;
      m[tr.dataset.kind] = m[tr.dataset.kind].filter(x => x.id !== tr.dataset.id);
      save(); renderEntry(); return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const m = getMonth(ui.entryMonth, true), k = add.dataset.add;
      if (k === 'income') m.income.push({ id: uid(), name: '', category: '개인 레슨', amount: 0, status: 'pending', method: '계좌이체', date: '', memo: '' });
      if (k === 'expense') m.expense.push({ id: uid(), name: '', category: '카드대금', amount: 0, billed: 0, scope: '미지정', status: 'pending', memo: '' });
      if (k === 'balance') m.balances.push({ id: uid(), name: '', amount: 0 });
      save(); renderEntry();
      const tb = k === 'income' ? '#incTable' : k === 'expense' ? '#expTable' : '#balTable';
      const last = $$(tb + ' tbody tr').pop(); if (last) { const i = $('input[data-f="name"]', last); if (i) i.focus(); }
    }
  });
  $('#monthMemo').addEventListener('input', e => { getMonth(ui.entryMonth, true).memo = e.target.value; save(); });
  function shiftMonth(d) { const { y, m } = ym(ui.entryMonth); const dt = new Date(y, m - 1 + d, 1); ui.entryMonth = mk(dt.getFullYear(), dt.getMonth() + 1); renderEntry(); }
  $('#prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('#nextMonth').addEventListener('click', () => shiftMonth(1));
  $('#entryMonth').addEventListener('change', e => { if (e.target.value) { ui.entryMonth = e.target.value; renderEntry(); } });
  $('#copyPrev').addEventListener('click', () => {
    const src = Object.keys(state.months).filter(k => k < ui.entryMonth && monthHasData(k)).sort().pop();
    if (!src) { toast('복사할 이전 달 기록이 없습니다'); return; }
    const cur = getMonth(ui.entryMonth, true);
    const hasAny = cur.income.length || cur.expense.length || cur.balances.length;
    if (!confirm(`${ym(src).y}년 ${ym(src).m}월 항목을 ${ym(ui.entryMonth).m}월로 복사할까요?\n(수입은 '입금대기', 지출은 '미납' 상태로 복사되고, 잔고는 계좌 이름만 복사됩니다${hasAny ? '. 기존 항목 뒤에 추가됩니다' : ''})`)) return;
    const s = state.months[src];
    s.income.forEach(x => cur.income.push(Object.assign({}, x, { id: uid(), status: x.status === 'expected' ? 'expected' : 'pending', date: '' })));
    s.expense.forEach(x => cur.expense.push(Object.assign({}, x, { id: uid(), status: 'pending' })));
    s.balances.forEach(x => { if (!cur.balances.some(b => b.name === x.name)) cur.balances.push({ id: uid(), name: x.name, amount: 0 }); });
    save(true); renderEntry(); toast('복사했습니다. 금액을 확인해 주세요');
  });
  $('#clearMonth').addEventListener('click', () => {
    if (!monthHasData(ui.entryMonth)) return;
    if (!confirm(`${ym(ui.entryMonth).y}년 ${ym(ui.entryMonth).m}월의 모든 항목을 지울까요? (되돌릴 수 없음)`)) return;
    delete state.months[ui.entryMonth]; save(true); renderEntry();
  });

  // ---------- statement ----------
  $('#stmtYear').addEventListener('change', e => { ui.stmtYear = +e.target.value; renderStmt(); });
  $$('#stmtView button').forEach(b => b.addEventListener('click', () => { ui.stmtView = b.dataset.sv; $$('#stmtView button').forEach(x => x.classList.toggle('on', x === b)); renderStmt(); }));
  $('#stmtExpected').addEventListener('change', e => { ui.stmtExpected = e.target.checked; renderStmt(); });
  $('#stmtPrint').addEventListener('click', () => window.print());
  $('#stmtCsv').addEventListener('click', () => {
    const mtx = buildStmt();
    const rows = [[mtx.title], ['항목', ...mtx.cols.map(c => c.label)], ...mtx.rows.map(r => [r.label.trim(), ...r.vals.map(v => v == null ? '' : r.pct ? (v == null ? '' : Math.round(v * 1000) / 10 + '%') : Math.round(v))])];
    downloadCsv(rows, `다인에듀_재무제표_${mtx.fileTag}.csv`);
  });

  function buildStmt() {
    const Y = ui.stmtYear, v = ui.stmtView;
    let cols = [];
    const monthCols = Array.from({ length: 12 }, (_, i) => ({ label: (i + 1) + '월', keys: [mk(Y, i + 1)] }));
    const qCols = [1, 2, 3, 4].map(q => ({ label: q + '분기', keys: monthsOf('quarter', Y, q), cls: 'colgrp' }));
    const hCols = [1, 2].map(h => ({ label: h === 1 ? '상반기' : '하반기', keys: monthsOf('half', Y, h), cls: 'colgrp' }));
    const yCol = { label: Y + '년 합계', keys: monthsOf('year', Y), cls: 'coltot' };
    if (v === 'month') cols = [...monthCols, yCol];
    if (v === 'quarter') cols = [...qCols.map(c => Object.assign({}, c, { cls: '' })), yCol];
    if (v === 'half') cols = [...hCols.map(c => Object.assign({}, c, { cls: '' })), yCol];
    if (v === 'all') cols = [...monthCols, ...qCols, ...hCols, yCol];
    if (v === 'years') { const ys = dataYears(); cols = [...ys.map(y => ({ label: y + '년', keys: monthsOf('year', y) })), { label: '누적 합계', keys: ys.flatMap(y => monthsOf('year', y)), cls: 'coltot' }]; }
    const ag = cols.map(c => aggregate(c.keys, ui.stmtExpected));
    const allKeys = cols.flatMap(c => c.keys);
    const incCats = new Set(state.categories.income), expCats = new Set(state.categories.expense), scopes = new Set(), accts = new Set();
    allKeys.forEach(k => { const m = state.months[k]; if (!m) return; m.income.forEach(x => incCats.add(x.category)); m.expense.forEach(x => { expCats.add(x.category); scopes.add(x.scope || '미지정'); }); m.balances.forEach(b => accts.add(b.name || '(계좌)')); });
    const rows = [];
    const nz = vals => vals.some(x => x);
    const add = (label, vals, cls, pct) => rows.push({ label, vals, cls, pct });
    add('Ⅰ. 수입' + (ui.stmtExpected ? ' (예상 포함)' : ''), cols.map(() => null), 'sec');
    let any = false;
    incCats.forEach(c => { const vals = ag.map(a => a.incByCat[c] || 0); if (nz(vals)) { add(c, vals, 'sub'); any = true; } });
    if (!any) add('(기록 없음)', ag.map(() => 0), 'sub');
    add('수입 합계', ag.map(a => a.income), 'tot');
    add('· 입금완료', ag.map(a => a.done), 'sub');
    add('· 입금대기 (미수금)', ag.map(a => a.pending), 'sub');
    add('· 예상수입' + (ui.stmtExpected ? '' : ' (합계 미포함)'), ag.map(a => a.expected), 'sub');
    add('Ⅱ. 지출', cols.map(() => null), 'sec');
    any = false;
    expCats.forEach(c => { const vals = ag.map(a => a.expByCat[c] || 0); if (nz(vals)) { add(c, vals, 'sub'); any = true; } });
    if (!any) add('(기록 없음)', ag.map(() => 0), 'sub');
    add('지출 합계', ag.map(a => a.expense), 'tot');
    add('· 미납', ag.map(a => a.unpaid), 'sub');
    if (scopes.size) {
      add('Ⅱ-1. 지출 구분별', cols.map(() => null), 'sec');
      SCOPES.concat(Array.from(scopes).filter(s => !SCOPES.includes(s))).forEach(s => { const vals = ag.map(a => a.expByScope[s] || 0); if (nz(vals)) add(s, vals, 'sub'); });
    }
    add('Ⅲ. 순이익 (수입 − 지출)', ag.map(a => a.hasData ? a.net : 0), 'net');
    add('이익률', ag.map(a => a.margin), 'sub', true);
    add('Ⅳ. 통장 잔고 (기간 말 기록)', cols.map(() => null), 'sec');
    accts.forEach(n => add(n, ag.map(a => a.balanceMonth ? (a.balances[n] != null ? a.balances[n] : 0) : null), 'sub'));
    add('잔고 합계', ag.map(a => a.balanceMonth ? a.balance : null), 'tot');
    const viewName = { month: '월별', quarter: '분기별', half: '반기별', all: '전체', years: '연도별' }[v];
    return { cols, rows, title: v === 'years' ? `다인에듀 손익 계산서 · 연도별` : `다인에듀 손익 계산서 · ${Y}년 (${viewName})`, fileTag: v === 'years' ? '연도별' : `${Y}_${viewName}` };
  }
  function renderStmt() {
    if (!state) return;
    const ys = dataYears();
    if (!ui.stmtYear) ui.stmtYear = ym(latestMonthKey()).y;
    $('#stmtYear').innerHTML = ys.map(y => `<option value="${y}">${y}년</option>`).join('');
    $('#stmtYear').value = ui.stmtYear;
    $('#stmtYear').classList.toggle('hidden', ui.stmtView === 'years');
    const mtx = buildStmt();
    $('#stmtTitle').textContent = mtx.title;
    const cell = (v, pct, cls) => {
      if (v == null) return `<td class="${cls || ''}"></td>`;
      if (pct) return `<td class="${cls || ''}">${Math.round(v * 100)}%</td>`;
      return `<td class="${cls || ''} ${v < 0 ? 'neg' : ''} ${v === 0 ? 'zero' : ''}">${v === 0 ? '–' : fmt(v)}</td>`;
    };
    $('#stmtTable').innerHTML = `<thead><tr><th>항목 (원)</th>${mtx.cols.map(c => `<th class="${c.cls || ''}">${c.label}</th>`).join('')}</tr></thead><tbody>` +
      mtx.rows.map(r => r.cls === 'sec' ? `<tr class="sec"><td colspan="${mtx.cols.length + 1}">${esc(r.label)}</td></tr>` :
        `<tr class="${r.cls || ''}"><td>${esc(r.label)}</td>${r.vals.map((v, i) => cell(v, r.pct, mtx.cols[i].cls)).join('')}</tr>`).join('') + '</tbody>';
  }

  // ---------- data management ----------
  function renderData() {
    if (!state) return;
    ['income', 'expense'].forEach(kind => {
      $(kind === 'income' ? '#catIncome' : '#catExpense').innerHTML = state.categories[kind].map((c, i) => `<span class="cat">${esc(c)}<button data-delcat="${kind}|${i}" title="삭제">×</button></span>`).join('');
    });
    const ks = Object.keys(state.months).filter(monthHasData).sort();
    const cnt = ks.reduce((s, k) => s + state.months[k].income.length + state.months[k].expense.length, 0);
    const lb = state.meta.lastBackupAt ? new Date(state.meta.lastBackupAt).toLocaleString('ko-KR') : '없음';
    $('#dataStats').innerHTML = ks.length ? `저장된 기간: <b>${ym(ks[0]).y}.${ym(ks[0]).m} ~ ${ym(ks[ks.length - 1]).y}.${ym(ks[ks.length - 1]).m}</b> (${ks.length}개월, 항목 ${cnt}건)<br>마지막 백업: ${lb}` : `저장된 데이터가 없습니다.<br>마지막 백업: ${lb}`;
  }
  $('#tab-data').addEventListener('click', e => {
    const d = e.target.closest('[data-delcat]');
    if (d) { const [k, i] = d.dataset.delcat.split('|'); const c = state.categories[k][+i]; if (confirm(`분류 '${c}'를 목록에서 뺄까요? (이미 입력된 항목의 분류는 그대로 유지됩니다)`)) { state.categories[k].splice(+i, 1); save(true); renderData(); } return; }
    const a = e.target.closest('[data-addcat]');
    if (a) { const k = a.dataset.addcat, inp = $(k === 'income' ? '#newCatIncome' : '#newCatExpense'); const v = inp.value.trim(); if (v && !state.categories[k].includes(v)) { state.categories[k].push(v); inp.value = ''; save(true); renderData(); } }
  });
  function exportJson() {
    state.meta.lastBackupAt = new Date().toISOString();
    const out = Object.assign({}, state, { exportedAt: new Date().toISOString() });
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const d = new Date(), tag = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    dl(blob, `dainedu_budget_backup_${tag}.json`);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { }
    renderBanner(); renderData(); toast('백업 파일을 저장했습니다');
  }
  function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function downloadCsv(rows, name) {
    const csv = rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    dl(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), name);
  }
  $('#btnExport').addEventListener('click', exportJson);
  $('#btnCsvAll').addEventListener('click', () => {
    const rows = [['월', '구분', '상태', '항목', '분류', '결제수단/구분', '청구액', '금액', '입금일', '메모']];
    Object.keys(state.months).sort().forEach(k => {
      const m = state.months[k];
      m.income.forEach(x => rows.push([k, '수입', INC_STATUS[x.status].slice(2), x.name, x.category, x.method, '', x.amount, x.date, x.memo]));
      m.expense.forEach(x => rows.push([k, '지출', x.status === 'done' ? '납부완료' : '미납', x.name, x.category, x.scope, x.billed, x.amount, '', x.memo]));
      m.balances.forEach(x => rows.push([k, '잔고', '', x.name, '', '', '', x.amount, '', '']));
    });
    downloadCsv(rows, '다인에듀_전체내역.csv');
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('이 브라우저에 저장된 모든 재무 데이터를 삭제할까요?\n삭제 전에 백업 파일을 저장해 두는 것을 권장합니다.')) return;
    if (!confirm('정말 삭제할까요? 되돌릴 수 없습니다.')) return;
    state = blank(); save(true); init(); toast('삭제했습니다');
  });
  function importFile(file, modeOverride) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      let obj;
      try { obj = JSON.parse(rd.result); } catch (e) { alert('JSON 파일을 읽을 수 없습니다.'); return; }
      if (!obj || typeof obj.months !== 'object') { alert('다인에듀 재무 백업 파일이 아닙니다.'); return; }
      const inc = normalize(obj);
      const mode = modeOverride || ($('input[name="impMode"]:checked') || {}).value || 'merge';
      if (!state || mode === 'replace') {
        if (state && monthHasDataAny() && !confirm('현재 데이터를 모두 지우고 파일 내용으로 바꿀까요?')) return;
        state = inc;
      } else {
        const over = Object.keys(inc.months).filter(k => monthHasData(k));
        if (over.length && !confirm(`다음 달은 파일 내용으로 덮어씁니다: ${over.join(', ')}\n계속할까요?`)) return;
        Object.assign(state.months, inc.months);
        ['income', 'expense'].forEach(k => inc.categories[k].forEach(c => { if (!state.categories[k].includes(c)) state.categories[k].push(c); }));
      }
      save(true);
      $('#welcome').classList.add('hidden');
      ui.year = null; ui.entryMonth = null; ui.stmtYear = null;
      init(true);
      toast(`불러오기 완료 (${Object.keys(inc.months).length}개월)`);
    };
    rd.readAsText(file, 'utf-8');
  }
  function monthHasDataAny() { return Object.keys(state.months).some(monthHasData); }
  $('#fileImport').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
  $('#fileImport2').addEventListener('change', e => { importFile(e.target.files[0], 'replace'); e.target.value = ''; });
  $('#startFresh').addEventListener('click', () => { state = blank(); save(true); $('#welcome').classList.add('hidden'); init(); showTab('entry'); });
  // drag & drop
  let dragN = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { dragN++; $('#dropHint').classList.remove('hidden'); } });
  addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#dropHint').classList.add('hidden'); });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dropHint').classList.add('hidden'); const f = e.dataTransfer.files[0]; if (f) importFile(f, state ? null : 'replace'); });

  function renderBanner() {
    const b = $('#backupBanner');
    if (!state || !monthHasDataAny()) { b.classList.add('hidden'); return; }
    const u = state.meta.updatedAt, l = state.meta.lastBackupAt;
    if (!l || (u && u > l)) {
      b.innerHTML = `💾 <span>${l ? '마지막 백업 이후 바뀐 내용이 있습니다.' : '아직 백업 파일을 저장한 적이 없습니다.'} 데이터는 이 브라우저에만 있으니 <b>백업 파일</b>을 저장해 두세요.</span><button class="btn primary" id="bannerBackup" style="padding:5px 12px">지금 백업</button>`;
      b.classList.remove('hidden');
      $('#bannerBackup').onclick = exportJson;
    } else b.classList.add('hidden');
  }

  // ---------- misc ----------
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2400); }
  let rzT;
  addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if ($('#tab-dash').classList.contains('active')) renderDash(); }, 150); });

  function init(keepTab) {
    if (!state) { $('#welcome').classList.remove('hidden'); return; }
    const lk = latestMonthKey(), { y, m } = ym(lk);
    if (ui.year == null) {
      ui.year = y;
      ui.sub = ui.pt === 'month' ? m : ui.pt === 'quarter' ? Math.ceil(m / 3) : ui.pt === 'half' ? (m <= 6 ? 1 : 2) : null;
    }
    $('#incExpected').checked = ui.incExpected;
    renderBanner();
    let t = 'dash';
    try { t = (keepTab && $('.tab.active') ? $('.tab.active').dataset.tab : localStorage.getItem(STORE_KEY + '_tab')) || 'dash'; } catch (e) { }
    showTab(t);
  }
  init();
})();
