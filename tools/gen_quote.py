# -*- coding: utf-8 -*-
"""生成 docs/05-报价单.xlsx：三档报价明细、方案对比、条款与假设。金额口径集中在此，避免多处不一致。"""
import os, re
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

DOCS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")

# ---------------------------------------------------------------- 报价数据
TAX = 0.06
PNAME = {"A": "A 档 · 试点版（3 店 / 12 周）", "B": "B 档 · 标准版（48 店全量）", "C": "C 档 · 进阶版（含预测与 VMI）"}

# (类别, 项目, 说明, 单位, {方案: 数量}, 单价, 备注)
ITEMS = [
    ("人力", "业务挖掘与 FDE 分析", "访谈、现状流程、需求与验收口径", "人天", {"A": 8, "B": 12, "C": 16}, 3200),
    ("人力", "数据工程", "接口替身、快照、口径统一、数据治理", "人天", {"A": 9, "B": 22, "C": 30}, 2900),
    ("人力", "规则与算法", "建议量引擎、硬约束、调拨评分、模型接入", "人天", {"A": 9, "B": 18, "C": 34}, 3300),
    ("人力", "前端与全栈", "门店端 H5、计划员协同台、看板", "人天", {"A": 14, "B": 28, "C": 40}, 2700),
    ("人力", "测试与评估", "60 例评估集、异常演练、回归", "人天", {"A": 6, "B": 12, "C": 18}, 2300),
    ("人力", "实施与培训", "驻场、门店培训、上线支持", "人天", {"A": 6, "B": 10, "C": 16}, 2500),
    ("软件订阅", "补货协同平台许可（首年）", "按门店数计费，含升级与支持", "店/年", {"A": 3, "B": 48, "C": 48}, 2600),
    ("软件订阅", "算力与预测服务（首年）", "规则引擎托管 + 基础预测调用", "年", {"A": 1, "B": 1, "C": 1}, 16000),
    ("软件订阅", "数据集成中间件（首年）", "3 类接口的调度、重试、监控", "年", {"A": 1, "B": 1, "C": 1}, 11000),
    ("实施服务", "历史数据治理", "24 个月 POS/WMS 数据清洗与对齐", "项", {"A": 1, "B": 1, "C": 1}, 20000),
    ("实施服务", "系统对接", "POS / WMS / 商品主数据 每个接口", "个", {"A": 2, "B": 3, "C": 4}, 20000),
    ("实施服务", "门店与计划员培训", "每场 3 小时，含操作手册", "场", {"A": 2, "B": 4, "C": 6}, 5800),
    ("硬件（可选）", "手持终端（扫码收货）", "安卓手持机，含 3 年质保", "台", {"A": 6, "B": 20, "C": 48}, 1800),
    ("硬件（可选）", "货架标签与耗材", "最小陈列量标识、扫码贴", "批", {"A": 1, "B": 1, "C": 1}, 3000),
    ("模型与协同", "需求预测模型（促销/天气/节假日）", "含标注、回测、上线", "项", {"A": 0, "B": 0, "C": 1}, 180000),
    ("模型与协同", "供应商 VMI 协同门户", "供应商查看库存、主动补货", "项", {"A": 0, "B": 0, "C": 1}, 120000),
]

def build_plan(plan):
    rows = []
    for cat, name, desc, unit, qty, price in ITEMS:
        q = qty[plan]
        if q == 0:
            continue
        rows.append([cat, name, desc, unit, q, price, q * price])
    sub = sum(r[6] for r in rows)
    pm = int(round(sub * 0.06, -2))
    rows.append(["项目管理", "项目管理与风险预备", "周会、变更、风险与验收协调（按明细 6%）", "项", 1, pm, pm])
    ex = sub + pm
    total = int(round(ex * 1.06, -3))
    tax = total - ex
    return rows, sub, pm, ex, tax, total


thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
H_FILL = PatternFill("solid", fgColor="1F4E4A")
SUB_FILL = PatternFill("solid", fgColor="E8F1EE")
TOT_FILL = PatternFill("solid", fgColor="FFF2CC")
MONEY = '#,##0'


