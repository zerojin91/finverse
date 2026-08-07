"""Shared engine for filling 2026 금융 AI Challenge HWPX form templates.

HWPX is a zip of XML. Both official templates (기획서 / 기능명세서) use the same
form-table shape: one <hp:tc> per section with colSpan=2, holding one <hp:p>
per paragraph. We clone that structure, swap the text, and recompute cell and
table heights so Hangul opens without clipping.
"""

import math
import os
import re
import shutil
import zipfile
from xml.etree import ElementTree

LINE_HEIGHT = 1600
CELL_PADDING = 850
LINE_CAPACITY = 44.0  # width units per rendered line, empirically ~53 mixed chars
TEAM_VALUE_CELL_WIDTH = "31734"  # 팀명/구성원 value cells in both templates


def text_width(text: str) -> float:
    """Rough rendered width in 'units' where a Hangul glyph is 1.0."""
    return sum(1.0 if ord(ch) > 0x2000 else 0.5 for ch in text)


def cell_height(paragraphs: list[str]) -> int:
    lines = sum(max(1, math.ceil(text_width(p) / LINE_CAPACITY)) for p in paragraphs)
    return CELL_PADDING + lines * LINE_HEIGHT


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_sublist(paragraphs: list[str], para_pr: str, char_pr: str) -> str:
    out = []
    for para in paragraphs:
        run = f'<hp:run charPrIDRef="{char_pr}"><hp:t>{esc(para)}</hp:t></hp:run>'
        out.append(
            f'<hp:p id="2147483648" paraPrIDRef="{para_pr}" styleIDRef="0" '
            f'pageBreak="0" columnBreak="0" merged="0">{run}'
            '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" '
            'textheight="1000" baseline="850" spacing="600" horzpos="0" '
            'horzsize="43768" flags="1441792"/></hp:linesegarray></hp:p>'
        )
    return "".join(out)


def fill_cell(cell_xml: str, paragraphs: list[str]) -> str:
    para_pr = re.search(r'<hp:p [^>]*paraPrIDRef="(\d+)"', cell_xml).group(1)
    char_pr_match = re.search(r'charPrIDRef="(\d+)"', cell_xml)
    char_pr = char_pr_match.group(1) if char_pr_match else "17"

    new_sublist = build_sublist(paragraphs, para_pr, char_pr)
    cell_xml = re.sub(
        r"(<hp:subList\b[^>]*>).*?(</hp:subList>)",
        lambda m: m.group(1) + new_sublist + m.group(2),
        cell_xml,
        flags=re.S,
    )
    # Never shrink a row below the template's own height.
    original = int(re.search(r'<hp:cellSz width="\d+" height="(\d+)"', cell_xml).group(1))
    height = max(original, cell_height(paragraphs))
    return re.sub(
        r'(<hp:cellSz width="\d+" height=")\d+(")',
        lambda m: f"{m.group(1)}{height}{m.group(2)}",
        cell_xml,
    )


def build(*, docs_dir, template_marker, out_name, content, team_name, team_members,
          preview_title, work_dir="/tmp/hwpx_build"):
    """Fill `template_marker`'s template with `content` and write `out_name`.

    content: {rowAddr: [paragraph, ...]}. "" renders an empty spacer line.
    """
    src = next(
        f for f in os.listdir(docs_dir)
        if f.endswith(".hwpx") and template_marker in f and "FINVERSE" not in f
    )
    shutil.rmtree(work_dir, ignore_errors=True)
    os.makedirs(work_dir)
    with zipfile.ZipFile(os.path.join(docs_dir, src)) as z:
        z.extractall(work_dir)
        order = [i.filename for i in z.infolist()]

    section_path = os.path.join(work_dir, "Contents/section0.xml")
    with open(section_path, encoding="utf-8") as fh:
        xml = fh.read()

    row_heights: dict[int, int] = {}

    def replace_cell(match: re.Match) -> str:
        cell = match.group(0)
        addr = re.search(r'<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"/>', cell)
        if not addr:
            return cell
        col, row = int(addr.group(1)), int(addr.group(2))
        span = re.search(r'<hp:cellSpan colSpan="(\d+)"', cell)
        is_form_row = span and span.group(1) == "2"

        if col == 1 and row in (0, 1) and f'width="{TEAM_VALUE_CELL_WIDTH}"' in cell:
            return fill_cell(cell, [team_name if row == 0 else team_members])

        if is_form_row:
            filled = fill_cell(cell, content[row]) if row in content else cell
            row_heights[row] = int(
                re.search(r'<hp:cellSz width="\d+" height="(\d+)"', filled).group(1)
            )
            return filled
        return cell

    xml = re.sub(r"<hp:tc\b.*?</hp:tc>", replace_cell, xml, flags=re.S)

    # Form table height = sum of its row heights. Rows 0-1 (팀명/구성원) have
    # colSpan 1 so they never enter row_heights.
    total = sum(row_heights.values()) + 3348 * 2
    sizes = list(re.finditer(r'<hp:sz width="(\d+)" widthRelTo="ABSOLUTE" height="(\d+)"', xml))
    form_sz = sizes[-1]  # the form table is the last sized object
    xml = xml[: form_sz.start()] + form_sz.group(0).replace(
        f'height="{form_sz.group(2)}"', f'height="{total}"'
    ) + xml[form_sz.end():]

    with open(section_path, "w", encoding="utf-8") as fh:
        fh.write(xml)

    # Finder/Hangul show this cached plain text; stale preview text is confusing.
    preview = [preview_title, f"팀명: {team_name}", ""]
    for row in sorted(content):
        preview.extend(content[row])
    with open(os.path.join(work_dir, "Preview/PrvText.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(preview))

    out_path = os.path.join(docs_dir, out_name)
    with zipfile.ZipFile(out_path, "w") as z:
        for name in order:
            # mimetype must be stored uncompressed and first (OCF requirement).
            ctype = zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED
            z.write(os.path.join(work_dir, name), name, compress_type=ctype)

    verify(out_path, content, team_name)
    print(f"wrote: {out_path}")
    print(f"table height: {total}")
    for row in sorted(row_heights):
        print(f"  row {row}: {row_heights[row]}")
    return out_path


def verify(path: str, content: dict, team_name: str) -> None:
    """Fail loudly rather than hand Hangul a file it refuses to open."""
    with zipfile.ZipFile(path) as z:
        first = z.infolist()[0]
        assert first.filename == "mimetype", "mimetype must be the first zip entry"
        assert first.compress_type == zipfile.ZIP_STORED, "mimetype must be stored"
        assert z.read("mimetype") == b"application/hwp+zip"
        for name in z.namelist():
            if name.endswith(".xml") or name.endswith(".hpf"):
                ElementTree.fromstring(z.read(name))  # raises on malformed XML
        body = z.read("Contents/section0.xml").decode("utf-8")

    for row, paragraphs in content.items():
        assert esc(paragraphs[0]) in body, f"row {row} content missing from output"
    assert team_name in body, "팀명 missing"
