from __future__ import annotations

import json
import math
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


CANVAS_W = 1540
CANVAS_H = 970
MAIN_H = 838
FOOTER_H = 132


def font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def cover_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize((math.ceil(image.width * scale), math.ceil(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def remove_connected_white_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    visited = set()
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        if a == 0:
            return True
        neutral = max(r, g, b) - min(r, g, b) < 38
        bright_enough = (r + g + b) / 3 > 64
        # 外周につながる白〜グレー影だけを背景扱い。商品ラベル内の白は守りやすい。
        return neutral and bright_enough

    for x in range(width):
        for y in (0, height - 1):
            if is_background(x, y):
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_background(x, y):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited:
            continue
        if not (0 <= x < width and 0 <= y < height) or not is_background(x, y):
            continue
        visited.add((x, y))
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    alpha = rgba.getchannel("A").filter(ImageFilter.GaussianBlur(0.6))
    rgba.putalpha(alpha)
    bbox = alpha.getbbox()
    return rgba.crop(bbox) if bbox else rgba


def paste_with_shadow(canvas: Image.Image, product: Image.Image, xy: tuple[int, int]) -> None:
    x, y = xy
    shadow = Image.new("RGBA", product.size, (0, 0, 0, 0))
    shadow.putalpha(product.getchannel("A").filter(ImageFilter.GaussianBlur(10)))
    shadow_tint = Image.new("RGBA", product.size, (0, 0, 0, 75))
    shadow = Image.alpha_composite(shadow, shadow_tint)
    canvas.alpha_composite(shadow, (x + 18, y + 20))
    canvas.alpha_composite(product, (x, y))


def draw_text_with_outline(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt: ImageFont.FreeTypeFont, fill: str, stroke: int = 6) -> None:
    draw.text(xy, text, font=fnt, fill=fill, stroke_width=stroke, stroke_fill="white")


def copy_lines(product_name: str) -> tuple[str, str, str]:
    if "いか天" in product_name or "醤油" in product_name:
        return ("香ばしい醤油味！", "たまり醤油のいか天", "おつまみ感のある景品商品")
    if "あまおう" in product_name or "苺" in product_name or "いちご" in product_name:
        return ("あまおう苺の", "爽やかなゼリー！", "涼しげで見映えする景品商品")
    if "レモン" in product_name:
        return ("塩レモンゼリーの", "爽やかなおいしさ！", "夏にうれしい塩レモン味")
    if "羊羹" in product_name or "ようかん" in product_name:
        return ("上品な甘さを楽しめる！", product_name.replace("ギフト", ""), "和菓子景品におすすめ")
    return ("景品向けに案内しやすい！", product_name, "見た目で伝わるおすすめ商品")


def main() -> None:
    if len(sys.argv) < 5:
        raise SystemExit("Usage: python compose-ai-leaf-demo.py <background> <product> <payload.json> <output>")

    bg_path = Path(sys.argv[1])
    product_path = Path(sys.argv[2])
    payload_path = Path(sys.argv[3])
    output_path = Path(sys.argv[4])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    product_data = payload["product"]
    sizing = payload.get("sizing", {})

    bg = Image.open(bg_path).convert("RGB")
    top = cover_resize(bg, (CANVAS_W, MAIN_H)).convert("RGBA")
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), "white")
    canvas.alpha_composite(top, (0, 0))

    product = remove_connected_white_background(Image.open(product_path))
    source_w, source_h = product.size
    max_scale = 2.2
    max_w, max_h = 560, 560
    scale = min(max_scale, max_w / source_w, max_h / source_h)
    product = product.resize((round(source_w * scale), round(source_h * scale)), Image.Resampling.LANCZOS)
    product = product.filter(ImageFilter.UnsharpMask(radius=1.0, percent=90, threshold=4))
    if "あまおう" in product_data["productName"] or "苺" in product_data["productName"] or "いちご" in product_data["productName"]:
        product_xy = ((CANVAS_W - product.width) // 2 - 80, 250)
    else:
        product_xy = (120, 210)
    paste_with_shadow(canvas, product, product_xy)

    draw = ImageDraw.Draw(canvas)
    title_font = font(60)
    sub_font = font(46)
    line1, line2, line3 = copy_lines(product_data["productName"])
    if "あまおう" in product_data["productName"] or "苺" in product_data["productName"] or "いちご" in product_data["productName"]:
        copy_x = 940
        title_font = font(54)
        sub_font = font(40)
    else:
        copy_x = 760
    draw_text_with_outline(draw, (copy_x, 118), line1, title_font, "#b54813", stroke=7)
    draw_text_with_outline(draw, (copy_x, 190), line2, title_font, "#b54813", stroke=7)
    draw_text_with_outline(draw, (copy_x, 268), line3, sub_font, "#173f8a", stroke=6)

    footer_y = MAIN_H
    draw.rectangle((0, footer_y, CANVAS_W, CANVAS_H), fill=(255, 253, 248, 255))
    draw.rectangle((0, footer_y, CANVAS_W, footer_y + 4), fill=(245, 183, 77, 255))

    gray = "#9ca3af"
    red = "#e01818"
    black = "#111111"
    blue = "#0022dd"
    small = font(15)
    name_font = font(36)
    metric_num = font(38)
    metric_label = font(19)
    detail_font = font(18)
    lead_font = font(27)

    product_name = product_data["productName"]
    draw.text((22, footer_y + 10), "商品コード未設定", font=small, fill=gray)
    draw.text((22, footer_y + 40), product_name, font=name_font, fill=black)

    item_count = 1
    leaf_qty = round(sizing.get("leafQty", 0))
    wholesale = round(sizing.get("wholesalePrice", 0))
    unit = round(sizing.get("unitPrice", 0))
    metrics = [
        (42, f"{item_count}", "アイテム"),
        (220, f"{leaf_qty:,}", "個入"),
        (390, "卸価格", f"{wholesale:,} 円(税別)"),
        (790, "単価", f"{unit:,} 円"),
    ]
    base_y = footer_y + 88
    for x, a, b in metrics:
        if a in ("卸価格", "単価"):
            draw.text((x, base_y + 7), a, font=metric_label, fill=black)
            draw.text((x + 88, base_y), b, font=metric_num, fill=red)
        else:
            draw.text((x, base_y), a, font=metric_num, fill=red)
            draw.text((x + 58, base_y + 10), b, font=metric_label, fill=black)

    details_x = 1010
    draw.text((details_x, footer_y + 28), "● 商品サイズ / 確認中", font=detail_font, fill=black)
    draw.text((details_x, footer_y + 56), f"● 賞味期限 / {product_data.get('shelfLife') or '確認中'}", font=detail_font, fill=black)

    draw.line((1230, footer_y + 34, 1415, footer_y + 34), fill=red, width=4)
    draw.line((1230, footer_y + 83, 1415, footer_y + 83), fill=red, width=4)
    draw.text((1250, footer_y + 43), "受注後約1週間", font=lead_font, fill=red)
    draw.rectangle((1425, footer_y + 28, 1516, footer_y + 88), fill=blue)
    draw.text((1447, footer_y + 45), f"ハーフ {'可' if sizing.get('isHalfOk') else '不可'}", font=detail_font, fill="white")
    draw.text((1345, footer_y + 101), "PJ番号 未設定", font=small, fill=black)

    canvas.convert("RGB").save(output_path, quality=94, subsampling=0)
    print(output_path)


if __name__ == "__main__":
    main()
