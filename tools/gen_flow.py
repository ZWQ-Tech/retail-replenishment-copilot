# -*- coding: utf-8 -*-
import os, html

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
FONT = "Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif"

LANES = [
    ("门店 / 店长", "#E8F3EE"),
    ("补货中心 / 计划员", "#EAF0F8"),
    ("仓配 / 区域物流", "#FBF1E6"),
    ("系统与数据", "#F2EFF8"),
]
LANE_H = 176
TOP = 104
LABEL_W = 128
X0 = 152
COL_W = 208
NODE_W = 156
NODE_H = 86

KIND = {
    "step":   dict(fill="#FFFFFF", stroke="#4A6B63", text="#1F2D2A"),
    "human":  dict(fill="#FFF6E8", stroke="#C98A2E", text="#5A3E12"),
    "system": dict(fill="#EDF3FB", stroke="#41648C", text="#1B2C40"),
    "warn":   dict(fill="#FDECEC", stroke="#B84A4A", text="#5C1E1E"),
    "ok":     dict(fill="#E6F4EA", stroke="#2F7A52", text="#173C2A"),
}
LANE_Y = lambda i: TOP + i * LANE_H


def esc(t):
    return html.escape(t, quote=False)


class Node:
    def __init__(self, col, lane, text, kind="step", tag=None, dash=False, w=NODE_W, h=NODE_H):
        self.x = X0 + col * COL_W
        self.y = LANE_Y(lane) + (LANE_H - h) / 2
        self.w, self.h, self.col, self.lane = w, h, col, lane
        self.text = text.split("\n")
        self.kind, self.tag, self.dash = kind, tag, dash

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2

    @property
    def r(self):
        return self.x + self.w

    @property
    def b(self):
        return self.y + self.h


def node_svg(n):
    st = KIND[n.kind]
    out = [f'<rect x="{n.x}" y="{n.y}" width="{n.w}" height="{n.h}" rx="10" fill="{st["fill"]}" '
           f'stroke="{st["stroke"]}" stroke-width="1.6"' + (' stroke-dasharray="6 4"' if n.dash else "") + "/>"]
    lines = n.text
    lh = 19
    start = n.cy - (len(lines) - 1) * lh / 2 + 5
    for i, ln in enumerate(lines):
        size = 14.5 if i == 0 else 12.3
        weight = "700" if i == 0 else "400"
        fill = st["text"] if i == 0 else "#57635F"
        out.append(f'<text x="{n.cx}" y="{start + i * lh}" text-anchor="middle" font-family="{FONT}" '
                   f'font-size="{size}" font-weight="{weight}" fill="{fill}">{esc(ln)}</text>')
    if n.tag:
        tw = len(n.tag) * 11.5 + 14
        out.append(f'<rect x="{n.x + 8}" y="{n.y - 10}" width="{tw}" height="18" rx="9" fill="{st["stroke"]}"/>')
        out.append(f'<text x="{n.x + 8 + tw / 2}" y="{n.y + 3}" text-anchor="middle" font-family="{FONT}" '
                   f'font-size="10.5" fill="#FFFFFF">{esc(n.tag)}</text>')
    return "".join(out)


def path_svg(pts, dash=False, color="#6B7C77"):
    d = " ".join(("M" if i == 0 else "L") + f" {p[0]:.1f} {p[1]:.1f}" for i, p in enumerate(pts))
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.7"'
            + (' stroke-dasharray="7 5"' if dash else "") + ' marker-end="url(#arrow)"/>')


def label_svg(text, x, y, rotate=False, anchor="middle"):
    w = len(text) * 11.6 + 12
    if rotate:
        return (f'<g transform="translate({x},{y}) rotate(-90)">'
                f'<rect x="{-w / 2}" y="-13" width="{w}" height="18" rx="4" fill="#FFFFFF" opacity="0.95"/>'
                f'<text x="0" y="0" text-anchor="middle" font-family="{FONT}" font-size="11.2" fill="#4B5B57">'
                f'{esc(text)}</text></g>')
    return (f'<rect x="{x - w / 2}" y="{y - 13}" width="{w}" height="18" rx="4" fill="#FFFFFF" opacity="0.95"/>'
            f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{FONT}" font-size="11.2" '
            f'fill="#4B5B57">{esc(text)}</text>')


