from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
OUT = ROOT / "groupguard-rental-poster.png"
OUT_VERSIONED = ROOT / "groupguard-rental-poster-v2.png"
OUT_V3 = ROOT / "groupguard-rental-poster-v3.png"
W, H = 1440, 1920
FONT_DIR = Path(r"C:\Windows\Fonts")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = ["msyhbd.ttc", "Dengb.ttf", "simhei.ttf"] if bold else ["msyh.ttc", "Deng.ttf", "simsun.ttc"]
    for name in names:
        path = FONT_DIR / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def cover_image(path: Path, size: tuple[int, int], crop_bias_y: float = 0.22) -> Image.Image:
    src = Image.open(path).convert("RGB")
    sw, sh = src.size
    tw, th = size
    scale = max(tw / sw, th / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    src = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max((nw - tw) // 2, 0)
    top = int(max((nh - th) * crop_bias_y, 0))
    return src.crop((left, top, left + tw, top + th))


def gradient_bg() -> Image.Image:
    img = Image.new("RGB", (W, H), "#07111f")
    px = img.load()
    for y in range(H):
        for x in range(W):
            nx = x / W
            ny = y / H
            r = int(7 + 12 * nx + 7 * (1 - ny))
            g = int(17 + 28 * nx + 10 * ny)
            b = int(31 + 44 * nx + 28 * ny)
            px[x, y] = (r, g, b)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((-360, -240, 780, 700), fill=(24, 122, 255, 44))
    d.ellipse((680, 120, 1740, 1180), fill=(0, 211, 190, 38))
    d.ellipse((420, 1160, 1600, 2240), fill=(255, 177, 59, 26))
    d.line((80, 1460, 1320, 420), fill=(80, 230, 255, 58), width=3)
    d.line((106, 1492, 1348, 452), fill=(255, 255, 255, 22), width=1)
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def paste_panel(base: Image.Image, path: Path, box: tuple[int, int, int, int], accent: str) -> None:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    photo = cover_image(path, (w, h))
    photo = ImageEnhance.Color(photo).enhance(0.72)
    photo = ImageEnhance.Contrast(photo).enhance(1.16)
    shade = Image.new("RGBA", (w, h), (3, 10, 20, 75))
    photo = Image.alpha_composite(photo.convert("RGBA"), shade)
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, w, h), radius=34, fill=255)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x1 + 12, y1 + 20, x2 + 12, y2 + 20), radius=34, fill=(0, 0, 0, 100))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(24)))
    base.paste(photo, (x1, y1), mask)
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=34, outline=accent, width=3)
    d.rectangle((x1, y2 - 70, x2, y2), fill=(4, 12, 24, 118))
    d.text((x1 + 28, y2 - 48), "系统化运营", font=font(22, True), fill="#b8f7ff")


def pill(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, accent: str) -> int:
    x, y = xy
    f = font(29, True)
    tw = draw.textbbox((0, 0), text, font=f)[2]
    draw.rounded_rectangle((x, y, x + tw + 48, y + 58), radius=29, fill="#0a2138", outline=accent, width=2)
    draw.text((x + 24, y + 11), text, font=f, fill="#f2fbff")
    return x + tw + 70


def draw_wrapped(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, fnt, fill: str, max_width: int, gap: int = 10) -> int:
    line = ""
    lines: list[str] = []
    for ch in text:
        if draw.textbbox((0, 0), line + ch, font=fnt)[2] <= max_width:
            line += ch
        else:
            if line:
                lines.append(line)
            line = ch
    if line:
        lines.append(line)
    for item in lines:
        draw.text((x, y), item, font=fnt, fill=fill)
        y += fnt.size + gap
    return y


