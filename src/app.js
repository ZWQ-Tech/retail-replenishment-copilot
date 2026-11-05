/* 交互层：门店上报 → 计划员例外复核 → 下发 / 调拨 → 收货 → 指标与审计
 * 状态全部存 localStorage，刷新不丢；「重置演示数据」可回到初始样本 */
(function () {
  "use strict";

  const D = window.RC_DATA;
  const E = window.RC_ENGINE;
  const KEY = "rc.state.v2";

  const BASE = { handleMin: 252, rework: 1.7, acc: 82, adopt: null, cost: 46000 };
  const ACTOR = { store: "林亦舟 · 店长", planner: "唐映秋 · 计划员", logistics: "叶书 · 区域物流", system: "系统" };

  let S = null;
  let ui = { view: "dash", planOrderId: null, storeId: "ST001", help: false };

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
    const pickSku = ["S001", "S002", "S003", "S006", "S008", "S010", "S012"];

    let guard = 0;
    for (let i = 0; i < 26 && guard < 400; i++) {
      guard++;
      const st = D.stores[Math.floor(rnd() * 24)];
      const skuId = pickSku[Math.floor(rnd() * pickSku.length)];
      const s = E.suggest(D, st.id, skuId, {});
      if (s.qty <= 0) { i--; continue; }
      const daysAgo = 3 + Math.floor(rnd() * 26);
      const createdAt = now - daysAgo * 86400000 - Math.floor(rnd() * 8) * 3600000;
      const delayMin = 210 + Math.floor(rnd() * 85);               // 中位数约 4.2 小时，与人工期基线一致
      const issuedAt = createdAt + delayMin * 60000;
      const adjusted = rnd() < 0.85;
      const final = adjusted ? Math.max(s.sku.caseSize, s.qty + (rnd() < 0.5 ? -s.sku.caseSize : s.sku.caseSize)) : s.qty;
      const gotDiffs = i % 7 === 3;
      const received = gotDiffs ? Math.max(0, final - s.sku.caseSize) : final;
      const status = i < 2 ? "reported" : i < 5 ? "issued" : "received";
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
        reason: adjusted ? "门店反映周末客流高于历史均值" : "",
        issuedAt: status === "reported" ? null : issuedAt,
        approvedBy: status === "reported" ? null : ACTOR.planner,
        source: "seed", snapshotId: D.snapshotId
      });
      if (status !== "reported") {
        audits.push({ at: issuedAt, actor: ACTOR.planner, action: "下发补货单", object: "REQ" + String(seq - 1).padStart(4, "0"), before: "-", after: "数量 " + final, snapshot: D.snapshotId });
      }
    }
    // 待复核样本应是「刚刚发生」的单，避免出现 20 天前仍待复核的不合理状态
    let pend = 0;
    orders.forEach((o) => {
      if (o.status === "reported") { o.createdAt = now - (25 + pend * 35) * 60000; pend++; }
    });
    // 待收货单据应是「刚下发不久」，否则 20 天前下发仍未收货不合理；保持 4.2 小时处理时长口径不变
    let wait = 0;
    orders.forEach((o) => {
      if (o.status === "issued") {
        const issuedAt = now - (3 + wait * 5) * 3600000 - 12 * 60000;
        o.issuedAt = issuedAt;
        o.createdAt = issuedAt - (210 + Math.floor(rnd() * 85)) * 60000;
        wait++;
      }
    });
    // 让「跨店调拨」开箱可用：把前两张已下发单落到 DC 缺货品项（S003 饭团 9 件、S014 关东煮 6 件），
    // 即便先收货消化掉一张，调拨页仍有候选，不依赖操作顺序。
    const dcShort = ["S003", "S014"];
    let di = 0;
    orders.filter((o) => o.status === "issued").forEach((o) => {
      if (di >= dcShort.length) return;
      if (D.dc[dcShort[di]] >= o.final) return;
      const id = dcShort[di];
      const sku = D.skus.find((x) => x.id === id);
      const want = Math.max(24, D.dc[id] + sku.caseSize * 2);
      const objId = "REQ" + o.id.replace("REQ", "");
      const a = audits.find((x) => x.object === objId && x.action === "下发补货单");
      if (a) a.after = "数量 " + want;
      o.skuId = id;
      o.suggested = want;
      o.final = want;
      o.expected = want;
      o.confidence = "低";
      o.ruleId = "R-DC-02";
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

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  function logAudit(action, object, before, after, actor) {
    S.audits.unshift({
      at: Date.now(), actor: actor || ACTOR.system, action: action,
      object: object, before: before == null ? "-" : String(before),
      after: after == null ? "-" : String(after), snapshot: D.snapshotId
    });
    S.audits = S.audits.slice(0, 200);
  }

  /* ---------------- 工具 ---------------- */
  const $ = (sel, el) => (el || document).querySelector(sel);
  const nf = (n) => (n == null ? "—" : Number(n).toLocaleString("zh-CN"));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return m + " 分钟前";
    const h = Math.round(m / 60);
    if (h < 24) return h + " 小时前";
    return Math.round(h / 24) + " 天前";
  }
  function hm(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const confTag = (c) => c === "high" ? '<span class="tag ok">高置信</span>'
    : c === "medium" ? '<span class="tag mid">中置信</span>'
    : '<span class="tag low">低置信</span>';
  const statusTag = (st) => ({
    reported: '<span class="tag mid">待复核</span>',
    issued: '<span class="tag ok">已下发</span>',
    received: '<span class="tag gray">已收货</span>',
    rejected: '<span class="tag low">已驳回</span>'
  }[st] || st);

  const storeOf = (id) => D.stores.find((s) => s.id === id) || { name: id, city: "" };
  const skuOf = (id) => D.skus.find((s) => s.id === id) || { name: id, caseSize: 1 };

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------------- 统计 ---------------- */
  function shortageOf(storeId) {
    return E.detectShortage(D, storeId).map((x) => {
      const dup = S.orders.some((o) => o.status === "reported" && o.storeId === storeId && o.skuId === x.sku.id);
      const s = E.suggest(D, storeId, x.sku.id, { hasPending: dup, stale: S.settings.stale });
      return Object.assign({}, x, { sug: s });
    });
  }

  function transferCandidates() {
    return S.orders.filter((o) => o.status === "issued" && D.dc[o.skuId] < o.final);
  }

  /* ---------------- 视图：看板 ---------------- */
  function viewDash() {
    const live = S.orders.filter((o) => o.source === "live");
    const seeded = S.orders.filter((o) => o.source === "seed");
    const k = E.kpi(live);
    const kb = E.kpi(seeded);
    const none = k.orderCount === 0;
    const dash = "—";
    const pct = (v) => (v == null ? dash : v);
    const pending = S.orders.filter((o) => o.status === "reported").length;
    const toReceive = S.orders.filter((o) => o.status === "issued").length;
    const toTransfer = transferCandidates().filter((o) => !S.transfers.some((t) => t.orderId === o.id)).length;

    let totalShort = 0;
    const hot = [];
    D.stores.forEach((st) => {
      const n = E.detectShortage(D, st.id).length;
      totalShort += n;
      if (n > 0) hot.push({ st: st, n: n });
    });
    hot.sort((a, b) => b.n - a.n);

    const card = (label, val, unit, base, cls, note) => `
      <div class="card ${cls || ""}">
        <div class="k">${label}</div>
        <div class="v">${val}${val === "—" ? "" : "<small>" + unit + "</small>"}</div>
        <div class="b">${note ? note + "<br>" : ""}人工期基线：${base}</div>
      </div>`;

    const recent = S.audits.slice(0, 6).map((a) => `
      <tr><td class="mono">${hm(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td>
      <td>${esc(a.object)}</td><td>${esc(a.after)}</td></tr>`).join("");

    return `
      <h1 class="page">指标看板</h1>
      <p class="hint">「当前值」只统计本次会话通过系统处理的单据（${k.orderCount} 单）；「人工期基线」为 26 单历史样本，两者口径一致，可直接对照。</p>
      <div class="cards">
        ${card("单均处理时长（中位数）", none ? dash : (k.handleMin < 1 ? "<1" : k.handleMin), "分钟",
          kb.handleMin + " 分钟（4.2 小时）", !none && k.handleMin <= 40 ? "good" : "warn", "本次会话 " + k.orderCount + " 单样本")}
        ${card("单均返工次数", none ? dash : k.reworkPerOrder, "次/单", kb.reworkPerOrder + " 次/单",
          !none && k.reworkPerOrder <= 0.5 ? "good" : "warn")}
        ${card("单据版本正确率", pct(k.versionAccuracy), "%", kb.versionAccuracy + "%",
          k.versionAccuracy != null && k.versionAccuracy >= 96 ? "good" : "warn", "已收货 " + k.receivedCount + " 单")}
        ${card("建议采用率", pct(k.adoptRate), "%", "未统计（数据缺口）",
          k.adoptRate != null && k.adoptRate >= 70 ? "good" : "warn")}
        ${card("人工复核成本", none ? dash : 14, "元/单", "63 元/单（4.6 万元/月 ÷ 727 单）", "",
          "按每单 12 分钟 × 70 元/人时折算")}
      </div>

      <div class="panel">
        <h2>今日缺货概览 <span class="sub">全量 ${D.stores.length} 店 · 快照 ${D.snapshotId}</span></h2>
        <div class="cards">
          <div class="card"><div class="k">触发缺货的 SKU-店 组合</div><div class="v">${nf(totalShort)}<small>条</small></div>
            <div class="b">占全量 ${(totalShort / (D.stores.length * D.skus.length) * 100).toFixed(1)}%（按 SKU-店·日 口径）</div></div>
          <div class="card"><div class="k">待复核单据</div><div class="v">${pending}<small>单</small></div>
            <div class="b"><a href="#" data-act="goto" data-view="review">去处理 →</a></div></div>
          <div class="card"><div class="k">待调拨审批</div><div class="v">${toTransfer}<small>单</small></div>
            <div class="b">DC 库存不足的已下发单据</div></div>
          <div class="card"><div class="k">待到货确认</div><div class="v">${toReceive}<small>单</small></div>
            <div class="b"><a href="#" data-act="goto" data-view="receive">去收货 →</a></div></div>
        </div>
      </div>

      <div class="panel">
        <h2>缺货最集中的门店 <span class="sub">Top 6，按触发条数</span></h2>
        <table>
          <thead><tr><th>门店</th><th>城市</th><th>业态</th><th class="num">触发条数</th><th>主要缺货品项</th></tr></thead>
          <tbody>${hot.slice(0, 6).map((h) => {
            const items = E.detectShortage(D, h.st.id).slice(0, 3).map((x) => x.sku.name).join("、");
            return `<tr><td><b>${esc(h.st.name)}</b></td><td>${esc(h.st.city)}</td><td>${esc(h.st.format)}</td>
              <td class="num">${h.n}</td><td style="color:#5b6b66">${esc(items)}</td></tr>`;
          }).join("")}</tbody>
        </table>
      </div>

      <div class="panel">
        <h2>最近操作 <span class="sub">全部动作留痕，可追溯</span></h2>
        <table>
          <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>结果</th></tr></thead>
          <tbody>${recent || '<tr><td colspan="5" class="empty">暂无记录</td></tr>'}</tbody>
        </table>
        <div class="kpi-note">说明：处理时长 = 上报到下发的时间差中位数；返工 = 改量/驳回次数 ÷ 单量；版本正确率 = 1 − 应到与实收不一致的单数 ÷ 已收货单数；复核成本 = 12 分钟 × 70 元/人时。样本少于 20 单时指标波动大，仅用于演示变化方向。</div>
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
      return `<tr>
        <td><input type="checkbox" data-sku="${x.sku.id}" ${blocked ? "disabled" : ""}></td>
        <td><b>${esc(x.sku.name)}</b><div class="mono">${x.sku.id} · ${x.sku.category}</div></td>
        <td class="num">${s.onHand}</td>
        <td class="num">${s.inTransit}</td>
        <td class="num">${s.daily.toFixed(1)}</td>
        <td class="num">${x.sku.minDisplay}</td>
        <td class="num"><b>${s.qty}</b></td>
        <td>${confTag(s.confidence)}</td>
        <td>${codes || '<span class="tag ok">通过校验</span>'}</td>
      </tr>`;
    }).join("");

    return `
      <h1 class="page">缺货上报</h1>
      <p class="hint">门店端只需 3 步：选门店 → 勾选缺货品项 → 提交。系统已按快照预先识别缺货，店长不必再逐个数货架。</p>

      <div class="steps">
        <div class="step"><span class="n">1</span><div class="t"><strong>选择门店</strong>当前：${esc(store.name)}（${esc(store.city)} · ${esc(store.format)}）</div></div>
        <div class="step"><span class="n">2</span><div class="t"><strong>勾选缺货品项</strong>共识别 ${list.length} 条，其中 ${list.filter((x) => !x.sug.blocked && x.sug.qty > 0).length} 条可补货</div></div>
        <div class="step"><span class="n">3</span><div class="t"><strong>提交上报</strong>提交后进入「建议审核」，由计划员确认</div></div>
      </div>

      <div class="panel">
        <div class="row between">
          <div class="row">
            <label>门店</label>
            <select id="store-select">
              ${D.stores.map((s) => `<option value="${s.id}" ${s.id === ui.storeId ? "selected" : ""}>${esc(s.name)}（${esc(s.city)}）</option>`).join("")}
            </select>
            <span class="mono">快照 ${D.snapshotId}</span>
          </div>
          <button class="btn" data-act="submit-report">提交上报</button>
        </div>
      </div>

      <div class="panel">
        <h2>系统识别的缺货清单 <span class="sub">库存 ≤ 0 且近 3 日有销售，或低于最小陈列量</span></h2>
        ${list.length ? `<table>
          <thead><tr><th style="width:34px"></th><th>SKU</th><th class="num">可用库存</th><th class="num">在途</th>
          <th class="num">近 7 日均销</th><th class="num">最小陈列</th><th class="num">建议量</th><th>置信度</th><th>校验</th></tr></thead>
          <tbody>${rows}</tbody></table>` : '<div class="empty">该门店当前无缺货，换一家试点门店（前 3 家缺货较多）试试。</div>'}
        <div class="legend">建议量 = 安全库存(d × (提前期+复核周期) × 安全系数) + 陈列覆盖(d × C) − 可用库存 − 在途，按箱规取整且不低于起订量。
        校验码可悬停查看原因：E_ 为阻断（不可补货），W_ 为告警（可补但需人工确认）。</div>
      </div>`;
  }

  /* ---------------- 视图：建议审核 ---------------- */
  function viewReview() {
    const list = S.orders.filter((o) => o.status === "reported").sort((a, b) => b.createdAt - a.createdAt);
    const items = list.map((o) => {
      const sku = skuOf(o.skuId);
      const store = storeOf(o.storeId);
      const checks = (o.checks || []).map((c) => `<span class="tag code">${esc(c)}</span>`).join(" ");
      return `<div class="order">
        <div class="head">
          <b>${esc(store.name)}</b>
          <span class="tag gray">${esc(sku.name)}</span>
          <span class="mono">${o.id}</span>
          ${confTag(o.confidence)}
          <span class="mono">规则 ${esc(o.ruleId)}</span>
          <span style="margin-left:auto;color:#71807b;font-size:12px">${ago(o.createdAt)}上报</span>
        </div>
        <div class="calc">系统建议 <b>${o.suggested}</b> ${esc(sku.category)} · 箱规 ${sku.caseSize} · 起订 ${sku.moq}</div>
        <div class="checks">${checks || '<span class="tag ok">硬约束全部通过</span>'}</div>
        <div class="act">
          <label>改为</label>
          <input type="number" min="0" step="${sku.caseSize}" id="qty-${o.id}" value="${o.suggested}">
          <input type="text" id="reason-${o.id}" placeholder="改量理由（改量必填）">
          <button class="btn small" data-act="approve" data-id="${o.id}">通过并下发</button>
          <button class="btn small danger" data-act="reject" data-id="${o.id}">驳回</button>
        </div>
      </div>`;
    }).join("");

    return `
      <h1 class="page">建议审核（例外管理）</h1>
      <p class="hint">计划员只处理例外：低/中置信、改量、超上限。改量必须写理由，理由与改量幅度一并进入返工分析。</p>
      <div class="panel">
        <h2>待复核 ${list.length} 单 <span class="sub">高置信单据本可批量流转，此处仍保留逐单确认以便演示</span></h2>
        ${items || '<div class="empty">没有待复核单据。去「缺货上报」提交几单试试。</div>'}
      </div>`;
  }

  /* ---------------- 视图：调拨 ---------------- */
  function viewTransfer() {
    const cand = transferCandidates();
    if (!cand.length) {
      return `<h1 class="page">跨店调拨</h1><p class="hint">当 DC 库存不足时，系统按 5 因子评分推荐可调出门店。</p>
        <div class="panel"><div class="empty">当前没有「DC 库存不足」的已下发单据。先在上报→审核走一单鲜奶或饭团，再回来看调拨建议。</div></div>`;
    }
    const blocks = cand.map((o) => {
      const sku = skuOf(o.skuId);
      const store = storeOf(o.storeId);
      const dc = D.dc[o.skuId];
      const done = S.transfers.filter((t) => t.orderId === o.id);
      let plan = "";
      if (ui.planOrderId === o.id && !done.length) {
        const opts = E.rankTransfers(D, o.storeId, o.skuId, o.final);
        plan = `<table style="margin-top:10px">
          <thead><tr><th>候选调出门店</th><th>城市</th><th class="num">可调出</th><th class="num">剩余效期</th><th class="num">距离</th><th class="num">评分</th><th></th></tr></thead>
          <tbody>${opts.map((x) => `<tr>
            <td><b>${esc(x.storeName)}</b><div class="mono">${x.storeId}</div></td>
            <td>${esc(x.city)}</td><td class="num">${x.avail}</td><td class="num">${x.shelfLeftDays} 天</td>
            <td class="num">${x.distanceKm} km</td><td class="num"><b>${x.score.toFixed(3)}</b></td>
            <td><button class="btn small" data-act="do-transfer" data-id="${o.id}" data-store="${x.storeId}">审批并生成调拨单</button></td>
          </tr>`).join("")}</tbody></table>
          <div class="legend">评分 = 0.35×富余度 + 0.25×效期紧迫 + 0.20×距离 + 0.10×同城 + 0.10×装载匹配；调出后本店库存不得低于安全库存。</div>`;
      }
      return `<div class="order">
        <div class="head"><b>${esc(store.name)}</b><span class="tag gray">${esc(sku.name)}</span>
          <span class="mono">${o.id}</span><span class="tag low">DC 可用 ${dc} 件 < 需求 ${o.final} 件</span></div>
        ${done.length ? `<div class="calc">已生成调拨单：${done.map((t) => `${esc(storeOf(t.fromStore).name)} → ${t.qty} 件（${esc(t.status)}）`).join("；")}</div>`
          : `<div class="act" style="margin-top:8px"><button class="btn small ghost" data-act="plan-transfer" data-id="${o.id}">查看调拨建议</button></div>`}
        ${plan}
      </div>`;
    }).join("");

    return `<h1 class="page">跨店调拨</h1>
      <p class="hint">解决「一边报废一边缺货」：调拨必须由叶书（区域物流）审批，评分与审批意见全部留痕。</p>
      <div class="panel"><h2>DC 库存不足的单据 ${cand.length} 单</h2>${blocks}</div>`;
  }

  /* ---------------- 视图：收货 ---------------- */
  function viewReceive() {
    const list = S.orders.filter((o) => o.status === "issued")
      .sort((a, b) => (a.source === "live" ? 0 : 1) - (b.source === "live" ? 0 : 1) || (b.issuedAt || 0) - (a.issuedAt || 0));
    const rows = list.map((o) => {
      const sku = skuOf(o.skuId);
      const store = storeOf(o.storeId);
      return `<tr>
        <td class="mono">${o.id}</td>
        <td>${esc(store.name)}</td>
        <td>${esc(sku.name)}</td>
        <td class="num">${o.final}</td>
        <td class="num"><input type="number" min="0" id="recv-${o.id}" value="${o.final}"></td>
        <td>${o.issuedAt ? hm(o.issuedAt) : "—"}</td>
        <td><button class="btn small" data-act="receive" data-id="${o.id}">确认收货</button></td>
      </tr>`;
    }).join("");

    return `<h1 class="page">到货确认</h1>
      <p class="hint">实收与下发不一致时，系统自动开异常单并计入「版本正确率」，不再靠微信群口头反馈。</p>
      <div class="panel">
        <h2>待收货 ${list.length} 单</h2>
        ${list.length ? `<table><thead><tr><th>单据</th><th>门店</th><th>SKU</th><th class="num">应到</th>
          <th class="num">实收</th><th>下发时间</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty">没有待到货单据。</div>'}
      </div>`;
  }

  /* ---------------- 视图：审计 ---------------- */
  function viewAudit() {
    const rows = S.audits.map((a) => `<tr>
      <td class="mono">${hm(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td>
      <td class="mono">${esc(a.object)}</td><td>${esc(a.before)}</td><td>${esc(a.after)}</td>
      <td class="mono">${esc(a.snapshot)}</td></tr>`).join("");
    return `<h1 class="page">审计日志</h1>
      <p class="hint">每条记录包含操作人、动作、前后值、数据快照版本，满足「每个输出可追溯到来源、规则、模型与确认人」。</p>
      <div class="panel">
        <h2>共 ${S.audits.length} 条</h2>
        <table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>前值</th><th>后值</th><th>快照</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">暂无记录</td></tr>'}</tbody></table>
      </div>`;
  }

  /* ---------------- 视图：规则 ---------------- */
  function viewRules() {
    const p = E.PARAMS;
    const rows = Object.keys(p).map((k) => `<tr><td><b>${k}</b></td><td class="num">${p[k].lead} 天</td>
      <td class="num">${p[k].review} 天</td><td class="num">${p[k].k}</td><td class="num">${p[k].cover} 天</td></tr>`).join("");
    const codes = [
      ["E_SHELF_LIFE", "剩余保质期 < 提前期 + 7 天", "阻断", "禁止补货，改走调拨或折价促销"],
      ["E_SCOPE", "跨店 / 非授权品类", "阻断", "拒绝并记录越权尝试"],
      ["E_DUPLICATE", "同店同 SKU 24 小时内已有待处理单", "阻断", "合并提示，不重复生成"],
      ["E_STALE", "快照超过 36 小时", "阻断", "退回手工模式"],
      ["W_STOCK_CAP", "补后库存 > 30 天周转上限", "告警", "截断至上限并标注"],
      ["W_SPARSE", "近 7 日有效销售 < 3 天", "告警", "转人工，置信度降为 low"]
    ].map((r) => `<tr><td class="mono">${r[0]}</td><td>${r[1]}</td><td>${r[2] === "阻断" ? '<span class="tag low">阻断</span>' : '<span class="tag mid">告警</span>'}</td><td>${r[3]}</td></tr>`).join("");

    return `<h1 class="page">规则与参数</h1>
      <p class="hint">规则参数按品类可覆盖，所有单据都记录命中的规则 ID 与快照版本。</p>
      <div class="panel"><h2>补货参数</h2>
        <table><thead><tr><th>品类</th><th class="num">提前期 L</th><th class="num">复核周期 R</th><th class="num">安全系数 k</th><th class="num">陈列覆盖 C</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="legend">建议量 = d × (L + R) × k + d × C − 可用库存 − 在途；按箱规向上取整，不低于起订量。</div>
      </div>
      <div class="panel"><h2>校验码</h2>
        <table><thead><tr><th>错误码</th><th>触发条件</th><th>级别</th><th>处置</th></tr></thead><tbody>${codes}</tbody></table>
      </div>`;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    document.querySelectorAll(".side button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === ui.view);
    });
    const views = { dash: viewDash, report: viewReport, review: viewReview, transfer: viewTransfer, receive: viewReceive, audit: viewAudit, rules: viewRules };
    $("#main").innerHTML = (views[ui.view] || viewDash)();

    $("#snap").textContent = "数据快照 " + D.snapshotId;
    const pend = S.orders.filter((o) => o.status === "reported").length;
    const recv = S.orders.filter((o) => o.status === "issued").length;
    const tran = transferCandidates().filter((o) => !S.transfers.some((t) => t.orderId === o.id)).length;
    const badge = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = n; };
    badge("#n-review", pend);
    badge("#n-receive", recv);
    badge("#n-transfer", tran);
    const st = $("#store-select");
    if (st) st.addEventListener("change", (e) => { ui.storeId = e.target.value; render(); });
  }

  /* ---------------- 交互 ---------------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act], [data-view]");
    if (!t) return;

    if (t.dataset.view && t.closest(".side")) {
      ui.view = t.dataset.view; ui.planOrderId = null; render(); return;
    }
    if (t.dataset.act === "goto") {
      e.preventDefault();
      ui.view = t.dataset.view; render(); return;
    }

    const act = t.dataset.act;
    if (act === "submit-report") {
      const checked = Array.from(document.querySelectorAll('input[data-sku]:checked')).map((c) => c.dataset.sku);
      if (!checked.length) { toast("先勾选要上报的缺货品项"); return; }
      let n = 0;
      checked.forEach((skuId) => {
        const s = E.suggest(D, ui.storeId, skuId, { stale: S.settings.stale });
        if (s.qty <= 0 || s.blocked) return;
        S.seq += 1;
        S.orders.unshift({
          id: rid("REQ", S.seq), storeId: ui.storeId, skuId: skuId, createdAt: Date.now(),
          suggested: s.qty, final: null, received: null, expected: null,
          confidence: s.confidence, ruleId: s.ruleId, checks: s.checks.map((c) => c.code),
          revisions: 0, status: "reported", reason: "", issuedAt: null, approvedBy: null,
          source: "live", snapshotId: D.snapshotId
        });
        logAudit("门店上报缺货", rid("REQ", S.seq), "-", `建议 ${s.qty}（${s.ruleId}）`, ACTOR.store);
        n++;
      });
      save();
      ui.view = "review";
      render();
      toast(n ? `已提交 ${n} 单，进入建议审核` : "勾选的品项均被硬约束拦截，未生成单据");
      return;
    }

    if (act === "approve" || act === "reject") {
      const id = t.dataset.id;
      const o = S.orders.find((x) => x.id === id);
      if (!o) return;
      const qtyEl = document.getElementById("qty-" + id);
      const reasonEl = document.getElementById("reason-" + id);
      if (act === "reject") {
        o.status = "rejected";
        o.reason = (reasonEl && reasonEl.value) || "计划员驳回";
        logAudit("驳回补货建议", id, o.suggested, o.reason, ACTOR.planner);
        save(); render(); toast("已驳回并记录理由");
        return;
      }
      const q = Number(qtyEl.value);
      if (!(q > 0)) { toast("数量必须大于 0"); return; }
      if (q !== o.suggested && !(reasonEl.value || "").trim()) {
        toast("改量必须填写理由（用于返工分析）");
        reasonEl.focus();
        return;
      }
      o.final = q;
      o.expected = q;
      o.reason = (reasonEl.value || "").trim();
      if (q !== o.suggested) o.revisions += 1;
      o.status = "issued";
      o.issuedAt = Date.now();
      o.approvedBy = ACTOR.planner;
      logAudit("审核通过并下发", id, `建议 ${o.suggested}`, `下发 ${q}`, ACTOR.planner);
      save(); render();
      toast(q === o.suggested ? "已按建议下发" : `已改量为 ${q} 并下发`);
      return;
    }

    if (act === "plan-transfer") {
      ui.planOrderId = t.dataset.id;
      render();
      return;
    }

    if (act === "do-transfer") {
      const id = t.dataset.id;
      const o = S.orders.find((x) => x.id === id);
      if (!o) return;
      const opts = E.rankTransfers(D, o.storeId, o.skuId, o.final);
      const pick = opts.find((x) => x.storeId === t.dataset.store);
      if (!pick) return;
      if (pick.city !== storeOf(o.storeId).city && storeOf(o.storeId).city !== "上海") {
        toast("跨城调拨需区域物流二次确认，演示中已阻断");
        return;
      }
      S.transfers.push({
        id: "TR" + String(S.transfers.length + 1).padStart(4, "0"),
        orderId: id, fromStore: pick.storeId, toStore: o.storeId, skuId: o.skuId,
        qty: Math.min(pick.avail, o.final), score: pick.score, status: "已审批",
        at: Date.now(), approvedBy: ACTOR.logistics
      });
      logAudit("审批跨店调拨", id, `DC 不足`, `${storeOf(pick.storeId).name} → ${storeOf(o.storeId).name}，${Math.min(pick.avail, o.final)} 件，评分 ${pick.score.toFixed(3)}`, ACTOR.logistics);
      ui.planOrderId = null;
      save(); render(); toast("调拨单已生成并留痕");
      return;
    }

    if (act === "receive") {
      const id = t.dataset.id;
      const o = S.orders.find((x) => x.id === id);
      const el = document.getElementById("recv-" + id);
      const got = Number(el.value);
      if (!(got >= 0)) { toast("请填写实收数量"); return; }
      o.received = got;
      o.status = "received";
      const diff = got !== o.final;
      logAudit("到货确认", id, `应到 ${o.final}`, `实收 ${got}${diff ? "（差异，已开异常单）" : ""}`, ACTOR.store);
      if (diff) logAudit("异常单：数量差异", id, o.final, got, ACTOR.system);
      save(); render();
      toast(diff ? "已收货，并自动生成数量差异异常单" : "已收货，账实一致");
      return;
    }
  });

  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("重置为初始演示数据？当前会话产生的单据会清空。")) return;
    localStorage.removeItem(KEY);
    S = load();
    ui.view = "dash"; ui.planOrderId = null;
    render();
    toast("已重置演示数据");
  });

  $("#btn-help").addEventListener("click", () => {
    alert(
      "演示脚本（约 5 分钟）\n\n" +
      "1. 指标看板：先看 5 项指标与现状基线的差距（当前值含 26 单历史样本）。\n" +
      "2. 缺货上报：门店选「上海·社区01店」，勾选前 4 项 → 提交上报。注意三明治被 E_SHELF_LIFE 拦截（效期不足，禁止补货）。\n" +
      "3. 建议审核：把牛奶改为 36 并填理由 → 通过下发；其余按建议通过。\n" +
      "4. 跨店调拨：鲜奶/饭团会显示 DC 不足，查看评分 Top3 → 审批生成调拨单。\n" +
      "5. 到货确认：把某一单实收改成少于应到 → 自动开差异异常单。\n" +
      "6. 回看指标看板：处理时长、返工、版本正确率随操作实时变化；审计日志可逐条追溯。"
    );
  });

  S = load();
  render();
})();
