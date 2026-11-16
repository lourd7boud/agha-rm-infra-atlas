"""Read the standard eight-page color scans published by the ministry."""

import csv
import io
import json
import math
import os
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps


# Each layout is checked against the row count and printed symbols before use.
# The scan may shift inside the page. Blue ink locates the columns.
TABLES = {
    2: (.24,
        "A At Fe Alp Tt Af Ac Aa Ai Fac Aco Tr Ta Tf Pg Bd Bm Cf Cu Bz Lt Sn Pbl Znl Al Ale Toa Tia Alw Pra "
        "Cv Cs Pl Br Gc Sb Sr He Cp Hm Hd Hu Hb Hr Hf Hi Gm"),
    3: (.09,
        "Fu G Esp Ci Ck Eh Eb Emt Wca Wct Ev La Lm Bi Biv Fi Bs Bs1 Bs2 Bs3 Cb Em Ems Ems1 Ems2 H Zn Mm Pp Ve Vep "
        "Vl Gl Pe Pr Pei Cy Cg Ne Bu Dc Ip Smr Sbr Ept Nca Tpa Tca Pam Crep Tba Tpc Tam Tc Py Ca Lust Disj E Cr Th Sa Gr Lie"),
    4: (.102,
        "T Mtn Tv Tp Mc2 Mc3 Mc4 Mc5 Mc6 Mc7 Mc8 Mc9 Mc10 Mc11 Q Qal CaR CaI CaM Ap Mc1 GOA GOB MQ PS/CaR PS/CaI "
        "PS/CaM ET ELI ELB Pv F Bpi S1 S S2 Sc ChTp ChB ChE ChFc ChFM"),
    7: (.087,
        "TR1 TR2 TR3 TR3bis TR4 TR4bis TR5 TR5bis TR6 TR6bis"),
    8: (.066,
        "OA1 OA2 OA3 OA4 OA5 BAT1 BAT2 BAT3 BAT4 BAT5 BAT6 SF1 SF2 SF3 SF4 SF5 SF6 CEP1 CEP2 CEP3 REP ING"),
}


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, encoding="utf-8", timeout=40,
                          env={**os.environ, "OMP_THREAD_LIMIT": "1"}).stdout


def render(source, folder, page):
    prefix = str(folder / "page")
    run("pdftoppm", "-r", "260", "-f", str(page), "-l", str(page), "-singlefile", "-png", source, prefix)
    with Image.open(prefix + ".png") as image:
        return image.convert("RGB")


def recognize(image, folder, mode="6", numeric=False, tsv=False, language="fra"):
    path = str(folder / "ocr.png")
    image.save(path)
    options = ["-c", "tessedit_char_whitelist=0123456789,."] if numeric else []
    return run("tesseract", path, "stdout", "-l", language, "--psm", mode, *options, *(["tsv"] if tsv else []))


def ink_mask(image):
    red, _, blue = image.split()
    color = ImageChops.subtract(blue, red).point(lambda value: 255 if value > 12 else 0)
    return ImageChops.multiply(color, red.point(lambda value: 255 if value < 170 else 0))


def column_centers(image):
    width, height = image.size
    section = image.crop((0, round(.32 * height), width, round(.66 * height)))
    density = list(ink_mask(section).resize((width, 1), Image.Resampling.BOX).getdata())
    radius = round(.016 * width)
    prefix = [0]
    for value in density:
        prefix.append(prefix[-1] + value)
    mass = [prefix[min(width, x + radius)] - prefix[max(0, x - radius)] for x in range(width)]
    step = max(1, round(.003 * width))
    best_score, best = 0, None
    for first in range(round(.60 * width), round(.76 * width), step):
        code = max(range(first - round(.13 * width), first - round(.064 * width), step), key=mass.__getitem__)
        for gap in range(round(.071 * width), round(.114 * width), step):
            centers = [code, first, first + gap, first + 2 * gap]
            if centers[-1] >= .97 * width:
                continue
            score = math.prod(mass[x] for x in centers)
            if score > best_score:
                best_score, best = score, centers
    if best is None:
        raise ValueError("Colonnes d'index colorées introuvables.")
    return [x / width for x in best]