class Edge:
    def __init__(self, pts, label=None, dash=False, color="#6B7C77", label_at=None, rotate=False):
        self.pts, self.label, self.dash, self.color = pts, label, dash, color
        self.label_at, self.rotate = label_at, rotate

    def svg(self):
        s = [path_svg(self.pts, self.dash, self.color)]
        if self.label and self.label_at:
            s.append(label_svg(self.label, self.label_at[0], self.label_at[1], self.rotate))
        return "".join(s)


def h(a, b, label=None, dash=False, color="#6B7C77"):
    """同一泳道内左到右"""
    pts = [(a.r + 2, a.cy), (b.x - 2, b.cy)]
    lab = ((a.r + b.x) / 2, a.cy - 9) if label else None
    return Edge(pts, label, dash, color, lab)


def hop(a, b, label=None, dash=False, color="#6B7C77", gap_col=None, dx=0):
    """跨泳道、左到右：在列间隙竖直走线"""
    gc = gap_col if gap_col is not None else b.col
    vx = X0 + gc * COL_W - COL_W / 2 + 6 + dx
    r = a.r + 2
    if vx < r:
        vx = r + 8
    y0, y1 = a.cy, b.cy
    pts = [(r, y0), (vx, y0), (vx, y1), (b.x - 2, y1)]
    lab = (vx - 12, (y0 + y1) / 2) if label else None
    return Edge(pts, label, dash, color, lab, rotate=True)


def v(a, b, label=None, dash=False, color="#6B7C77", dx=0):
    """同列上下"""
    pts = [(a.cx + dx, a.b + 2), (b.cx + dx, b.y - 2)]
    lab = (a.cx + dx, (a.b + b.y) / 2) if label else None
    return Edge(pts, label, dash, color, lab)


def build(title, sub, nodes, edges, legend, notes, width, height, outfile, foot=0):
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
           '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
           'orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#6B7C77"/></marker></defs>',
           f'<rect width="{width}" height="{height}" fill="#FFFFFF"/>',
           f'<text x="36" y="46" font-family="{FONT}" font-size="24" font-weight="700" fill="#1C2B27">{esc(title)}</text>',
           f'<text x="36" y="72" font-family="{FONT}" font-size="12.6" fill="#6B7C77">{esc(sub)}</text>',
           f'<line x1="36" y1="86" x2="{width - 36}" y2="86" stroke="#D5DEDA"/>']
    for i, (name, color) in enumerate(LANES):
        y = LANE_Y(i)
        svg.append(f'<rect x="24" y="{y}" width="{width - 48}" height="{LANE_H}" fill="{color}" opacity="0.5"/>')
        svg.append(f'<line x1="24" y1="{y}" x2="{width - 24}" y2="{y}" stroke="#D5DEDA"/>')
        svg.append(f'<text x="{24 + LABEL_W / 2}" y="{y + LANE_H / 2 + 5}" text-anchor="middle" '
                   f'font-family="{FONT}" font-size="13.5" font-weight="700" fill="#3C4E49">{esc(name)}</text>')
        svg.append(f'<line x1="{24 + LABEL_W}" y1="{y + 6}" x2="{24 + LABEL_W}" y2="{y + LANE_H - 6}" '
                   f'stroke="#C9D5D0" stroke-width="1"/>')
    svg.append(f'<line x1="24" y1="{LANE_Y(len(LANES))}" x2="{width - 24}" y2="{LANE_Y(len(LANES))}" stroke="#D5DEDA"/>')
    for e in edges:
        svg.append(e.svg())
    for n in nodes:
        svg.append(node_svg(n))
    ly = LANE_Y(len(LANES)) + 36
    svg.append(f'<text x="36" y="{ly}" font-family="{FONT}" font-size="12.4" font-weight="700" fill="#3C4E49">图例</text>')
    lx = 84
    for lb, kind in legend:
        st = KIND[kind]
        svg.append(f'<rect x="{lx}" y="{ly - 12}" width="22" height="15" rx="3" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="1.4"/>')
        svg.append(f'<text x="{lx + 28}" y="{ly}" font-family="{FONT}" font-size="11.4" fill="#4B5B57">{esc(lb)}</text>')
        lx += 34 + len(lb) * 12.2
    for i, note in enumerate(notes):
        svg.append(f'<text x="36" y="{ly + 26 + i * 19}" font-family="{FONT}" font-size="11.4" fill="#6B7C77">'
                   f'◆ {esc(note)}</text>')
    svg.append("</svg>")
    p = os.path.join(OUT, outfile)
    open(p, "w", encoding="utf-8").write("".join(svg))
    print("wrote", p, width, height)


