# -*- coding: utf-8 -*-
"""生成两张纵向流程图（SVG）：现状 vs 数智化转型后。

版式参照课堂参考图：
  - 顶部深蓝标题横幅（主标题 + 副标题 + 右上角状态标签）
  - 中部左侧 = 纵向主流程（节点自上而下 + 分支判断）
  - 中部右侧 = 三栏卡片（AI 数智化能力 / 人工责任边界 / 量化渗透口径）
  - 底部深蓝横幅 = 业务变化结论
现状图与转型图共用同一套骨架，节点内容不同。
"""
import os, math, html

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
FONT = "Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif"

# ---------------------------------------------------------------- 画布
W = 1600
BANNER_H = 96
FOOTER_H = 64
PAD = 28
GAP = 16

NAVY = "#16325C"      # 标题横幅深蓝
NAVY2 = "#1F4788"     # 三栏标题条深蓝
BLUE = "#2F6FBF"      # 主流程节点描边蓝
BLUE_BG = "#EAF1FB"   # 节点浅蓝底
ORANGE = "#D98A1F"    # 人工/待办橙
ORANGE_BG = "#FDF1E1"
GREEN = "#3C8A5A"     # 低风险/可以 绿
GREEN_BG = "#E8F5EC"
RED = "#C0504D"       # 高风险红
RED_BG = "#FBEBEA"
GRAY = "#6B7280"
INK = "#1F2937"
SUB = "#5B6472"


def esc(t):
    return html.escape(t, quote=False)


def _text(x, y, s, size=14, fill=INK, weight="400", anchor="middle", font=FONT):
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{font}" '
            f'font-size="{size}" font-weight="{weight}" fill="{fill}">{esc(s)}</text>')


def _wrap(s, n=14):
    """按字符宽度折行（中文按 1，英文/数字按 0.55）。"""
    lines, cur, w = [], "", 0.0
    for ch in s:
        w += 1.0 if ord(ch) > 0x2E80 else 0.55
        cur += ch
        if w >= n:
            lines.append(cur)
            cur, w = "", 0.0
    if cur:
        lines.append(cur)
    return lines


def _node(x, y, w, h, title, sub=None, kind="step", tag=None, rx=12):
    pal = {
        "step":   (BLUE_BG, BLUE, INK),
        "ai":     ("#EEF4FC", BLUE, INK),
        "human":  (ORANGE_BG, ORANGE, "#5A3E12"),
        "warn":   (RED_BG, RED, "#5C1E1E"),
        "ok":     (GREEN_BG, GREEN, "#173C2A"),
        "system": ("#F2EFFB", "#5B4B8A", "#2A2450"),
    }
    fill, stroke, tcol = pal[kind]
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
           f'stroke="{stroke}" stroke-width="1.8"/>']
    out.append(f'<rect x="{x}" y="{y}" width="6" height="{h}" rx="3" fill="{stroke}"/>')
    cx = x + w / 2
    lines = _wrap(title, n=15)
    n_lines = len(lines) + (1 if sub else 0)
    lh = 20
    start = y + h / 2 - (n_lines - 1) * lh / 2 + 6
    for i, ln in enumerate(lines):
        out.append(_text(cx, start + i * lh, ln, size=15.5, fill=tcol, weight="700"))
    if sub:
        out.append(_text(cx, start + len(lines) * lh, sub, size=12, fill=SUB, weight="400"))
    if tag:
        tw = len(tag) * 11.5 + 16
        out.append(f'<rect x="{x + 12}" y="{y - 9}" width="{tw}" height="19" rx="9.5" fill="{stroke}"/>')
        out.append(_text(x + 12 + tw / 2, y + 4.5, tag, size=10.5, fill="#FFFFFF", weight="700"))
    return "".join(out), cx, y + h / 2


