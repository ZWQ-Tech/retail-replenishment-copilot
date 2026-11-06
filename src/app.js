/* 交互层：门店上报 → 计划员例外复核 → 下发 / 调拨 → 收货 → 指标与审计
 * 状态存 localStorage，刷新不丢；「重置演示数据」回到初始样本
 *
 * 产品级 demo 特性：
 *  - 项目总览页：试点范围、三处瓶颈、基线→目标、数据快照、岗位角色
 *  - 演示引导：分步遮罩，带你走完 6 步
 *  - 数据自动滚动：模拟「每天两次刷新」，看板数字定时更新
 *  - 口径对齐 34 条事实：可售 vs 账面、缺货截断、促销版本、线路容量、配送排队
 */
(function () {
  "use strict";

  const D = window.RC_DATA;
  const E = window.RC_ENGINE;
  const KEY = "rc.state.v3";

  // 6 个真实角色
  const ACTOR = {
    store: "林亦舟 · 店长",
    planner: "唐映秋 · 计划员",
    logistics: "叶书 · 区域物流",
    loss: "傅景 · 商品与损耗",
    data: "秦芮 · 数据工程",
    director: "顾明岚 · 运营总监",
    system: "系统"
  };

  let S = null;
  let ui = { view: "overview", planOrderId: null, storeId: "ST001", help: false, guide: -1, autoScroll: false };

  /* ---------------- 状态 ---------------- */
  function rid(prefix, n) { return prefix + String(n).padStart(4, "0"); }

  function mkRnd(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedState() {
    const rnd = mkRnd(777);
    const now = Date.now();
    const orders = [];
    const audits = [];
    let seq = 1;

    // 造一批「已下发」和「已收货」的历史样本（口径对齐 8 店 50 SKU）
    const pickSku = D.skus.filter((s, i) => i % 5 === 0).map((s) => s.id).slice(0, 12);
    let guard = 0;
    for (let i = 0; i < 20 && guard < 500; i++) {
      guard++;
      const st = D.stores[Math.floor(rnd() * D.stores.length)];
      const skuId = pickSku[Math.floor(rnd() * pickSku.length)];
      const s = E.suggest(D, st.id, skuId, {});
      if (s.qty <= 0) { i--; continue; }
      const daysAgo = 2 + Math.floor(rnd() * 10);
      const createdAt = now - daysAgo * 86400000 - Math.floor(rnd() * 8) * 3600000;
      const issuedAt = createdAt + (60 + Math.floor(rnd() * 90)) * 60000;
      const adjusted = rnd() < 0.35;
      const final = adjusted ? Math.max(s.sku.caseSize, s.qty + (rnd() < 0.5 ? -s.sku.caseSize : s.sku.caseSize)) : s.qty;
      const gotDiffs = i % 6 === 3;
      const received = gotDiffs ? Math.max(0, final - s.sku.caseSize) : final;
      const status = i < 3 ? "reported" : i < 7 ? "issued" : "received";
      // 延迟归因：约 30% 是配送排队（retail-f51）
      const delayed = rnd() < 0.3;
      const delayCause = delayed ? (rnd() < 0.8 ? "配送排队" : "预测偏差") : null;
      orders.push({
        id: rid("REQ", seq++), storeId: st.id, skuId: skuId,
        createdAt: createdAt,
        suggested: s.qty, final: status === "reported" ? null : final,
        received: status === "received" ? received : null,
        expected: status === "reported" ? null : final,
        confidence: s.confidence, ruleId: s.ruleId,
        checks: s.checks.map((c) => c.code),
        revisions: status === "reported" ? 0 : (adjusted ? 2 : 0),
        status: status,
        reason: adjusted ? "计划员按现场客流调整" : "",
        issuedAt: status === "reported" ? null : issuedAt,
        approvedBy: status === "reported" ? null : ACTOR.planner,
        delayed: delayed, delayCause: delayCause,
        source: "seed", snapshotId: D.snapshotId
      });
      if (status !== "reported") {
        audits.push({ at: issuedAt, actor: ACTOR.planner, action: "下发补货单", object: "REQ" + String(seq - 1).padStart(4, "0"), before: "-", after: "数量 " + final, snapshot: D.snapshotId });
      }
    }
    // 待复核单「刚刚发生」
    let pend = 0;
    orders.forEach((o) => { if (o.status === "reported") { o.createdAt = now - (25 + pend * 35) * 60000; pend++; } });
    // 待收货单「刚下发不久」
    let wait = 0;
    orders.forEach((o) => {
      if (o.status === "issued") {
        const issuedAt = now - (2 + wait * 4) * 3600000 - 12 * 60000;
        o.issuedAt = issuedAt;
        o.createdAt = issuedAt - (60 + Math.floor(rnd() * 90)) * 60000;
        wait++;
      }
    });
    // 让「跨店调拨」开箱可用：把前两张已下发单落到 DC 缺货品项
    const dcShort = ["S001", "S003"];
    let di = 0;
    orders.filter((o) => o.status === "issued").forEach((o) => {
      if (di >= dcShort.length) return;
      const id = dcShort[di];
      const sku = D.skus.find((x) => x.id === id);
      const want = Math.max(24, D.dc[id] + sku.caseSize * 2);
      o.skuId = id;
      o.suggested = want; o.final = want; o.expected = want;
      o.confidence = "low"; o.ruleId = "R-DC-02";
      o.reason = "DC 可用 " + D.dc[id] + " 件不足，转跨店调拨";
      di++;
    });
    orders.sort((a, b) => b.createdAt - a.createdAt);
    audits.sort((a, b) => b.at - a.at);
    return { orders: orders, transfers: [], audits: audits.slice(0, 40), seq: seq, settings: { stale: false } };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.orders && s.orders.length) return s;
      }
    } catch (e) { /* ignore */ }
    const s = seedState();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function logAudit(action, object, before, after, actor) {
    S.audits.unshift({ at: Date.now(), actor: actor || ACTOR.system, action: action, object: object, before: before == null ? "-" : String(before), after: after == null ? "-" : String(after), snapshot: D.snapshotId });
    S.audits = S.audits.slice(0, 200);
  }

  /* ---------------- 工具 ---------------- */
  const $ = (sel, el) => (el || document).querySelector(sel);
  const nf = (n) => (n == null ? "—" : Number(n).toLocaleString("zh-CN"));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function ago(ts) { const m = Math.round((Date.now() - ts) / 60000); if (m < 60) return m + " 分钟前"; const h = Math.round(m / 60); if (h < 24) return h + " 小时前"; return Math.round(h / 24) + " 天前"; }
  function hm(ts) { const d = new Date(ts); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  const confTag = (c) => c === "high" ? '<span class="tag ok">高置信</span>' : c === "medium" ? '<span class="tag mid">中置信</span>' : '<span class="tag low">低置信</span>';
  const statusTag = (st) => ({ reported: '<span class="tag mid">待复核</span>', issued: '<span class="tag ok">已下发</span>', received: '<span class="tag gray">已收货</span>', rejected: '<span class="tag low">已驳回</span>' }[st] || st);
  const storeOf = (id) => D.stores.find((s) => s.id === id) || { name: id, city: "" };
  const skuOf = (id) => D.skus.find((s) => s.id === id) || { name: id, caseSize: 1, moq: 1, category: "" };
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); }

  /* ---------------- 访谈记录弹窗 ---------------- */
  function openInterview(roleId) {
    const role = D.roles.find((r) => r.id === roleId);
    const iv = D.interviews && D.interviews[roleId];
    if (!role || !iv) { toast("暂无该角色的访谈记录"); return; }

    const qaHtml = iv.qa.map(([q, a]) => `<div class="iv-qa"><div class="iv-q">问：${esc(q)}</div><div class="iv-a">答：${esc(a)}</div></div>`).join("");
    const conHtml = iv.conclusion.map((c) => `<li>${esc(c)}</li>`).join("");

    let overlay = $("#iv-overlay");
    if (!overlay) { overlay = document.createElement("div"); overlay.id = "iv-overlay"; document.body.appendChild(overlay); }

    overlay.innerHTML = `
      <div class="iv-modal">
        <div class="iv-head">
          <div>
            <div class="iv-title">${esc(role.name)} · ${esc(role.title)}</div>
            <div class="iv-meta">${esc(iv.ivId)} · ${esc(iv.time)} · ${esc(iv.place)} · 时长 ${esc(iv.duration)}</div>
          </div>
          <button class="iv-close" data-act="close-interview">✕</button>
        </div>
        <div class="iv-body">
          <div class="iv-block">
            <div class="iv-label">访谈背景</div>
            <p>${esc(iv.background)}</p>
          </div>
          <div class="iv-block">
            <div class="iv-label">问答摘录</div>
            ${qaHtml}
          </div>
          <div class="iv-block">
            <div class="iv-label">本次访谈结论</div>
            <ul class="iv-con">${conHtml}</ul>
          </div>
          <div class="iv-foot">关联证据：${esc(iv.evidence)}　·　本记录为合成场景，不含顾客个人信息</div>
        </div>
      </div>`;
    overlay.classList.add("show");
  }
  function closeInterview() {
    const overlay = $("#iv-overlay");
    if (overlay) overlay.classList.remove("show");
  }

  /* ---------------- 统计 ---------------- */
  function shortageOf(storeId) {
    return E.detectShortage(D, storeId).map((x) => {
      const dup = S.orders.some((o) => o.status === "reported" && o.storeId === storeId && o.skuId === x.sku.id);
      const s = E.suggest(D, storeId, x.sku.id, { hasPending: dup, stale: S.settings.stale });
      return Object.assign({}, x, { sug: s });
    });
  }
  function transferCandidates() { return S.orders.filter((o) => o.status === "issued" && D.dc[o.skuId] < o.final); }

  /* ---------------- 视图：项目总览 ---------------- */
  function viewOverview() {
    const b = D.baseline;
    const totalShort = D.stores.reduce((acc, st) => acc + E.detectShortage(D, st.id).length, 0);
    const unSellable = D.stores.reduce((acc, st) => acc + D.skus.filter((sku) => { const i = D.inv[st.id + "|" + sku.id]; return i && i.onHand > 0 && i.sellable === 0; }).length, 0);

    const roleChips = D.roles.map((r) => `<button class="role-chip" data-act="interview" data-role="${esc(r.id)}" title="点击查看 ${esc(r.name)} 的访谈记录"><b>${esc(r.name)}</b>${esc(r.title)}<span class="iv-hint">访谈 ›</span></button>`).join("");

    return `
      <h1 class="page">项目总览</h1>
      <p class="hint">「拾光连锁 · 门店补货与库存协同」试点方案一览，业务口径对齐 FDE 调研 34 条事实。</p>

      <div class="hero">
        <div class="hero-main">
          <div class="hero-title">门店补货与库存协同 · 最小可用系统</div>
          <div class="hero-sub">先做「可售库存与缺货标识」口径治理，再谈销量预测 —— 规则引擎 + 例外管理，自动补货建议只生成、不下单。</div>
        </div>
        <div class="hero-kpis">
          <div class="kpi"><div class="k">试点门店</div><div class="v">${b.pilotStores}<small>家</small></div></div>
          <div class="kpi"><div class="k">试点 SKU</div><div class="v">${b.pilotSkus}<small>个常温</small></div></div>
          <div class="kpi"><div class="k">试点周期</div><div class="v">${b.pilotWeeks}<small>周</small></div></div>
          <div class="kpi"><div class="k">试点预算</div><div class="v">${b.budget}</div></div>
        </div>
      </div>

      <div class="panel">
        <h2>核心洞察（来自 34 条访谈事实）</h2>
        <div class="insights">
          <div class="insight"><span class="in-badge warn">B-1</span><div><b>有货 ≠ 可售</b><div>账面有货但货架没货，账实差异平均 8%（retail-f10/f12）。本 demo 用「账面 onHand / 可售 sellable」两个字段还原。</div></div></div>
          <div class="insight"><span class="in-badge warn">B-2</span><div><b>缺货截断误读</b><div>销量为零可能是缺货截断，不是没人买（retail-f31）；促销变价使预测失效（retail-f11）。</div></div></div>
          <div class="insight"><span class="in-badge">B-3</span><div><b>三成延迟是配送排队</b><div>约 30% 延迟补货源于配送排队而非预测（retail-f51），先核查仓库截单时间。</div></div></div>
        </div>
      </div>

      <div class="panel">
        <h2>现状基线 → 试点目标</h2>
        <div class="cards">
          <div class="card"><div class="k">缺货率</div><div class="v">${b.shortageRate}<small> → ${b.targetShortage}</small></div><div class="b">retail-f00</div></div>
          <div class="card"><div class="k">库存周转</div><div class="v">${b.turnoverDays}<small> 天 → ${b.targetTurnover} 天</small></div><div class="b">retail-f00</div></div>
          <div class="card"><div class="k">账实差异</div><div class="v">${b.stockGap}<small>（需分清有货与可售）</small></div><div class="b">retail-f12</div></div>
          <div class="card"><div class="k">延迟源于排队</div><div class="v">${b.delayedByQueue}<small>（非预测问题）</small></div><div class="b">retail-f51</div></div>
        </div>
      </div>

      <div class="panel">
        <h2>今日数据快照 <span class="sub">快照 ${D.snapshotId} · 每天刷新 2 次（retail-f34）</span></h2>
        <div class="cards">
          <div class="card"><div class="k">触发缺货的 SKU-店</div><div class="v">${nf(totalShort)}<small>条</small></div><div class="b">占全量 ${(totalShort / (D.stores.length * D.skus.length) * 100).toFixed(1)}%</div></div>
          <div class="card"><div class="k">账面有货但不可售</div><div class="v">${nf(unSellable)}<small>条</small></div><div class="b">货在后仓未上架（retail-f10）</div></div>
        </div>
      </div>

      <div class="panel">
        <h2>岗位角色 <span class="sub">6 个角色 · 点击任一角色查看其访谈记录</span></h2>
        <div class="role-chips">${roleChips}</div>
      </div>`;
  }

  /* ---------------- 视图：看板 ---------------- */
  function viewDash() {
    const live = S.orders.filter((o) => o.source === "live");
    const seeded = S.orders.filter((o) => o.source === "seed");
    const kl = E.kpi(live, D);
    const ks = E.kpi(seeded, D);
    const pending = S.orders.filter((o) => o.status === "reported").length;
    const toReceive = S.orders.filter((o) => o.status === "issued").length;
    const toTransfer = transferCandidates().filter((o) => !S.transfers.some((t) => t.orderId === o.id)).length;

    // 配送排队归因
    const delay = E.classifyDelay(S.orders.filter((o) => o.status === "issued" || o.status === "received"), D);

    let totalShort = 0; const hot = [];
    D.stores.forEach((st) => { const n = E.detectShortage(D, st.id).length; totalShort += n; if (n > 0) hot.push({ st: st, n: n }); });
    hot.sort((a, b) => b.n - a.n);

    const recent = S.audits.slice(0, 6).map((a) => `<tr><td class="mono">${hm(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.object)}</td><td>${esc(a.after)}</td></tr>`).join("");

    const delayBar = (pct, label, cls) => `<div class="bar-row"><div class="bar-label">${label} <b>${pct}%</b></div><div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div></div>`;

    return `
      <h1 class="page">指标看板</h1>
      <p class="hint">「本次会话」统计通过系统处理的单据（${kl.orderCount} 单）；「人工期基线」为 ${ks.orderCount} 单历史样本。</p>
      <div class="cards">
        <div class="card"><div class="k">建议采用率</div><div class="v">${kl.adoptRate == null ? "—" : kl.adoptRate + "<small>%</small>"}</div><div class="b">门店 3 步上报完成率</div></div>
        <div class="card"><div class="k">单均返工次数</div><div class="v">${kl.reworkPerOrder}<small>次/单</small></div><div class="b">改量/驳回 ÷ 单量</div></div>
        <div class="card"><div class="k">缺货率（目标）</div><div class="v">${kl.shortageRate}<small> → ${kl.targetShortage}</small></div><div class="b">retail-f00</div></div>
        <div class="card"><div class="k">库存周转（目标）</div><div class="v">${kl.turnoverDays}<small> → ${kl.targetTurnover} 天</small></div><div class="b">retail-f00</div></div>
      </div>

      <div class="panel">
        <h2>延迟补货归因 <span class="sub">约 30% 是配送排队，不是预测问题（retail-f51）</span></h2>
        <div class="bars">
          ${delayBar(delay.queuePct, "配送排队", "queue")}
          ${delayBar(delay.forecastPct, "预测偏差", "forecast")}
          ${delayBar(delay.otherPct, "其它", "other")}
        </div>
      </div>

      <div class="panel">
        <h2>今日缺货概览 <span class="sub">全量 ${D.stores.length} 店 · 快照 ${D.snapshotId}</span></h2>
        <div class="cards">
          <div class="card"><div class="k">触发缺货的 SKU-店</div><div class="v">${nf(totalShort)}<small>条</small></div><div class="b">占全量 ${(totalShort / (D.stores.length * D.skus.length) * 100).toFixed(1)}%</div></div>
          <div class="card"><div class="k">待复核单据</div><div class="v">${pending}<small>单</small></div><div class="b"><a href="#" data-act="goto" data-view="review">去处理 →</a></div></div>
          <div class="card"><div class="k">待调拨审批</div><div class="v">${toTransfer}<small>单</small></div><div class="b">DC 库存不足的已下发单</div></div>
          <div class="card"><div class="k">待到货确认</div><div class="v">${toReceive}<small>单</small></div><div class="b"><a href="#" data-act="goto" data-view="receive">去收货 →</a></div></div>
        </div>
      </div>

      <div class="panel">
        <h2>缺货最集中的门店 <span class="sub">Top 6</span></h2>
        <table><thead><tr><th>门店</th><th>业态</th><th class="num">触发条数</th><th>主要缺货品项</th></tr></thead>
          <tbody>${hot.slice(0, 6).map((h) => { const items = E.detectShortage(D, h.st.id).slice(0, 3).map((x) => x.sku.name).join("、"); return `<tr><td><b>${esc(h.st.name)}</b></td><td>${esc(h.st.format)}</td><td class="num">${h.n}</td><td style="color:#5b6b66">${esc(items)}</td></tr>`; }).join("")}</tbody></table>
      </div>

      <div class="panel">
        <h2>最近操作 <span class="sub">全部动作留痕，可追溯</span></h2>
        <table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>结果</th></tr></thead><tbody>${recent || '<tr><td colspan="5" class="empty">暂无记录</td></tr>'}</tbody></table>
        <div class="kpi-note">说明：采用率 = 门店按建议通过的单数 ÷ 已处理单数；返工 = 改量/驳回次数 ÷ 单量；缺货率与周转为试点基线口径（retail-f00），促销期误差需单列（retail-f42）。</div>
      </div>`;
  }

  /* ---------------- 视图：缺货上报 ---------------- */
  function viewReport() {
    const list = shortageOf(ui.storeId);
    const store = storeOf(ui.storeId);
    const rows = list.map((x) => {
      const s = x.sug;
      const blocked = s.blocked || s.qty === 0;
      const codes = s.checks.map((c) => `<span class="tag code" title="${esc(c.msg)}">${esc(c.code)}</span>`).join(" ");
      const sellNote = x.code === "有货不可售" ? '<span class="tag low">有货不可售</span>' : "";
      return `<tr>
        <td><input type="checkbox" data-sku="${x.sku.id}" ${blocked ? "disabled" : ""}></td>
        <td><b>${esc(x.sku.name)}</b><div class="mono">${x.sku.id} · ${x.sku.category}</div></td>
        <td class="num">${s.onHand}</td>
        <td class="num">${s.sellable}</td>
        <td class="num">${s.inTransit}</td>
        <td class="num">${s.daily.toFixed(1)}</td>
        <td class="num"><b>${s.qty}</b></td>
        <td>${confTag(s.confidence)}</td>
        <td>${sellNote}${codes || '<span class="tag ok">通过校验</span>'}</td>
      </tr>`;
    }).join("");

    return `
      <h1 class="page">缺货上报</h1>
      <p class="hint">门店端只需 3 步：选门店 → 勾选缺货品项 → 提交。系统按「可售」而非「账面」识别缺货（retail-f10/f12），店长不必再逐个数货架。</p>
      <div class="steps">
        <div class="step"><span class="n">1</span><div class="t"><strong>选择门店</strong>当前：${esc(store.name)}（${esc(store.format)}）</div></div>
        <div class="step"><span class="n">2</span><div class="t"><strong>勾选缺货品项</strong>共识别 ${list.length} 条，其中 ${list.filter((x) => !x.sug.blocked && x.sug.qty > 0).length} 条可补货</div></div>
        <div class="step"><span class="n">3</span><div class="t"><strong>提交上报</strong>提交后进入「建议审核」，由计划员确认</div></div>
      </div>
      <div class="panel">
        <div class="row between">
          <div class="row"><label>门店</label><select id="store-select">${D.stores.map((s) => `<option value="${s.id}" ${s.id === ui.storeId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select><span class="mono">快照 ${D.snapshotId}</span></div>
          <button class="btn" data-act="submit-report">提交上报</button>
        </div>
      </div>
      <div class="panel">
        <h2>系统识别的缺货清单 <span class="sub">基于可售库存；账面有货但可售为 0 的会单独标注</span></h2>
        ${list.length ? `<table><thead><tr><th style="width:34px"></th><th>SKU</th><th class="num">账面</th><th class="num">可售</th><th class="num">在途</th><th class="num">近7日均销</th><th class="num">建议量</th><th>置信度</th><th>校验</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">该门店当前无缺货。</div>'}
        <div class="legend">建议量 = 安全库存 + 陈列覆盖 − 可售库存 − 在途，按整箱取整且不低于起订量；线路容量超出时阻断（E_LINE_CAP）。校验码悬停可看原因。</div>
      </div>`;
  }

  /* ---------------- 视图：建议审核 ---------------- */
  function viewReview() {
    const list = S.orders.filter((o) => o.status === "reported").sort((a, b) => b.createdAt - a.createdAt);
    const items = list.map((o) => {
      const sku = skuOf(o.skuId); const store = storeOf(o.storeId);
      const checks = (o.checks || []).map((c) => `<span class="tag code">${esc(c)}</span>`).join(" ");
      const fb = E.shouldFallback({ stockoutDays: o.stockoutDays, promoSynced: o.promoSynced, promo: o.promo, gap: o.gap, onHand: o.onHand, sellable: o.sellable, validDays: o.validDays, checks: [] });
      const fbTag = fb.fallback ? `<span class="tag low" title="${esc(fb.reasons.join('、'))}">兜底触发</span>` : "";
      return `<div class="order">
        <div class="head"><b>${esc(store.name)}</b><span class="tag gray">${esc(sku.name)}</span><span class="mono">${o.id}</span>${confTag(o.confidence)}<span class="mono">规则 ${esc(o.ruleId)}</span>${fbTag}<span style="margin-left:auto;color:#71807b;font-size:12px">${ago(o.createdAt)}上报</span></div>
        <div class="calc">系统建议 <b>${o.suggested}</b> ${esc(sku.category)} · 整箱 ${sku.caseSize} · 起订 ${sku.moq}</div>
        <div class="checks">${checks || '<span class="tag ok">硬约束全部通过</span>'}</div>
        <div class="act"><label>改为</label><input type="number" min="0" step="${sku.caseSize}" id="qty-${o.id}" value="${o.suggested}"><input type="text" id="reason-${o.id}" placeholder="改量理由（改量必填）"><button class="btn small" data-act="approve" data-id="${o.id}">通过并下发</button><button class="btn small danger" data-act="reject" data-id="${o.id}">驳回</button></div>
      </div>`;
    }).join("");
    return `<h1 class="page">建议审核（例外管理）</h1>
      <p class="hint">计划员只处理例外：低/中置信、改量、超上限。改量必须写理由（retail-f25）。兜底触发（缺货截断/促销未回传/账实不一致）的单会自动标注，需人工确认（retail-f44）。</p>
      <div class="panel"><h2>待复核 ${list.length} 单</h2>${items || '<div class="empty">没有待复核单据。</div>'}</div>`;
  }

  /* ---------------- 视图：调拨 ---------------- */
  function viewTransfer() {
    const cand = transferCandidates();
    if (!cand.length) {
      return `<h1 class="page">跨店调拨</h1><p class="hint">当 DC 库存不足时，系统按 5 因子评分推荐可调出门店（retail-f22 需区域经理批准）。</p><div class="panel"><div class="empty">当前没有「DC 库存不足」的已下发单据。先在上报→审核走一单，再回来看调拨建议。</div></div>`;
    }
    const blocks = cand.map((o) => {
      const sku = skuOf(o.skuId); const store = storeOf(o.storeId);
      const dc = D.dc[o.skuId];
      const done = S.transfers.filter((t) => t.orderId === o.id);
      let plan = "";
      if (ui.planOrderId === o.id && !done.length) {
        const opts = E.rankTransfers(D, o.storeId, o.skuId, o.final);
        plan = `<table style="margin-top:10px"><thead><tr><th>候选调出门店</th><th class="num">可调出</th><th class="num">剩余效期</th><th class="num">距离</th><th class="num">评分</th><th></th></tr></thead><tbody>${opts.map((x) => `<tr><td><b>${esc(x.storeName)}</b><div class="mono">${x.storeId}</div></td><td class="num">${x.avail}</td><td class="num">${x.shelfLeftDays} 天</td><td class="num">${x.distanceKm} km</td><td class="num"><b>${x.score.toFixed(3)}</b></td><td><button class="btn small" data-act="do-transfer" data-id="${o.id}" data-store="${x.storeId}">审批并生成调拨单</button></td></tr>`).join("")}</tbody></table><div class="legend">评分 = 0.35×富余度 + 0.25×效期紧迫 + 0.20×距离 + 0.10×同城 + 0.10×装载匹配；调出后本店可售不得低于安全库存。</div>`;
      }
      return `<div class="order"><div class="head"><b>${esc(store.name)}</b><span class="tag gray">${esc(sku.name)}</span><span class="mono">${o.id}</span><span class="tag low">DC 可用 ${dc} 件 < 需求 ${o.final} 件</span></div>${done.length ? `<div class="calc">已生成调拨单：${done.map((t) => `${esc(storeOf(t.fromStore).name)} → ${t.qty} 件（${esc(t.status)}）`).join("；")}</div>` : `<div class="act" style="margin-top:8px"><button class="btn small ghost" data-act="plan-transfer" data-id="${o.id}">查看调拨建议</button></div>`}${plan}</div>`;
    }).join("");
    return `<h1 class="page">跨店调拨</h1><p class="hint">解决「一边报废一边缺货」：调拨必须由叶书（区域物流）审批，评分与审批意见全部留痕（retail-f22）。</p><div class="panel"><h2>DC 库存不足的单据 ${cand.length} 单</h2>${blocks}</div>`;
  }

  /* ---------------- 视图：收货（门店可见预计到货） ---------------- */
  function viewReceive() {
    const list = S.orders.filter((o) => o.status === "issued").sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0));
    const rows = list.map((o) => {
      const sku = skuOf(o.skuId); const store = storeOf(o.storeId);
      const unmet = o.final - (D.inv[o.storeId + "|" + o.skuId] ? D.inv[o.storeId + "|" + o.skuId].sellable : 0);
      return `<tr><td class="mono">${o.id}</td><td>${esc(store.name)}</td><td>${esc(sku.name)}</td><td class="num">${o.final}</td><td class="num">${o.expected}</td><td class="num">${unmet > 0 ? unmet : 0}</td><td>${o.issuedAt ? hm(o.issuedAt) : "—"}</td><td><input type="number" min="0" id="recv-${o.id}" value="${o.final}" style="width:70px"></td><td><button class="btn small" data-act="receive" data-id="${o.id}">确认收货</button></td></tr>`;
    }).join("");
    return `<h1 class="page">到货确认（门店可见）</h1>
      <p class="hint">门店可见「预计到货」与「未满足数量」，减少无效催货（retail-f52/f01）。实收与下发不一致时自动开异常单，计入「版本正确率」。</p>
      <div class="panel"><h2>待到货 ${list.length} 单</h2>${list.length ? `<table><thead><tr><th>单据</th><th>门店</th><th>SKU</th><th class="num">下发</th><th class="num">预计到货</th><th class="num">未满足</th><th>下发时间</th><th class="num">实收</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">没有待到货单据。</div>'}</div>`;
  }

  /* ---------------- 视图：审计 ---------------- */
  function viewAudit() {
    const rows = S.audits.map((a) => `<tr><td class="mono">${hm(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.object)}</td><td>${esc(a.before)}</td><td>${esc(a.after)}</td><td class="mono">${esc(a.snapshot)}</td></tr>`).join("");
    return `<h1 class="page">审计日志</h1><p class="hint">每条记录含操作人、动作、前后值、快照版本，可重建当次处理（retail-f45）；不记录口令与非必要个人信息。</p><div class="panel"><h2>共 ${S.audits.length} 条</h2><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>前值</th><th>后值</th><th>快照</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">暂无记录</td></tr>'}</tbody></table></div>`;
  }

  /* ---------------- 视图：规则 ---------------- */
  function viewRules() {
    const codes = [
      ["E_SHELF_LIFE", "剩余保质期 < 提前期 + 7 天", "阻断", "禁止补货，改走调拨或折价"],
      ["E_LINE_CAP", "建议量超出本店线路容量", "阻断", "拆单或人工确认（retail-f50）"],
      ["E_DUPLICATE", "同店同 SKU 24 小时内已有待处理单", "阻断", "合并提示，不重复生成"],
      ["E_STALE", "快照超过 36 小时", "阻断", "退回手工模式"],
      ["W_STOCK_CAP", "补后可售 > 30 天周转上限", "告警", "截断至上限并标注"],
      ["W_SPARSE", "近 7 日有效销售 < 3 天", "告警", "转人工，置信度降为 low"],
      ["W_STOCKOUT", "近 14 日存在缺货截断", "告警", "需求可能被低估（retail-f31）"],
      ["W_PROMO", "促销版本未回传", "告警", "建议量按促销期销量算（retail-f21）"],
    ].map((r) => `<tr><td class="mono">${r[0]}</td><td>${r[1]}</td><td>${r[2] === "阻断" ? '<span class="tag low">阻断</span>' : '<span class="tag mid">告警</span>'}</td><td>${r[3]}</td></tr>`).join("");
    return `<h1 class="page">规则与参数</h1><p class="hint">规则参数按品类可覆盖，所有单据记录命中的规则 ID 与快照版本（retail-f24/f34）。</p>
      <div class="panel"><h2>校验码</h2><table><thead><tr><th>错误码</th><th>触发条件</th><th>级别</th><th>处置</th></tr></thead><tbody>${codes}</tbody></table></div>
      <div class="panel"><h2>配送日历 <span class="sub">周一、三、五固定配送（retail-f50）</span></h2><div class="legend">${D.deliveryDays.map((d) => ["", "周一", "", "周三", "", "周五"][d]).filter(Boolean).join("、")} 固定配送；线路容量按门店业态设定（园区店较大，社区/商圈店有限）。</div></div>`;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    document.querySelectorAll(".side button").forEach((b) => { b.classList.toggle("active", b.dataset.view === ui.view); });
    const views = { overview: viewOverview, dash: viewDash, report: viewReport, review: viewReview, transfer: viewTransfer, receive: viewReceive, audit: viewAudit, rules: viewRules };
    $("#main").innerHTML = (views[ui.view] || viewOverview)();
    $("#snap").textContent = "数据快照 " + D.snapshotId;
    const pend = S.orders.filter((o) => o.status === "reported").length;
    const recv = S.orders.filter((o) => o.status === "issued").length;
    const tran = transferCandidates().filter((o) => !S.transfers.some((t) => t.orderId === o.id)).length;
    const badge = (id, n) => { const el = $(id); if (el) { el.hidden = !n; el.textContent = n; } };
    badge("#n-review", pend); badge("#n-receive", recv); badge("#n-transfer", tran);
    const st = $("#store-select");
    if (st) st.addEventListener("change", (e) => { ui.storeId = e.target.value; render(); });
    const as = $("#btn-auto");
    if (as) { as.classList.toggle("on", ui.autoScroll); as.textContent = ui.autoScroll ? "⏸ 停止自动滚动" : "▶ 自动滚动演示"; }
  }

  /* ---------------- 演示引导 ---------------- */
  const GUIDE_STEPS = [
    { view: "overview", title: "第 1 步 · 项目总览", text: "先看整体：8 店 50 SKU 试点、16 万预算、三处瓶颈（有货≠可售 / 缺货截断 / 配送排队）。" },
    { view: "dash", title: "第 2 步 · 指标看板", text: "看「延迟补货归因」——约 30% 是配送排队不是预测。再看今日缺货概览与缺货最集中的门店。" },
    { view: "report", title: "第 3 步 · 缺货上报", text: "门店端 3 步上报。注意「账面」与「可售」两列：有些货账面有但可售为 0（有货不可售）。勾选品项提交。" },
    { view: "review", title: "第 4 步 · 建议审核", text: "计划员只处理例外。改量必须写理由；兜底触发（缺货截断/促销未回传）的单会自动标注，需人工确认。" },
    { view: "transfer", title: "第 5 步 · 跨店调拨", text: "DC 库存不足时按 5 因子评分推荐调出门店，叶书审批留痕。" },
    { view: "receive", title: "第 6 步 · 到货确认", text: "门店可见预计到货与未满足数量。实收与下发不一致自动开异常单。" },
  ];

  function startGuide() {
    ui.guide = 0; renderGuide(); render();
  }
  function renderGuide() {
    const el = $("#guide-layer");
    if (ui.guide < 0 || ui.guide >= GUIDE_STEPS.length) { if (el) el.remove(); return; }
    const step = GUIDE_STEPS[ui.guide];
    ui.view = step.view; render();
    const card = `<div class="guide-card"><div class="g-title">${esc(step.title)}</div><div class="g-text">${esc(step.text)}</div><div class="g-foot"><span>${ui.guide + 1} / ${GUIDE_STEPS.length}</span><span class="spacer"></span>${ui.guide > 0 ? '<button class="btn small ghost" data-g="prev">上一步</button>' : ""}<button class="btn small" data-g="next">${ui.guide === GUIDE_STEPS.length - 1 ? "完成" : "下一步"}</button></div></div>`;
    let layer = $("#guide-layer");
    if (!layer) { layer = document.createElement("div"); layer.id = "guide-layer"; layer.innerHTML = card; document.body.appendChild(layer); }
    else { layer.innerHTML = card; }
  }

  /* ---------------- 自动滚动 ---------------- */
  let autoTimer = null;
  function toggleAuto() {
    ui.autoScroll = !ui.autoScroll;
    if (ui.autoScroll) {
      // 自动滚动：循环切换视图，模拟「每天两次刷新」
      const order = ["overview", "dash", "report", "review", "transfer", "receive", "audit"];
      let idx = order.indexOf(ui.view);
      autoTimer = setInterval(() => {
        idx = (idx + 1) % order.length;
        ui.view = order[idx];
        render();
      }, 3000);
      toast("自动滚动已开启，每 3 秒切换一个页面");
    } else {
      clearInterval(autoTimer);
      toast("自动滚动已停止");
    }
    render();
  }

  /* ---------------- 交互 ---------------- */
  document.addEventListener("click", (e) => {
    // 点击访谈弹窗背景空白处关闭
    if (e.target && e.target.id === "iv-overlay") { closeInterview(); return; }

    const t = e.target.closest("[data-act], [data-view], [data-g]");
    if (!t) return;

    if (t.dataset.g) {
      if (t.dataset.g === "next") { ui.guide++; if (ui.guide >= GUIDE_STEPS.length) { ui.guide = -1; toast("引导结束，可自由探索"); } }
      else if (t.dataset.g === "prev") { ui.guide--; }
      renderGuide();
      return;
    }
    if (t.dataset.view && t.closest(".side")) { ui.view = t.dataset.view; ui.planOrderId = null; render(); return; }
    if (t.dataset.act === "goto") { e.preventDefault(); ui.view = t.dataset.view; render(); return; }

    const act = t.dataset.act;
    if (act === "interview") { e.preventDefault(); openInterview(t.dataset.role); return; }
    if (act === "close-interview") { e.preventDefault(); closeInterview(); return; }
    if (act === "submit-report") {
      const checked = Array.from(document.querySelectorAll('input[data-sku]:checked')).map((c) => c.dataset.sku);
      if (!checked.length) { toast("先勾选要上报的缺货品项"); return; }
      let n = 0;
      checked.forEach((skuId) => {
        const s = E.suggest(D, ui.storeId, skuId, { stale: S.settings.stale });
        if (s.qty <= 0 || s.blocked) return;
        S.seq += 1;
        const id = rid("REQ", S.seq);
        S.orders.unshift({
          id: id, storeId: ui.storeId, skuId: skuId, createdAt: Date.now(),
          suggested: s.qty, final: null, received: null, expected: null,
          confidence: s.confidence, ruleId: s.ruleId, checks: s.checks.map((c) => c.code),
          revisions: 0, status: "reported", reason: "", issuedAt: null, approvedBy: null,
          stockoutDays: s.stockoutDays, promo: s.promo, promoSynced: s.promoSynced,
          gap: s.gap, onHand: s.onHand, sellable: s.sellable, validDays: s.validDays,
          delayed: false, delayCause: null, source: "live", snapshotId: D.snapshotId
        });
        logAudit("门店上报缺货", id, "-", `建议 ${s.qty}（${s.ruleId}）`, ACTOR.store);
        n++;
      });
      save(); ui.view = "review"; render();
      toast(n ? `已提交 ${n} 单，进入建议审核` : "勾选的品项均被硬约束拦截，未生成单据");
      return;
    }

    if (act === "approve" || act === "reject") {
      const id = t.dataset.id; const o = S.orders.find((x) => x.id === id); if (!o) return;
      const qtyEl = document.getElementById("qty-" + id); const reasonEl = document.getElementById("reason-" + id);
      if (act === "reject") { o.status = "rejected"; o.reason = (reasonEl && reasonEl.value) || "计划员驳回"; logAudit("驳回补货建议", id, o.suggested, o.reason, ACTOR.planner); save(); render(); toast("已驳回并记录理由"); return; }
      const q = Number(qtyEl.value);
      if (!(q > 0)) { toast("数量必须大于 0"); return; }
      if (q !== o.suggested && !(reasonEl.value || "").trim()) { toast("改量必须填写理由（用于返工分析）"); reasonEl.focus(); return; }
      o.final = q; o.expected = q; o.reason = (reasonEl.value || "").trim();
      if (q !== o.suggested) o.revisions += 1;
      o.status = "issued"; o.issuedAt = Date.now(); o.approvedBy = ACTOR.planner;
      logAudit("审核通过并下发", id, `建议 ${o.suggested}`, `下发 ${q}`, ACTOR.planner);
      save(); render(); toast(q === o.suggested ? "已按建议下发" : `已改量为 ${q} 并下发`);
      return;
    }

    if (act === "plan-transfer") { ui.planOrderId = t.dataset.id; render(); return; }
    if (act === "do-transfer") {
      const id = t.dataset.id; const o = S.orders.find((x) => x.id === id); if (!o) return;
      const opts = E.rankTransfers(D, o.storeId, o.skuId, o.final);
      const pick = opts.find((x) => x.storeId === t.dataset.store); if (!pick) return;
      S.transfers.push({ id: "TR" + String(S.transfers.length + 1).padStart(4, "0"), orderId: id, fromStore: pick.storeId, toStore: o.storeId, skuId: o.skuId, qty: Math.min(pick.avail, o.final), score: pick.score, status: "已审批", at: Date.now(), approvedBy: ACTOR.logistics });
      logAudit("审批跨店调拨", id, "DC 不足", `${storeOf(pick.storeId).name} → ${storeOf(o.storeId).name}，${Math.min(pick.avail, o.final)} 件，评分 ${pick.score.toFixed(3)}`, ACTOR.logistics);
      ui.planOrderId = null; save(); render(); toast("调拨单已生成并留痕");
      return;
    }
    if (act === "receive") {
      const id = t.dataset.id; const o = S.orders.find((x) => x.id === id); const el = document.getElementById("recv-" + id);
      const got = Number(el.value);
      if (!(got >= 0)) { toast("请填写实收数量"); return; }
      o.received = got; o.status = "received";
      const diff = got !== o.final;
      logAudit("到货确认", id, `应到 ${o.final}`, `实收 ${got}${diff ? "（差异，已开异常单）" : ""}`, ACTOR.store);
      if (diff) logAudit("异常单：数量差异", id, o.final, got, ACTOR.system);
      save(); render(); toast(diff ? "已收货，并自动生成数量差异异常单" : "已收货，账实一致");
      return;
    }
  });

  $("#btn-reset").addEventListener("click", () => { if (!confirm("重置为初始演示数据？当前会话产生的单据会清空。")) return; localStorage.removeItem(KEY); S = load(); ui.view = "overview"; ui.planOrderId = null; ui.autoScroll = false; clearInterval(autoTimer); render(); toast("已重置演示数据"); });
  $("#btn-guide").addEventListener("click", () => startGuide());
  $("#btn-auto").addEventListener("click", () => toggleAuto());
  $("#btn-help").addEventListener("click", () => {
    alert(
      "演示脚本（约 5 分钟）\n\n" +
      "0. 项目总览：8 店 50 SKU 试点、16 万预算、三处瓶颈。\n" +
      "1. 指标看板：看「延迟归因」——30% 是配送排队；看今日缺货概览。\n" +
      "2. 缺货上报：门店选任一家，勾选缺货品项（注意「账面 vs 可售」两列）→ 提交。\n" +
      "3. 建议审核：改量必须填理由；兜底触发单会自动标注。\n" +
      "4. 跨店调拨：DC 不足的单查看 5 因子评分 → 审批生成调拨单。\n" +
      "5. 到货确认：实收少于应到 → 自动开差异异常单。\n" +
      "6. 审计日志：全部动作可追溯。\n\n" +
      "点右上角「▶ 自动滚动」可循环播放全部页面。"
    );
  });

  S = load();
  render();
})();
