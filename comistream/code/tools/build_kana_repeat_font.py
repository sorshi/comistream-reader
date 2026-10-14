#!/usr/bin/env python3
"""Build the OFL-1.1 Comistream Kana Repeat font from a Shippori Mincho subset.

Usage: python3 build_kana_repeat_font.py halves.ttf ComistreamKanaRepeat-v2.ttf
See theme/fonts/kana-repeat/README.md for the pinned source and subset command.
"""

from pathlib import Path
import struct
import sys

if len(sys.argv) != 3:
    sys.exit(__doc__)
source = Path(sys.argv[1]).read_bytes()
u16 = lambda data, off: struct.unpack_from('>H', data, off)[0]
s16 = lambda data, off: struct.unpack_from('>h', data, off)[0]
u32 = lambda data, off: struct.unpack_from('>I', data, off)[0]
tables = {}
for i in range(u16(source, 4)):
    entry = 12 + i * 16
    tag = source[entry:entry + 4]
    offset, length = u32(source, entry + 8), u32(source, entry + 12)
    tables[tag] = bytearray(source[offset:offset + length])

def glyph(code):
    cmap = tables[b'cmap']
    for i in range(u16(cmap, 2)):
        off = u32(cmap, 4 + i * 8 + 4)
        if u16(cmap, off) != 4:
            continue
        n = u16(cmap, off + 6) // 2
        for j in range(n):
            end = u16(cmap, off + 14 + j * 2)
            start = u16(cmap, off + 16 + n * 2 + j * 2)
            if start <= code <= end:
                delta = s16(cmap, off + 16 + n * 4 + j * 2)
                address = off + 16 + n * 6 + j * 2
                shift = u16(cmap, address)
                return (code + delta) & 65535 if not shift else (u16(cmap, address + shift + (code - start) * 2) + delta) & 65535
    raise ValueError(hex(code))

count = u16(tables[b'maxp'], 4)
units = u16(tables[b'head'], 18)
long_loca = s16(tables[b'head'], 50)
loca = tables[b'loca']
offsets = [u32(loca, i * 4) if long_loca else u16(loca, i * 2) * 2 for i in range(count + 1)]
glyphs = [bytes(tables[b'glyf'][offsets[i]:offsets[i + 1]]) for i in range(count)]

def metrics(header, table):
    n = u16(tables[header], 34)
    values = [struct.unpack_from('>Hh', tables[table], i * 4) for i in range(n)]
    return values + [(values[-1][0], s16(tables[table], n * 4 + (i - n) * 2)) for i in range(n, count)]

horizontal = metrics(b'hhea', b'hmtx')
vertical = metrics(b'vhea', b'vmtx')
upper, voiced, lower = [glyph(c) for c in [0x3033, 0x3034, 0x3035]]
if count != 4 or units != 1000 or sorted([upper, voiced, lower]) != [1, 2, 3]:
    raise ValueError('Expected the unhinted U+3033–U+3035 Shippori Mincho subset')
max_points = max_contours = 0
# 上下の輪郭を縦に1emずらして合成し、1文字で縦2emのくの字点にするルン。
for top in [upper, voiced]:
    top_box = struct.unpack_from('>hhhh', glyphs[top], 2)
    low_box = struct.unpack_from('>hhhh', glyphs[lower], 2)
    box = (min(top_box[0], low_box[0]), low_box[1] - units, max(top_box[2], low_box[2]), top_box[3])
    compound = struct.pack('>hhhhh', -1, *box)
    compound += struct.pack('>HHhh', 0x0023, top, 0, 0)
    compound += struct.pack('>HHhh', 0x0003, lower, 0, -units)
    glyphs.append(compound)
    horizontal.append((units, box[0]))
    vertical.append((2 * units, vertical[top][1]))
    contours = [s16(glyphs[g], 0) for g in [top, lower]]
    points = [u16(glyphs[g], 10 + 2 * (n - 1)) + 1 for g, n in zip([top, lower], contours)]
    max_points = max(max_points, sum(points))
    max_contours = max(max_contours, sum(contours))

new_offsets = []
data = bytearray()
for item in glyphs:
    new_offsets.append(len(data))
    data.extend(item)
    data.extend(bytes((-len(data)) % 4))