def style_header(ws, row, ncol):
    for c in range(1, ncol + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
        cell.fill = H_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BOX
    ws.row_dimensions[row].height = 26


def style_body(ws, r1, r2, ncol, money_cols=()):
    for r in range(r1, r2 + 1):
        for c in range(1, ncol + 1):
            cell = ws.cell(row=r, column=c)
            cell.font = Font(name="微软雅黑", size=9.5)
            cell.border = BOX
            cell.alignment = Alignment(vertical="center", wrap_text=(c in (2, 3)),
                                       horizontal="right" if c in money_cols else ("center" if c in (1, 4, 5) else "left"))
            if c in money_cols:
                cell.number_format = MONEY


def sheet_plan(wb, plan, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = f"报价明细-{plan}档"
    ws.sheet_view.showGridLines = False
    ws.merge_cells("A1:G1")
    ws["A1"] = f"拾光连锁 · 门店补货与库存协同 ｜ {PNAME[plan]}"
    ws["A1"].font = Font(name="微软雅黑", size=13, bold=True, color="1F4E4A")
    ws["A1"].alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 30

    ws.merge_cells("A2:G2")
    ws["A2"] = "报价单位：【报价方公司名称】   ｜   报价日期：2026-10-29   ｜   报价有效期：60 天   ｜   币种：人民币（含税）"
    ws["A2"].font = Font(name="微软雅黑", size=9, color="595959")

    head = ["类别", "项目", "说明", "单位", "数量", "单价（元）", "金额（元）"]
    for i, h in enumerate(head, 1):
        ws.cell(row=4, column=i, value=h)
    style_header(ws, 4, 7)

    rows, sub, pm, ex, tax, total = build_plan(plan)
    r = 5
    for row in rows:
        for i, v in enumerate(row, 1):
            ws.cell(row=r, column=i, value=v)
        r += 1
    style_body(ws, 5, r - 1, 7, money_cols=(5, 6, 7))

    totals = [
        ("小计（不含税）", ex, False),
        ("增值税（6%）", tax, False),
        ("报价总额（含税）", total, True),
    ]
    for label, val, bold in totals:
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        c = ws.cell(row=r, column=1, value=label)
        c.alignment = Alignment(horizontal="right", vertical="center")
        c.font = Font(name="微软雅黑", size=10, bold=bold)
        v = ws.cell(row=r, column=7, value=val)
        v.number_format = MONEY
        v.font = Font(name="微软雅黑", size=10.5, bold=bold)
        v.alignment = Alignment(horizontal="right", vertical="center")
        if bold:
            for cc in range(1, 8):
                ws.cell(row=r, column=cc).fill = TOT_FILL
                ws.cell(row=r, column=cc).border = BOX
        r += 1

    notes = [
        "说明：",
        "1. 人力单价为综合人天单价，已含差旅（限华东三城）；超出范围按实结算。",
        "2. 软件订阅与算力为**首年**费用，第二年起按合同价的 15%/年 收取运维与订阅费。",
        "3. 硬件为可选项，可用现有设备替代；不含门店网络改造与电力施工。",
        "4. 不含：门店 POS 硬件更换、ERP 版本升级、促销排期系统改造、跨区域（苏州↔上海）调拨。",
        "5. 本报价基于 01-业务挖掘.md 与 04-设计方案.md 的范围；范围变更按变更单另行报价。",
        "6. 付款节点：合同签订 30%、试点上线 40%、验收通过 20%、质保期满 10%。",
    ]
    r += 1
    for n in notes:
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7)
        c = ws.cell(row=r, column=1, value=n.replace("**", ""))
        c.font = Font(name="微软雅黑", size=9, bold=n.endswith("："), color="404040")
        c.alignment = Alignment(vertical="center", wrap_text=True)
        r += 1

    widths = [12, 30, 40, 10, 8, 14, 16]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A5"
    return ws


def sheet_compare(wb):
    ws = wb.create_sheet("方案对比", 0)
    ws.sheet_view.showGridLines = False
    ws.merge_cells("A1:E1")
    ws["A1"] = "三档方案对比 · 门店补货与库存协同"
    ws["A1"].font = Font(name="微软雅黑", size=14, bold=True, color="1F4E4A")
    ws.row_dimensions[1].height = 32

    head = ["对比项", "A 档 · 试点版", "B 档 · 标准版", "C 档 · 进阶版", "说明"]
    for i, h in enumerate(head, 1):
        ws.cell(row=3, column=i, value=h)
    style_header(ws, 3, 5)

    data = [
        ["覆盖门店", "3 店（上海 2 / 苏州 1）", "48 店全量", "48 店 + 供应商协同", "试点验证后再放开"],
        ["覆盖品类", "12 个（常温 + 冷藏）", "全品类（除冷冻）", "全品类含冷冻", "冷冻需温度链改造"],
        ["缺货识别 + 建议量", "✓", "✓", "✓", "规则引擎，非模型"],
        ["例外复核工作台", "✓", "✓", "✓", "计划员核心界面"],
        ["跨店调拨评分", "—", "✓", "✓", "5 因子加权"],
        ["指标看板（5 项）", "基础版", "完整版", "完整版 + 归因", "对应业务挖掘基线口径"],
        ["需求预测模型", "—", "—", "✓", "6 个月历史 + 促销标记"],
        ["供应商 VMI", "—", "—", "✓", "需供应商配合"],
        ["实施周期", "12 周", "20 周", "32 周", "自合同生效起算"],
        ["报价总额（含税）", "见明细", "见明细", "见明细", "详见各档明细"],
        ["第二年起年费", "约 4.3 万", "约 10.3 万", "约 16.7 万", "按合同价 15%/年"],
        ["适用判断", "先验证流程与采用率", "试点达标后的主力方案", "已有稳定数据与供应商协同基础"],
    ]
    r = 4
    for row in data:
        for i, v in enumerate(row, 1):
            ws.cell(row=r, column=i, value=v)
        r += 1
    style_body(ws, 4, r - 1, 5, money_cols=(2, 3, 4))
    for i, w in enumerate([22, 26, 24, 24, 34], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for rr in range(4, r):
        for c in (2, 3, 4):
            ws.cell(row=rr, column=c).alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            if isinstance(ws.cell(row=rr, column=c).value, int):
                ws.cell(row=rr, column=c).number_format = MONEY
    ws.freeze_panes = "B4"
    return ws


def sheet_terms(wb):
    ws = wb.create_sheet("条款与假设")
    ws.sheet_view.showGridLines = False
    ws.merge_cells("A1:C1")
    ws["A1"] = "报价依据、条款与关键假设"
    ws["A1"].font = Font(name="微软雅黑", size=13, bold=True, color="1F4E4A")
    head = ["类别", "条款 / 假设", "说明"]
    for i, h in enumerate(head, 1):
        ws.cell(row=3, column=i, value=h)
    style_header(ws, 3, 3)
    rows = [
        ("计价口径", "人力按人天计价，1 人天 = 8 小时", "法定节假日与加班另计"),
        ("计价口径", "软件订阅与算力按首年计", "第二年起 15%/年"),
        ("计价口径", "税率 6%（现代服务业增值税专用发票）", "如需 13% 硬件专票，硬件部分单独开具"),
        ("付款", "30% 签约 / 40% 试点上线 / 20% 验收 / 10% 质保期满", "逾期 15 日以上按日 0.03% 计违约金"),
        ("工期", "自合同生效且数据接口就绪之日起算", "数据接口延迟不计入工期，可顺延"),
        ("验收", "以 04-设计方案.md 第 8 节 6 项指标为准", "未达标按缺陷清单整改，最长 30 日"),
        ("知识产权", "定制代码著作权归甲方，乙方保留通用组件权利", "第三方开源组件遵循其许可证"),
        ("数据", "数据不出甲方环境；乙方仅在授权范围内访问", "含脱敏与访问审计要求"),
        ("质保", "验收后 12 个月，工作日 8 小时内响应", "重大故障 4 小时到场（远程 1 小时）"),
        ("假设", "POS/WMS 可提供 T-1 的 SKU-店 日粒度数据", "若需实时接口，另计接口改造费"),
        ("假设", "商品主数据（MOQ、箱规、保质期）完整可用", "缺失项由甲方补齐或按 200 元/SKU 代录"),
        ("假设", "门店可提供 1 名对接人与每店 2 小时培训时间", "影响采用率目标达成"),
        ("不含", "门店 POS 硬件、网络改造、ERP 升级", "如需，另行报价"),
        ("不含", "跨区域（苏州↔上海）调拨与冷冻品类", "试点范围之外"),
    ]
    r = 4
    for row in rows:
        for i, v in enumerate(row, 1):
            ws.cell(row=r, column=i, value=v)
        r += 1
    style_body(ws, 4, r - 1, 3)
    for i, w in enumerate([12, 46, 52], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A4"
    return ws


def make_xlsx():
    wb = Workbook()
    sheet_plan(wb, "A", first=True)
    sheet_plan(wb, "B")
    sheet_plan(wb, "C")
    sheet_compare(wb)
    sheet_terms(wb)
    p = os.path.join(DOCS, "05-报价单.xlsx")
    wb.save(p)
    print("xlsx:", p)
    for k in "ABC":
        rows, sub, pm, ex, tax, total = build_plan(k)
        print(f"  {k}: 明细小计 {sub:,} 项目管理 {pm:,} 不含税 {ex:,} 税 {tax:,} 含税 {total:,}")


if __name__ == "__main__":
    make_xlsx()