def cell_bands(image, ymin, ymax, center, radius):
    width, height = image.size
    strip = image.crop((round(width * (center - radius)), round(height * ymin),
                        round(width * (center + radius)), round(height * ymax)))
    mask = ink_mask(strip)
    bands = []
    for y in range(mask.height):
        if mask.crop((0, y, mask.width, y + 1)).histogram()[255] <= 4:
            continue
        if bands and y - bands[-1][1] < 7:
            bands[-1][1] = y
        else:
            bands.append([y, y])
    cells = []
    for start, end in bands:
        if end - start < 12:
            continue
        left, _, right, _ = mask.crop((0, start, mask.width, end + 1)).getbbox()
        cells.append((start, strip.crop((max(0, left - 5), max(0, start - 4),
                                       min(mask.width, right + 5), min(mask.height, end + 5)))))
    return cells


def normalize_number(text, precision):
    parts = text.replace(",", ".").strip().split(".")
    if len(parts) == 1 and parts[0].isascii() and parts[0].isdigit() and len(parts[0]) > precision:
        parts = [parts[0][:-precision], parts[0][-precision:]]
    if (len(parts) != 2 or len(parts[1]) != precision or not all(part.isascii() and part.isdigit() for part in parts)):
        return None
    value = float(".".join(parts))
    return value if 0 < value < 100_000 else None


def trim_table_rules(cell):
    """Discard fragments of the black border that appear as extra glyphs."""
    dark = ImageOps.grayscale(cell).point(lambda value: 255 if value < 135 else 0)
    width, height = cell.size
    vertical = [x for x, value in enumerate(dark.resize((width, 1), Image.Resampling.BOX).getdata()) if value > 217]
    horizontal = [y for y, value in enumerate(dark.resize((1, height), Image.Resampling.BOX).getdata()) if value > 197]
    left = max((x + 3 for x in vertical if x < width * .25), default=0)
    right = min((x - 2 for x in vertical if x > width * .75), default=width)
    top = max((y + 3 for y in horizontal if y < height * .25), default=0)
    bottom = min((y - 2 for y in horizontal if y > height * .70), default=height)
    return cell.crop((left, top, right, bottom))


