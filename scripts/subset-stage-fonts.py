#!/usr/bin/env python3
"""Re-subset the Chinese stage fonts (Noto Serif SC 500 + 300 brand, Noto Sans SC 500/600, Ma Shan Zheng 400; all OFL-1.1).

Source: Fontsource packages, which ship each font as unicode-range slices. For every wanted character we find the slice that
contains it, subset that slice (fonttools pyftsubset), then merge the pieces into one woff2.

  FONTSRC=/workspace/baymax-fonts-tmp/node_modules/@fontsource python3 scripts/subset-stage-fonts.py

Characters = every character of the `stage.*` strings in i18n/zh.ts (+ ASCII printable + a few typographic marks).
The thin Noto Serif SC 300 only gets the characters of `stage.brand`. Ma Shan Zheng only gets the characters of the easter-egg line (`stage.egg`).
"""
import os, re, subprocess, sys, tempfile
from pathlib import Path
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get('FONTSRC', '/workspace/baymax-fonts-tmp/node_modules/@fontsource'))
OUT = ROOT / 'stage' / 'fonts'
zh = (ROOT / 'i18n' / 'zh.ts').read_text(encoding='utf-8')
vals = dict(re.findall(r'"(stage\.[\w.]+)":\s*"([^"]*)"', zh))
chars = set(''.join(vals.values())) | set(chr(c) for c in range(0x20, 0x7f)) | set('·—…“”、。，：；？！→')
egg = set(vals['stage.egg']) | {' '}

def ranges(css_text):
    out = {}
    for m in re.finditer(r'/\* [\w-]+-\[(\d+)\]-(\d+)-normal \*/.*?unicode-range:\s*([^;]+);', css_text, re.S):
        rs = []
        for part in m.group(3).split(','):
            part = part.strip().lstrip('Uu+')
            a, _, b = part.partition('-')
            rs.append((int(a, 16), int(b or a, 16)))
        out[m.group(1)] = rs
    return out

def build(pkg, weight, wanted, out_name, single=None):
    pkgdir = SRC / pkg
    if single:  # packages with one slice file
        slices = {'x': ([(0, 0x10ffff)], pkgdir / 'files' / single)}
    else:
        css = (pkgdir / f'{weight}.css').read_text()
        slices = {k: (rs, pkgdir / 'files' / f'{pkg}-{k}-{weight}-normal.woff2') for k, rs in ranges(css).items()}
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for k, (rs, path) in slices.items():
            want = [c for c in wanted if any(a <= ord(c) <= b for a, b in rs)]
            if not want: continue
            f = TTFont(path); cmap = f.getBestCmap()
            want = [c for c in want if ord(c) in cmap]
            if not want: continue
            o = Path(tmp) / f'{k}.ttf'
            subprocess.run(['pyftsubset', str(path), f'--text={"".join(want)}', f'--output-file={o}', '--flavor=', '--layout-features=*', '--no-hinting'], check=True)
            parts.append(o)
        merged = Merger().merge([str(p) for p in parts]) if len(parts) > 1 else TTFont(parts[0])
        merged.flavor = 'woff2'; merged.save(OUT / out_name)
        cm = TTFont(OUT / out_name).getBestCmap()
        missing = [c for c in wanted if ord(c) not in cm and ord(c) > 0x7f]
        print(f'{out_name}: {(OUT / out_name).stat().st_size} B, {len(cm)} glyph codepoints, missing: {"".join(missing) or "-"}')

build('noto-serif-sc', 500, chars, 'noto-serif-sc-500-subset.woff2')
build('noto-serif-sc', 300, set(vals['stage.brand']), 'noto-serif-sc-300-brand.woff2')  # thin wordmark: brand characters only
build('noto-sans-sc', 500, chars, 'noto-sans-sc-500-subset.woff2')
build('noto-sans-sc', 600, chars, 'noto-sans-sc-600-subset.woff2')
build('ma-shan-zheng', 400, egg, 'ma-shan-zheng-400-subset.woff2')