W1 = X0 + 8 * COL_W + NODE_W + 56
W2 = W1
H = LANE_Y(len(LANES)) + 150

# ================= 图 1 现状 =================
N = {}
N["visit"] = Node(0, 0, "巡店发现缺货\n纸质登记 / 拍照", "human", tag="人工")
N["pos"] = Node(0, 3, "POS 日结 T+1\nWMS 库存手工导出", "system", tag="数据滞后")
N["wechat"] = Node(1, 0, "微信群 / 电话告知\n38% 消息无明确数量", "human", tag="人工转述")
N["excel"] = Node(2, 1, "导出 Excel\n手工汇总销量与库存", "human", tag="转录 1")
N["check"] = Node(3, 2, "核对在途 / DC 库存\n与门店表差 37 处", "warn", tag="口径不一致 1")
N["calc"] = Node(4, 1, "手工算建议量\n仅 300/1842 SKU 有公式", "human", tag="经验计算")
N["fix"] = Node(5, 1, "按经验修正\n新品 / 促销无历史", "human", tag="经验判断")
N["order"] = Node(6, 1, "生成补货单 Excel\nv3 → v5 → v7", "warn", tag="版本混乱")
N["merge"] = Node(6, 2, "按线路人工合并\n再手工拆单", "human", tag="转录 2")
N["dc"] = Node(7, 2, "DC 库存不足\n电话协调跨店调拨", "human", tag="无评分规则")
N["recv"] = Node(7, 0, "收货后手工改\n门店库存表", "human", tag="转录 3")
N["diff"] = Node(8, 0, "数量 / 效期差异\n微信群反馈、事后补单", "warn", tag="无审批痕迹")
N["meet"] = Node(8, 1, "周会复盘\n缺货率三个口径", "warn", tag="口径不一致 2")

e1 = [
    h(N["visit"], N["wechat"]),
    hop(N["pos"], N["excel"], "手工导出", dash=True, gap_col=1),
    hop(N["wechat"], N["excel"], "电话/微信", color="#B84A4A", gap_col=2),
    hop(N["excel"], N["check"], gap_col=3),
    hop(N["check"], N["calc"], "回填", color="#B84A4A", gap_col=4),
    h(N["calc"], N["fix"]),
    h(N["fix"], N["order"]),
    v(N["order"], N["merge"], "邮件"),
    h(N["merge"], N["dc"], "缺货"),
    hop(N["dc"], N["recv"], "到货", color="#B84A4A", gap_col=7),
    h(N["recv"], N["diff"], "差异"),
    hop(N["recv"], N["meet"], "周会", gap_col=8),
]
build("现状流程图 · 门店补货与库存协同（人工模式）",
      "触发：巡店发现缺货 ｜ 8 个环节 ｜ 处理时长中位数 4.2h ｜ 返工 1.7 次/单 ｜ 版本正确率 82% ｜ 缺货率 12.4%",
      list(N.values()), e1,
      [("人工执行", "human"), ("系统 / 数据", "system"), ("异常与口径问题", "warn")],
      ["全链路 3 处人工转录、2 处口径不一致、1 处无审批痕迹；处理时长中位数 4.2 小时，返工 1.7 次/单。",
       "瓶颈不在「算得准不准」，而在 t1→t2 的信号转述与 t5→t6 的版本传递：数量与门店在传递中丢失。",
       "收货后手工改表使 WMS 与门店账长期不一致，反过来污染下一次建议量，形成闭环误差。"],
      W1, H, "03-流程图-现状.svg")