def read_grid(columns, folder, variant, numeric):
    step_x, step_y, margin = 256, 80, 20
    rows = len(columns[0])
    canvas = Image.new("L", (len(columns) * step_x, rows * step_y + 2 * margin), 255)
    for x, column in enumerate(columns):
        for y, (_, cell) in enumerate(column):
            gray = cell.getchannel("R") if variant == 1 else ImageOps.grayscale(cell)
            if variant == 2:
                gray = gray.point(lambda value: 0 if value < 150 else 255)
            if gray.width >= step_x or gray.height >= step_y:
                raise ValueError("Une cellule dépasse le gabarit du barème.")
            canvas.paste(gray, (x * step_x + (step_x - gray.width) // 2, margin + y * step_y))
    words = [[[] for _ in columns] for _ in range(rows)]
    payload = recognize(canvas, folder, numeric=numeric, tsv=True, language="eng" if variant == 1 else "fra")
    for word in csv.DictReader(io.StringIO(payload), delimiter="\t", quoting=csv.QUOTE_NONE):
        if word["level"] != "5" or not word["text"]:
            continue
        x = (int(word["left"]) + int(word["width"]) // 2) // step_x
        y = (int(word["top"]) + int(word["height"]) // 2 - margin) // step_y
        if 0 <= x < len(columns) and 0 <= y < rows:
            words[y][x].append(word["text"])
    return [["".join(cell) for cell in row] for row in words]


def matching_number(readings, precision, isolated=False):
    counts = Counter(value for reading in readings if (value := normalize_number(reading, precision)) is not None)
    # A partial read can drop the first digit. Ignore it only when two reads
    # saw the same leading digit and the full remainder agrees exactly.
    for value in list(counts):
        digits = f"{value:.{precision}f}"
        if any(count >= 2 and f"{other:.{precision}f}"[1:] == digits
               for other, count in counts.items()):
            del counts[value]
    for value, count in counts.most_common(1):
        if count >= 2 and (len(counts) == 1 or (isolated and count >= 3 and count * 3 >= 2 * counts.total())):
            return value
    return None


def check_symbols(folder, column, centered, symbols, page):
    equivalents = str.maketrans({"i": "l", "1": "l", "0": "o", "5": "s"})
    def key(value):
        plain = unicodedata.normalize("NFD", value.lower())
        return "".join(char for char in plain if char.isalnum() or char == "/").translate(equivalents)

    printed = [read_grid([column], folder, variant, False) for variant in range(3)]
    issues = []
    for index, expected in enumerate(symbols):
        observed = [reading[index][0] for reading in printed]
        accepted = {key(expected)}
        if expected.startswith("Mc"):
            accepted.add(key(expected.replace("Mc", "Me", 1)))
        if expected in ("Wca", "Wct", "Dc", "Tca", "ChFc", "Gc", "Tc", "Sc"):
            accepted.add(key(expected.replace("c", "e", 1)))
        if expected == "TR6bis":
            accepted.update((key("TRébis"), key("TRO6bis")))
        if expected in ("Tpc", "Pv"):
            accepted.add(key({"Tpc": "Tpe", "Pv": "Py"}[expected]))
        if accepted.intersection(map(key, observed)):
            continue
        cell = column[index][1]
        gray = ImageOps.expand(ImageOps.grayscale(cell), border=14, fill=255)
        red = ImageOps.expand(cell.getchannel("R"), border=14, fill=255)
        observed.extend([recognize(gray, folder, "8"), recognize(gray, folder, "7", language="eng"),
                         recognize(red, folder, "13", language="eng")])
        if len(expected) == 1 and not accepted.intersection(map(key, observed)):
            # The blue approval stamp can overlap the edge of a narrow symbol cell.
            isolated = ImageOps.expand(ImageOps.grayscale(centered[index]), border=18, fill=255)
            observed.extend([recognize(isolated, folder, "10"), recognize(isolated, folder, "10", language="eng")])
        if not accepted.intersection(map(key, observed)):
            issues.append(f"Page {page} : symbole {expected} non confirmé ({[value.strip() for value in observed]}).")
    return issues


def extract_table(image, folder, page):
    ymin, codes = TABLES[page]
    centers = column_centers(image)
    symbols = codes.split()
    ymax = .74 if page == 8 else .90 if page == 7 else .94
    columns = [cell_bands(image, ymin, ymax, center, .047 if index == 0 else .04)
               for index, center in enumerate(centers)]
    width, height = image.size
    groups = []
    for y, index in sorted((y, index) for index, column in enumerate(columns[1:]) for y, _ in column):
        if groups and y - groups[-1][0][0] <= 19 and index not in {i for _, i in groups[-1]}:
            groups[-1].append((y, index))
        else:
            groups.append([(y, index)])
    rows_y = [round(sum(y for y, _ in group) / len(group)) for group in groups if len(group) >= 2]
    if len(rows_y) != len(symbols):
        raise ValueError(f"Page {page} : {len(rows_y)} lignes alignées, {len(symbols)} attendues ({[len(column) for column in columns]}).")

    def recover_column(column, center):
        cells = []
        for index, y in enumerate(rows_y):
            matched = [cell for cell in column if abs(cell[0] - y) <= 19]
            next_y = rows_y[index + 1] if index + 1 < len(rows_y) else y + 60
            if len(matched) == 1 and matched[0][1].height <= next_y - y + 4:
                cells.append(matched[0])
            else:
                top = round(ymin * height) + y
                bottom = top + min(37, next_y - y - 2)
                crop = image.crop((round((center - .032) * width), top - 7,
                                   round((center + .032) * width), bottom))
                cells.append((y, crop))
        return cells

    symbol_column, *columns = [recover_column(column, center) for column, center in zip(columns, centers)]
    x = round(centers[0] * width)
    inset = round(.012 * width)
    top = round(ymin * height)
    centered = [image.crop((x - inset, top + y - 6, x + inset, top + y + 37)) for y in rows_y]
    issues = check_symbols(folder, symbol_column, centered, symbols, page)
    columns = [[(y, trim_table_rules(cell)) for y, cell in column] for column in columns]
    reads = [[read_grid([column], folder, variant, True) for variant in range(3)] for column in columns]
    rows = []
    for index, code in enumerate(symbols):
        values = []
        for col, column in enumerate(columns):
            precision = 2 if code.startswith("Ch") else 1
            readings = [read[index][0] for read in reads[col]]
            value = matching_number(readings, precision)
            if value is None:
                cell = column[index][1]
                crop = ImageOps.expand(ImageOps.grayscale(cell), border=12, fill=255)
                enlarged = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
                isolated = [
                    recognize(crop, folder, "7", True),
                    recognize(crop, folder, "13", True, language="eng"),
                    recognize(enlarged, folder, "7", True, language="eng"),
                    recognize(enlarged.point(lambda v: 0 if v < 180 else 255), folder, "8", True),
                    recognize(ImageOps.autocontrast(enlarged, cutoff=1), folder, "7", True),
                    recognize(ImageOps.expand(cell.getchannel("R"), border=15, fill=255), folder, "7", True, language="eng"),
                ]
                value = matching_number(isolated, precision, isolated=True)
                if value is None:
                    detail = ImageOps.expand(ImageOps.grayscale(cell), border=14, fill=255)
                    variants = [
                        detail.resize((detail.width * 3, detail.height * 3), Image.Resampling.NEAREST),
                        detail.rotate(1, fillcolor=255, resample=Image.Resampling.BICUBIC),
                        detail.filter(ImageFilter.UnsharpMask(radius=1, percent=200, threshold=2)),
                    ]
                    isolated += [recognize(view, folder, "7") for view in variants]
                    value = matching_number(isolated, precision, isolated=True)
                readings += isolated
            if value is None:
                issues.append(f"Page {page} : lectures discordantes pour {code} (colonne {col + 1}, {readings}).")
            values.append(value)
        rows.append({"page": page, "code": code, "values": values})
    heading = ""
    if page in (7, 8):
        first = ymin + rows_y[0] / height
        header_cells = [cell_bands(image, max(0, first - .074), first - .009, center, .035)
                        for center in centers[1:]]
        if all(header_cells):
            last_shared = next((y for y, _ in reversed(header_cells[0])
                                if all(any(abs(y - other) <= 25 for other, _ in col) for col in header_cells)), None)
            if last_shared is not None:
                for column in header_cells:
                    _, cell = min(column, key=lambda candidate: abs(candidate[0] - last_shared))
                    padded = ImageOps.expand(ImageOps.grayscale(cell), border=12, fill=255)
                    heading += " " + recognize(padded, folder, "7").strip()
    return rows, heading, issues


def main(source):
    if not any(line.split() == ["Pages:", "8"] for line in run("pdfinfo", source).splitlines()):
        raise ValueError("Le nombre de pages ne correspond pas au barème mensuel.")
    with tempfile.TemporaryDirectory(prefix="atlas-index-table-") as workdir:
        folder = Path(workdir)
        covers, rows, headings, issues = [], [], [], []
        for page in (2, 6, 3, 4, 7, 8):
            image = render(source, folder, page)
            if page in (2, 6):
                w, h = image.size
                cover = image.crop((round(.075 * w), round(.025 * h), round(.88 * w),
                                    round((.178 if page == 2 else .44) * h)))
                covers.append({"num": page, "text": recognize(cover, folder, "11")})
            if page in TABLES:
                try:
                    table, heading, table_issues = extract_table(image, folder, page)
                except ValueError as error:
                    issues.append(str(error))
                    continue
                rows.extend(table)
                issues.extend(table_issues)
                if page in (7, 8):
                    headings.append(heading)
        if issues:
            return {"failure": " ".join(issues)}
        return {"covers": covers, "rows": rows, "globalHeadings": headings}


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1])))
    except (ValueError, subprocess.SubprocessError, OSError) as error:
        print(json.dumps({"failure": str(error)}))
