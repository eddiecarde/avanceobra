"""Genera plano-demo.png: layout del Parque Solar Demo alineado con las esquinas de site_plans.

Coordenadas locales en metros (x este, y norte); el plano cubre x -15..197, y -15..141,
exactamente las 4 esquinas que guarda seed_demo_solar(). Uso: python generate_demo_plan.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PX_PER_M = 8
X0, X1, Y0, Y1 = -15, 197, -15, 141
W, H = (X1 - X0) * PX_PER_M, (Y1 - Y0) * PX_PER_M


def px(x: float, y: float) -> tuple[float, float]:
    return ((x - X0) * PX_PER_M, (Y1 - y) * PX_PER_M)


def rect(d: ImageDraw.ImageDraw, x0, y0, x1, y1, **kw):
    a, b = px(x0, y1), px(x1, y0)
    d.rectangle([a, b], **kw)


def font(size: int):
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), "#FAFAF7")
d = ImageDraw.Draw(img)

# Cuadrícula cada 10 m
for x in range(X0 - X0 % 10, X1 + 1, 10):
    d.line([px(x, Y0), px(x, Y1)], fill="#E5E7EB", width=1)
for y in range(Y0 - Y0 % 10, Y1 + 1, 10):
    d.line([px(X0, y), px(X1, y)], fill="#E5E7EB", width=1)

for code, name, x_off in (("A", "BLOQUE A", 0), ("B", "BLOQUE B", 110)):
    rect(d, x_off - 3, -10, x_off + 75, 129, outline="#374151", width=3)
    d.text(px(x_off, 136), name, fill="#111827", font=font(56))
    for r in range(2):
        for c in range(12):
            n = r * 12 + c + 1
            x, y = x_off + c * 6, r * 66
            rect(d, x, y, x + 2.2, y + 60, fill="#DBEAFE", outline="#1E3A8A", width=2)
            for k in range(8):
                cx, cy = px(x + 1.1, y + k * 60 / 7)
                d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill="#1E3A8A")
            tx, ty = px(x - 0.6, y + 63.5)
            d.text((tx, ty), f"T{n:02d}", fill="#1F2937", font=font(16))

# Zanja DC y corredor de cableado MT
d.line([px(0, -8.25), px(182, -8.25)], fill="#92400E", width=6)
d.text(px(76, -1), "ZANJA DC / CABLE MT", fill="#92400E", font=font(26))

# Rótulo (entre los dos bloques)
rect(d, 78, 40, 106, 90, fill="#FFFFFF", outline="#111827", width=2)
for i, (txt, size, color) in enumerate([
    ("PARQUE SOLAR", 22, "#111827"), ("DEMO", 22, "#111827"), ("Layout general", 18, "#374151"),
    ("8 px = 1 m", 16, "#374151"), ("Norte ↑", 16, "#374151"), ("Datos de prueba", 16, "#B91C1C"),
]):
    d.text(px(79.5, 87 - i * 7.5), txt, fill=color, font=font(size))

out = Path(__file__).with_name("plano-demo.png")
img.save(out, optimize=True)
print(f"{out} ({W}x{H} px)")