def _diamond(cx, cy, r, lines, kind="warn"):
    pal = {"warn": (ORANGE_BG, ORANGE, "#5A3E12"), "ok": (GREEN_BG, GREEN, "#173C2A")}
    fill, stroke, tcol = pal[kind]
    pts = f"{cx},{cy-r} {cx+r},{cy} {cx},{cy+r} {cx-r},{cy}"
    out = [f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="1.8"/>']
    lh = 17
    start = cy - (len(lines) - 1) * lh / 2 + 5
    for i, ln in enumerate(lines):
        out.append(_text(cx, start + i * lh, ln, size=12, fill=tcol, weight="700"))
    return "".join(out)


def _arrow(x1, y1, x2, y2, color="#7C8CA0", dashed=False, label=None, lcolor=None):
    dash = ' stroke-dasharray="7 5"' if dashed else ""
    out = [f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.8"{dash}/>']
    ang = math.atan2(y2 - y1, x2 - x1)
    ar = 7
    a1 = ang + math.radians(150)
    a2 = ang - math.radians(150)
    out.append(f'<polygon points="{x2},{y2} {x2+ar*math.cos(a1)},{y2+ar*math.sin(a1)} {x2+ar*math.cos(a2)},{y2+ar*math.sin(a2)}" fill="{color}"/>')
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        out.append(_text(mx + 12, my - 6, label, size=11, fill=lcolor or color, weight="700"))
    return "".join(out)


def _card(x, y, w, h, title, items, title_color=NAVY2):
    """右侧三栏卡片。items 为 (小标题, 说明) 列表。"""
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#FFFFFF" stroke="#D5DCE6" stroke-width="1.4"/>']
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{34}" rx="10" fill="{title_color}"/>')
    out.append(f'<rect x="{x}" y="{y+24}" width="{w}" height="{10}" fill="{title_color}"/>')
    out.append(_text(x + w / 2, y + 23, title, size=15, fill="#FFFFFF", weight="700"))
    yy = y + 50
    for it_title, it_desc in items:
        out.append(_text(x + 18, yy + 13, it_title, size=13, fill=INK, weight="700", anchor="start"))
        if it_desc:
            for j, ln in enumerate(_wrap(it_desc, n=16)):
                out.append(_text(x + 18, yy + 30 + j * 16, ln, size=11, fill=SUB, anchor="start"))
        yy += 30 + (len(_wrap(it_desc, n=16)) if it_desc else 0) * 16 + 12
    return "".join(out)


def _legend(x, y, items):
    out = []
    cx = x
    for color, txt in items:
        out.append(f'<rect x="{cx}" y="{y}" width="14" height="14" rx="3" fill="{color}"/>')
        out.append(_text(cx + 20, y + 11, txt, size=12, fill=SUB, anchor="start"))
        cx += 20 + len(txt) * 13 + 28
    return "".join(out)


def _header(title, subtitle, tag, tag_color):
    out = [f'<rect x="0" y="0" width="{W}" height="{BANNER_H}" fill="{NAVY}"/>']
    out.append(_text(48, 44, title, size=26, fill="#FFFFFF", weight="700", anchor="start"))
    out.append(_text(48, 74, subtitle, size=14, fill="#C7D3E8", anchor="start"))
    tw = len(tag) * 14 + 24
    out.append(f'<rect x="{W - tw - 36}" y="30" width="{tw}" height="30" rx="15" fill="{tag_color}"/>')
    out.append(_text(W - 36 - tw / 2, 50, tag, size=14, fill="#FFFFFF", weight="700"))
    return "".join(out)


def _footer(text):
    out = [f'<rect x="0" y="{H - FOOTER_H}" width="{W}" height="{FOOTER_H}" fill="{NAVY}"/>']
    out.append(_text(W / 2, H - FOOTER_H / 2 + 6, text, size=16, fill="#FFFFFF", weight="700"))
    return "".join(out)


# ---------------------------------------------------------------- 现状图
def draw_as_is():
    global H
    LX = 64
    LW = 680
    NODE_W = 560
    NODE_H = 74
    gap = 13
    steps = [
        ("step", "① 门店发现缺货", "巡店登记 / 拍照，口头或微信群告知（38% 无数量）"),
        ("warn", "② 多渠道信息汇集（无统一入口）", "门店微信、电话、Excel 散落各处，无结构化台账"),
        ("step", "③ 计划员手工算量", "导出 Excel 汇总销量与库存，仅 300/1842 SKU 有公式"),
        ("human", "④ 凭经验修正", "新品 / 促销无历史，靠老员工经验拍板"),
        ("step", "⑤ 生成补货单（多版本）", "补货单 Excel 反复改，v3 → v5 → v7 无留痕"),
        ("step", "⑥ 仓配核对与调拨", "在途 / DC 库存与门店表差 37 处，缺货靠电话协调"),
        ("human", "⑦ 收货手工改表", "到货后手工更新门店库存表，账实长期不符"),
        ("warn", "⑧ 事后追责", "数量 / 效期差异微信群反馈，事后补单"),
    ]
    cx = LX + LW / 2
    nx = cx - NODE_W / 2
    flow_svg = []
    y = BANNER_H + 28
    for i, (kind, t, s) in enumerate(steps):
        svg, _, _ = _node(nx, y, NODE_W, NODE_H, t, s, kind=kind)
        flow_svg.append(svg)
        y_next = y + NODE_H + gap
        if i < len(steps) - 1:
            flow_svg.append(_arrow(cx, y + NODE_H, cx, y_next, color="#8A97A8"))
        y = y_next

    RX = LX + LW + 30
    CW = (W - RX - PAD - GAP * 2) / 3
    cy0 = BANNER_H + 28
    card_h = 320
    cards = []
    cards.append(_card(RX, cy0, CW, card_h, "现状痛点", [
        ("人工转录多", "巡店→微信→Excel→邮件，每次转录丢信息"),
        ("口径不一致", "在途 / DC / 门店三张表对不上"),
        ("决策靠经验", "长尾 SKU 无规则，新人上手难"),
        ("无审批痕迹", "差异走微信群，事后补单"),
    ]))
    cards.append(_card(RX + CW + GAP, cy0, CW, card_h, "人工责任边界", [
        ("全量人工", "每张单都靠计划员逐个核对"),
        ("经验优先", "补货量凭老员工直觉"),
        ("电话调拨", "缺货靠人情与电话协调"),
        ("纸质留痕", "单据版本无系统记录"),
    ], title_color=ORANGE))
    cards.append(_card(RX + (CW + GAP) * 2, cy0, CW, card_h, "量化口径（现状）", [
        ("处理时长", "中位 4.2 小时 / 单"),
        ("返工次数", "平均 1.7 次 / 单"),
        ("版本正确率", "82%（差异 231 行）"),
        ("缺货率", "12.4%（口径不一）"),
    ]))

    H = y + FOOTER_H + 40
    legend = _legend(nx, H - FOOTER_H - 34, [
        (RED_BG, "人工/高风险"), (ORANGE_BG, "人工负责"), (BLUE_BG, "普通步骤"),
    ])
    header = _header("门店补货与库存协同 · 现状业务流程图",
                     "人工模式 · 信息散落、口径不一、决策靠经验、全程难追溯", "现状", "#8A97A8")
    footer = _footer("现状业务变化：三段全靠手工（微信群上报、Excel 算量、电话调拨），缺货与积压并存")
    return header + "".join(flow_svg) + "".join(cards) + legend + footer


# ---------------------------------------------------------------- 转型图
def draw_to_be():
    global H
    LX = 64
    LW = 680
    NODE_W = 560
    NODE_H = 72
    gap = 12
    cx = LX + LW / 2
    nx = cx - NODE_W / 2
    steps = [
        ("ai", "① AI 自动汇聚数据", "06:30 生成 POS / 库存 / 在途 / 效期快照"),
        ("ai", "② AI 识别缺货", "库存 ≤ 0 且 POS 零销售，或低于最小陈列量"),
        ("ai", "③ AI 生成需求基线", "近 7 日日均 + 波动 CV，输出置信度三档"),
        ("ai", "④ AI 计算建议量", "安全库存 + 陈列覆盖 + 起订量取整"),
        ("ai", "⑤ AI 硬约束校验", "效期 / 上限 / 权限 / 重复 / 新鲜度"),
    ]
    flow_svg = []
    y = BANNER_H + 24
    last_cy = None
    for i, (kind, t, s) in enumerate(steps):
        svg, _, cy = _node(nx, y, NODE_W, NODE_H, t, s, kind=kind)
        flow_svg.append(svg)
        y_next = y + NODE_H + gap
        if i < len(steps) - 1:
            flow_svg.append(_arrow(cx, y + NODE_H, cx, y_next, color="#5B8AC0"))
        last_cy = cy
        y = y_next

    # 判断菱形
    jcy = y + 40
    flow_svg.append(_diamond(cx, jcy, 44, ["高置信", "且无异常？"], kind="ok"))
    flow_svg.append(_arrow(cx, y - gap + NODE_H, cx, jcy - 44, color="#5B8AC0"))

    # 左分支（高置信批量流转）/ 右分支（例外复核）
    branch_y = jcy + 110
    sub_w = NODE_W / 2
    left_cx = cx - 200
    right_cx = cx + 200
    lsvg, _, _ = _node(left_cx - sub_w / 2, branch_y, sub_w, NODE_H, "⑥ 批量流转", "高置信单直接流转", kind="ok")
    rsvg, _, _ = _node(right_cx - sub_w / 2, branch_y, sub_w, NODE_H, "⑥ 例外复核", "medium/low 置信，改量必填理由", kind="human")
    flow_svg.append(lsvg)
    flow_svg.append(rsvg)
    flow_svg.append(_arrow(cx - 28, jcy + 28, left_cx - 30, branch_y, color=GREEN, label="是", lcolor=GREEN))
    flow_svg.append(_arrow(cx + 28, jcy + 28, right_cx + 30, branch_y, color=ORANGE, label="否", lcolor=ORANGE))

    # 汇合 → 下发
    y_down = branch_y + NODE_H + gap
    dsvg, _, _ = _node(nx, y_down, NODE_W, NODE_H, "⑦ 一键下发补货单", "带快照 ID + 规则 ID，全程留痕", kind="system")
    flow_svg.append(dsvg)
    flow_svg.append(_arrow(left_cx - 30, branch_y + NODE_H, cx - 30, y_down, color="#8A97A8"))
    flow_svg.append(_arrow(right_cx + 30, branch_y + NODE_H, cx + 30, y_down, color="#8A97A8"))

    # 调拨评分 / 扫码收货
    y2 = y_down + NODE_H + gap
    tsvg, _, _ = _node(nx, y2, NODE_W, NODE_H, "⑧ 调拨评分 / 扫码收货", "DC 不足→5 因子评分调拨；扫码收货差异自动开单", kind="ai")
    flow_svg.append(tsvg)
    flow_svg.append(_arrow(cx, y_down + NODE_H, cx, y2, color="#5B8AC0"))

    # 指标看板
    y3 = y2 + NODE_H + gap
    ksvg, _, _ = _node(nx, y3, NODE_W, NODE_H, "⑨ 指标看板", "时长 / 返工 / 正确率 / 采用率 / 复核成本，口径唯一", kind="system")
    flow_svg.append(ksvg)
    flow_svg.append(_arrow(cx, y2 + NODE_H, cx, y3, color="#8A97A8"))

    RX = LX + LW + 30
    CW = (W - RX - PAD - GAP * 2) / 3
    cy0 = BANNER_H + 24
    card_h = 340
    cards = []
    cards.append(_card(RX, cy0, CW, card_h, "AI 数智化能力", [
        ("智能分类", "缺货主题、优先级、关联 SKU"),
        ("版本校验", "效期、门店、在途口径"),
        ("缺项清单", "材料、未覆盖项、澄清问题"),
        ("可解释理由", "候选队列、依据、置信度"),
        ("质量与审计", "引用、人工确认、全程留痕"),
    ]))
    cards.append(_card(RX + CW + GAP, cy0, CW, card_h, "人工责任边界", [
        ("正式结论", "由具名人员确认下发"),
        ("梯队承接", "按技能与层级派发例外"),
        ("敏感与冲突", "有异议或需审批"),
        ("写回与外发", "人工确认后执行"),
    ], title_color=ORANGE))
    cards.append(_card(RX + (CW + GAP) * 2, cy0, CW, card_h, "量化渗透口径", [
        ("分流准确率", "高置信自动流转占比"),
        ("返工率", "改量 / 驳回 ÷ 单量"),
        ("版本正确率", "1 − 差异单数 ÷ 已收货"),
        ("采用率", "门店 3 步上报完成率"),
        ("处理时长", "上报→下发中位数"),
    ]))

    H = y3 + NODE_H + FOOTER_H + 50
    legend = _legend(nx, H - FOOTER_H - 34, [
        (BLUE_BG, "AI 辅助"), (ORANGE_BG, "人工负责"), (GREEN_BG, "自动流转"), ("#F2EFFB", "系统/看板"),
    ])
    header = _header("门店补货与库存协同 · 数智化转型后业务流程图",
                     "AI 辅助、人工负责、全程可追溯 · 规则 + 例外管理", "目标态", NAVY2)
    footer = _footer("数智化后的业务变化：AI 把「找答案、判队列、查缺项」前置；人只处理确认、异常与高风险决策")
    return header + "".join(flow_svg) + "".join(cards) + legend + footer


# ---------------------------------------------------------------- 输出
def render(name, inner):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
           f'width="{W}" height="{H}" font-family="{FONT}">\n'
           f'<rect width="{W}" height="{H}" fill="#F7F9FC"/>\n'
           + inner + "\n</svg>\n")
    path = os.path.join(OUT, name + ".svg")
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    print("wrote", path, f"{W}x{H}")


if __name__ == "__main__":
    render("03-流程图-现状", draw_as_is())
    render("03-流程图-数智化转型后", draw_to_be())