def main() -> None:
    image = gradient_bg().convert("RGBA")
    draw = ImageDraw.Draw(image)

    paste_panel(image, ASSETS / "larry_page.jpg", (810, 108, 1134, 610), "#3de6ff")
    paste_panel(image, ASSETS / "sergey_brin.jpg", (1090, 306, 1372, 804), "#7cf6c8")
    paste_panel(image, ASSETS / "sundar_pichai.jpg", (798, 820, 1178, 1392), "#f7c25d")

    draw.text((94, 110), "GroupGuardKing", font=font(76, True), fill="#f5fbff")
    draw.text((94, 204), "群管王", font=font(136, True), fill="#40d7ff")
    draw.text((96, 366), "把群运营做成系统工程", font=font(58, True), fill="#ffffff")
    draw_wrapped(
        draw,
        98,
        452,
        "封号、战绩、合集、海符榜、风险库、防广告，一套机器人把售后群、卡密群、游戏社群的重复劳动收进秩序里。",
        font(35, True),
        "#c8d7e8",
        660,
        12,
    )

    x = 98
    for i, text in enumerate(["查封号", "查战绩", "查合集", "海符榜"]):
        x = pill(draw, (x, 640), text, "#3de6ff" if i < 2 else "#7cf6c8")
    x = 98
    for text in ["骗子/同行库", "防广告", "托管配置"]:
        x = pill(draw, (x, 718), text, "#f7c25d")

    draw.line((98, 868, 672, 868), fill=(64, 224, 255, 128), width=2)
    modules = [
        ("01", "英雄联盟查询", "战绩、隐藏战绩、英雄合集、海符榜图片返回"),
        ("02", "风险识别", "骗子/同行记录查询与举报，减少交易纠纷"),
        ("03", "群秩序", "关键词、链接、二维码、刷屏与高频消息处理"),
        ("04", "托管运营", "按群策略配置，长期维护，减少人工盯群"),
    ]
    y = 912
    for no, title, desc in modules:
        draw.text((100, y), no, font=font(25, True), fill="#40d7ff")
        draw.text((172, y - 8), title, font=font(35, True), fill="#ffffff")
        draw.text((172, y + 43), desc, font=font(25, False), fill="#aebed1")
        y += 112

    # Product command strip.
    strip = Image.new("RGBA", (1260, 260), (5, 16, 31, 210))
    sd = ImageDraw.Draw(strip)
    sd.rounded_rectangle((0, 0, 1260, 260), radius=40, fill=(5, 16, 31, 224), outline=(63, 225, 255, 125), width=2)
    sd.text((42, 34), "群内直接发送", font=font(31, True), fill="#7cf6c8")
    commands = [
        ("查封号 123456789", "封号状态与风险提示"),
        ("查战绩 昵称#标签", "常规与隐藏战绩"),
        ("查合集 亚索", "合集选率/胜率图"),
        ("海符榜 亚索", "符文、出装、技能图"),
    ]
    cx, cy = 42, 94
    for command, note in commands:
        sd.rounded_rectangle((cx, cy, cx + 560, cy + 62), radius=18, fill=(255, 255, 255, 18), outline=(255, 255, 255, 38), width=1)
        sd.text((cx + 24, cy + 14), command, font=font(24, True), fill="#ffffff")
        sd.text((cx + 306, cy + 18), note, font=font(19, False), fill="#aebed1")
        cx += 610
        if cx > 900:
            cx = 42
            cy += 82
    image.alpha_composite(strip, (90, 1386))

    draw.text((98, 1710), "适合卡密发卡群、售后群、游戏社群长期使用", font=font(44, True), fill="#ffffff")
    draw.text((98, 1776), "GroupGuardKing 群管王 · 支持定制群策略", font=font(30, True), fill="#9fefff")
    draw.rounded_rectangle((1018, 1698, 1346, 1810), radius=34, fill=(255, 255, 255, 238))
    draw.text((1094, 1722), "联系客服", font=font(43, True), fill="#07111f")
    draw.text((1080, 1774), "开通 / 托管 / 调整", font=font(23, True), fill="#52627a")

    final = image.convert("RGB")
    final.save(OUT, "PNG", optimize=True)
    final.save(OUT_VERSIONED, "PNG", optimize=True)
    final.save(OUT_V3, "PNG", optimize=True)
    print(f"generated {OUT} {OUT.stat().st_size}")
    print(f"generated {OUT_VERSIONED} {OUT_VERSIONED.stat().st_size}")
    print(f"generated {OUT_V3} {OUT_V3.stat().st_size}")


if __name__ == "__main__":
    main()