new_offsets.append(len(data))
tables[b'glyf'] = data
tables[b'loca'] = bytearray(struct.pack('>' + 'I' * len(new_offsets), *new_offsets))
boxes = [struct.unpack_from('>hhhh', item, 2) for item in glyphs if len(item) >= 10]
struct.pack_into('>hhhh', tables[b'head'], 36, min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
struct.pack_into('>h', tables[b'head'], 50, 1)
struct.pack_into('>I', tables[b'head'], 8, 0)
struct.pack_into('>H', tables[b'maxp'], 4, len(glyphs))
struct.pack_into('>HH', tables[b'maxp'], 10, max_points, max_contours)
struct.pack_into('>HH', tables[b'maxp'], 28, 2, 1)
for header, table, values in [(b'hhea', b'hmtx', horizontal), (b'vhea', b'vmtx', vertical)]:
    struct.pack_into('>H', tables[header], 34, len(values))
    struct.pack_into('>H', tables[header], 10, max(m[0] for m in values))
    tables[table] = bytearray(b''.join(struct.pack('>Hh', *m) for m in values))

# WebKitは対象文字がなくても先頭候補の行寸法をルビ配置へ使うルン。
# hheaの広い寸法を組版用の1emへ合わせ、縦2emの字送りと輪郭は保持するルン。
typo_metrics = struct.unpack_from('>hhh', tables[b'OS/2'], 68)
if typo_metrics != (880, -120, 0) or typo_metrics[0] - typo_metrics[1] != units:
    raise ValueError('Expected one-em Shippori Mincho typographic metrics')
struct.pack_into('>hhh', tables[b'hhea'], 4, *typo_metrics)
struct.pack_into('>I', tables[b'head'], 4, 0x00020000)

codes = [0x3031, 0x3032, 0x3033, 0x3034, 0x3035, 0xffff]
ids = [count, count + 1, upper, voiced, lower, 0]
n = len(codes)
fmt4 = struct.pack('>HHHHHHH', 4, 16 + 8 * n, 0, 2 * n, 8, 2, 2 * n - 8)
fmt4 += struct.pack('>' + 'H' * n, *codes) + b'\0\0'
fmt4 += struct.pack('>' + 'H' * n, *codes)
fmt4 += struct.pack('>' + 'H' * n, *[(g - c) & 65535 for c, g in zip(codes, ids)])
fmt4 += bytes(2 * n)
tables[b'cmap'] = bytearray(struct.pack('>HHHHIHHI', 0, 2, 0, 3, 20, 3, 1, 20) + fmt4)

names = {0: 'Copyright 2021 The Shippori Mincho Project Authors. Modified for Comistream Reader.',
         1: 'Comistream Kana Repeat', 2: 'Regular',
         3: 'ComistreamKanaRepeat-2.0', 4: 'Comistream Kana Repeat',
         5: 'Version 2.0', 6: 'ComistreamKanaRepeat',
         13: 'SIL Open Font License 1.1. See the accompanying OFL.txt.', 14: 'https://openfontlicense.org/'}
strings = bytearray()
entries = bytearray()
for ident, text in sorted(names.items()):
    encoded = text.encode('utf-16be')
    entries.extend(struct.pack('>HHHHHH', 3, 1, 0x409, ident, len(encoded), len(strings)))
    strings.extend(encoded)
tables[b'name'] = bytearray(struct.pack('>HHH', 0, len(names), 6 + 12 * len(names)) + entries + strings)
tables[b'post'] = bytearray(struct.pack('>I', 0x00030000) + bytes(tables[b'post'][4:32]))
struct.pack_into('>HH', tables[b'OS/2'], 64, 0x3031, 0x3035)
allowed = {b'cmap', b'glyf', b'head', b'hhea', b'hmtx', b'loca', b'maxp', b'name', b'OS/2', b'post', b'vhea', b'vmtx', b'gasp'}
tables = {tag: data for tag, data in tables.items() if tag in allowed}
checksum = lambda data: sum(struct.unpack('>' + 'I' * ((len(data) + 3) // 4), bytes(data) + bytes((-len(data)) % 4))) & 0xffffffff
n = len(tables)
power = 2 ** (n.bit_length() - 1)
result = bytearray(struct.pack('>IHHHH', 0x00010000, n, power * 16, power.bit_length() - 1, n * 16 - power * 16))
body = bytearray()
head_offset = None
for tag, data in sorted(tables.items()):
    off = 12 + 16 * n + len(body)
    result.extend(tag + struct.pack('>III', checksum(data), off, len(data)))
    if tag == b'head': head_offset = off
    body.extend(data)
    body.extend(bytes((-len(body)) % 4))
result.extend(body)
struct.pack_into('>I', result, head_offset + 8, (0xb1b0afba - checksum(result)) & 0xffffffff)
output = Path(sys.argv[2])
output.write_bytes(result)
print(f'Comistream Kana Repeat: {len(result)} bytes; {len(glyphs)} glyphs; {units} units/em')
