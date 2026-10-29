# -*- coding: utf-8 -*-
"""把项目内的 markdown 报告转成排版规范的 docx（A4 / 宋体小四 / 1.5 倍行距 / 首行缩进 2 字符）"""
import re, sys, os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BODY_FONT = "宋体"
HEAD_FONT = "微软雅黑"
ACCENT = RGBColor(0x1F, 0x4E, 0x4A)


def set_font(run, name, size=None, bold=None, color=None):
    run.font.name = name
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), name)
    rFonts.set(qn("w:ascii"), name)
    rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def shade(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def add_page_number(par):
    run = par.add_run()
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    run._element.addnext(fld)


def add_rich(par, text, size=12, font=BODY_FONT, bold=False, color=None):
    for i, seg in enumerate(re.split(r"\*\*(.+?)\*\*", text)):
        if not seg:
            continue
        run = par.add_run(seg)
        set_font(run, font, size, bold or (i % 2 == 1), color)


def is_table_line(line):
    return line.strip().startswith("|") and line.strip().endswith("|")


def split_row(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def convert(md_path, docx_path, title=None, subtitle=None):
    lines = open(md_path, encoding="utf-8").read().splitlines()
    doc = Document()

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin = Cm(2.5)
    sec.bottom_margin = Cm(2.4)
    sec.left_margin = Cm(2.6)
    sec.right_margin = Cm(2.4)

    style = doc.styles["Normal"]
    style.font.name = BODY_FONT
    style.font.size = Pt(12)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)

    # 页脚页码
    footer = sec.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = fp.add_run("— ")
    set_font(run, BODY_FONT, 9, color=RGBColor(0x80, 0x80, 0x80))
    add_page_number(fp)
    run2 = fp.add_run(" —")
    set_font(run2, BODY_FONT, 9, color=RGBColor(0x80, 0x80, 0x80))

    i = 0
    first_h1_done = False
    while i < len(lines):
        line = lines[i]
        s = line.strip()

        if not s:
            i += 1
            continue

        if s.startswith("---") and set(s) <= {"-"}:
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(6)
            pPr = p._p.get_or_add_pPr()
            pbdr = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single")
            bottom.set(qn("w:sz"), "4")
            bottom.set(qn("w:color"), "C9D5D0")
            pbdr.append(bottom)
            pPr.append(pbdr)
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            level = len(m.group(1))
            text = m.group(2)
            if level == 1 and not first_h1_done:
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(6)
                p.paragraph_format.space_after = Pt(4)
                add_rich(p, text, 20, HEAD_FONT, True, ACCENT)
                if subtitle:
                    sp = doc.add_paragraph()
                    sp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    sp.paragraph_format.space_after = Pt(14)
                    add_rich(sp, subtitle, 10.5, HEAD_FONT, False, RGBColor(0x70, 0x70, 0x70))
                first_h1_done = True
            else:
                size = {2: 15, 3: 13, 4: 12}[min(level, 4)] if level > 1 else 15
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(12 if level <= 2 else 8)
                p.paragraph_format.space_after = Pt(5)
                p.paragraph_format.keep_with_next = True
                add_rich(p, text, size, HEAD_FONT, True, ACCENT)
            i += 1
            continue

        if is_table_line(s):
            block = []
            while i < len(lines) and is_table_line(lines[i].strip()):
                block.append(lines[i].strip())
                i += 1
            rows = [split_row(b) for b in block]
            rows = [r for r in rows if not all(re.fullmatch(r":?-{2,}:?", c or "") for c in r)]
            if not rows:
                continue
            ncol = max(len(r) for r in rows)
            table = doc.add_table(rows=len(rows), cols=ncol)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            for ri, row in enumerate(rows):
                for ci in range(ncol):
                    cell = table.cell(ri, ci)
                    cell.text = ""
                    p = cell.paragraphs[0]
                    p.paragraph_format.space_before = Pt(2)
                    p.paragraph_format.space_after = Pt(2)
                    p.paragraph_format.line_spacing = 1.05
                    txt = row[ci] if ci < len(row) else ""
                    if ri == 0:
                        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        add_rich(p, txt, 9.5, HEAD_FONT, True, RGBColor(0xFF, 0xFF, 0xFF))
                        shade(cell, "1F4E4A")
                    else:
                        add_rich(p, txt, 9.5, BODY_FONT)
                        if ri % 2 == 0:
                            shade(cell, "F3F7F5")
            doc.add_paragraph().paragraph_format.space_after = Pt(4)
            continue

        if s.startswith(">"):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.line_spacing = 1.4
            pPr = p._p.get_or_add_pPr()
            pbdr = OxmlElement("w:pBdr")
            left = OxmlElement("w:left")
            left.set(qn("w:val"), "single")
            left.set(qn("w:sz"), "18")
            left.set(qn("w:space"), "8")
            left.set(qn("w:color"), "1F4E4A")
            pbdr.append(left)
            pPr.append(pbdr)
            add_rich(p, s.lstrip("> ").strip(), 10.5, BODY_FONT, False, RGBColor(0x4A, 0x55, 0x51))
            i += 1
            continue

        m = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        if m:
            p = doc.add_paragraph()
            indent = 0.74 + (len(m.group(1)) // 2) * 0.6
            p.paragraph_format.left_indent = Cm(indent)
            p.paragraph_format.first_line_indent = Cm(-0.35)
            p.paragraph_format.line_spacing = 1.45
            p.paragraph_format.space_after = Pt(3)
            add_rich(p, "· " + m.group(2), 12)
            i += 1
            continue

        m = re.match(r"^(\d+)[.、]\s+(.*)$", s)
        if m:
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.74)
            p.paragraph_format.first_line_indent = Cm(-0.4)
            p.paragraph_format.line_spacing = 1.45
            p.paragraph_format.space_after = Pt(3)
            add_rich(p, f"{m.group(1)}. {m.group(2)}", 12)
            i += 1
            continue

        p = doc.add_paragraph()
        p.paragraph_format.first_line_indent = Cm(0.74)
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_after = Pt(4)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        add_rich(p, s, 12)
        i += 1

    doc.save(docx_path)
    print("docx:", docx_path)


if __name__ == "__main__":
    src = sys.argv[1]
    dst = sys.argv[2]
    sub = sys.argv[3] if len(sys.argv) > 3 else None
    convert(src, dst, subtitle=sub)