# ================= 图 2 转型后 =================
M = {}
M["ingest"] = Node(0, 3, "数据自动汇聚\nPOS / 库存 / 在途 / 效期\n06:30 生成快照", "system", tag="自动化")
M["detect"] = Node(1, 3, "缺货识别\n库存 ≤ 0 且 POS 零销售\n或低于最小陈列量", "system", tag="规则识别")
M["report"] = Node(1, 0, "店长扫码补充上报\n选店 → 勾 SKU → 提交", "human", tag="3 步完成")
M["base"] = Node(2, 3, "需求基线\n近 7 日日均 / 波动 CV\n→ 置信度三档", "system", tag="计算")
M["engine"] = Node(3, 3, "建议量引擎\n安全库存 + 陈列覆盖\n+ 起订量取整", "ok", tag="规则引擎")
M["guard"] = Node(4, 3, "硬约束校验\n效期 / 上限 / 权限\n/ 重复 / 新鲜度", "warn", tag="确定性校验")
M["escalate"] = Node(4, 0, "异常升级\n缺数据 / 低置信 / 越权\n→ 具名接收人", "warn", tag="兜底")
M["review"] = Node(5, 1, "例外复核\n仅 medium / low 置信\n改量必填理由", "human", tag="人工 N2")
M["auto"] = Node(5, 3, "高置信批量流转\n计划员抽检", "step", tag="自动", dash=True)
M["issue"] = Node(6, 1, "一键下发补货单\n带快照 ID + 规则 ID", "ok", tag="可追溯")
M["transfer"] = Node(6, 2, "DC 不足 → 调拨评分\n效期 / 富余 / 距离 / 装载", "human", tag="人工 N3")
M["receive"] = Node(7, 0, "扫码收货\n差异自动开异常单", "human", tag="人工 N4")
M["kpi"] = Node(7, 1, "指标看板\n时长 / 返工 / 正确率\n/ 采用率 / 复核成本", "ok", tag="实时")

e2 = [
    h(M["ingest"], M["detect"], "快照"),
    v(M["report"], M["detect"], "补充信号"),
    h(M["detect"], M["base"], "缺货清单"),
    h(M["base"], M["engine"], "基线"),
    h(M["engine"], M["guard"], "建议量"),
    v(M["guard"], M["escalate"], "E_* 错误码", color="#B84A4A"),
    hop(M["guard"], M["review"], "例外", gap_col=5),
    h(M["guard"], M["auto"], "高置信", dash=True),
    hop(M["auto"], M["issue"], "批量", dash=True, gap_col=6),
    hop(M["review"], M["issue"], "确认", gap_col=6, dx=-9),
    v(M["issue"], M["transfer"], "DC 不足"),
    hop(M["transfer"], M["receive"], "到货", gap_col=7),
    hop(M["issue"], M["receive"], "下发", gap_col=7, dx=9),
    v(M["receive"], M["kpi"], "实收"),
]
build("数智化转型后流程图 · 门店补货与库存协同（规则 + 例外管理）",
      "自动汇聚 → 缺货识别 → 建议量 → 硬校验 → 例外复核 → 下发 / 调拨 → 收货 → 看板 ｜ 目标处理时长 ≤ 40min",
      list(M.values()), e2,
      [("规则 / 引擎输出", "ok"), ("人工确认节点", "human"), ("硬约束 / 异常兜底", "warn"), ("自动流转", "system")],
      ["关键变化：把「人找信息」改为「信息找人」；不可逆动作（下发、调拨）前各保留 1 个人工确认节点。",
       "计划员从「全量算量」转为「例外裁决 + 规则维护」，预计仅约 12% 单据需人工确认。",
       "E_* 错误码（效期、越权、快照过期、重复请求）系统直接拒绝，人工无权重写，只能修正数据后重跑。"],
      W2, H, "03-流程图-数智化转型后.svg")

print("done")
