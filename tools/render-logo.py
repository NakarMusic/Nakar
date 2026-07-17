from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def profile_master(size=1024):
    image = Image.new("RGB", (size, size), "#161826")
    draw = ImageDraw.Draw(image)

    # Site yüzey renklerini taşıyan yumuşak, çapraz arka plan geçişi.
    bg = Image.new("RGB", (size, size))
    px = bg.load()
    start, end = (36, 39, 56), (22, 24, 38)
    for y in range(size):
        for x in range(size):
            t = min(1, max(0, (x + y - 304) / 1440))
            px[x, y] = lerp(start, end, t)

    circle_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(circle_mask).ellipse((108, 108, 916, 916), fill=255)
    image.paste(bg, (0, 0), circle_mask)
    draw.ellipse((108, 108, 916, 916), outline="#3A3D59", width=14)
    draw.ellipse((178, 178, 846, 846), outline="#302D49", width=2)

    note_mask = Image.new("L", (size, size), 0)
    note = ImageDraw.Draw(note_mask)
    note.rounded_rectangle((488, 300, 550, 682), radius=31, fill=255)
    note.polygon([(519, 300), (742, 359), (742, 466), (519, 407)], fill=255)

    head = Image.new("L", (280, 210), 0)
    ImageDraw.Draw(head).ellipse((19, 23, 261, 187), fill=255)
    head = head.rotate(13, resample=Image.Resampling.BICUBIC, expand=False)
    note_mask.paste(ImageChops.lighter(note_mask.crop((274, 577, 554, 787)), head), (274, 577))

    glow = Image.new("RGBA", (size, size), (145, 132, 217, 0))
    glow.putalpha(note_mask.filter(ImageFilter.GaussianBlur(22)).point(lambda p: round(p * .34)))
    image = Image.alpha_composite(image.convert("RGBA"), glow)

    accent = Image.new("RGBA", (size, size))
    apx = accent.load()
    top, bottom = (196, 190, 244, 255), (129, 115, 207, 255)
    for y in range(size):
        t = min(1, max(0, (y - 260) / 520))
        color = lerp(top, bottom, t)
        for x in range(size):
            apx[x, y] = color
    accent.putalpha(note_mask)
    image = Image.alpha_composite(image, accent)

    draw = ImageDraw.Draw(image)
    draw.ellipse((336, 758, 352, 774), fill=(196, 190, 244, 117))
    draw.ellipse((376, 782, 388, 794), fill=(196, 190, 244, 82))
    draw.ellipse((418, 797, 426, 805), fill=(196, 190, 244, 51))
    return image.convert("RGB")


def favicon_master(size=1024):
    image = Image.new("RGB", (size, size), "#161826")
    mask = Image.new("L", (size, size), 0)
    note = ImageDraw.Draw(mask)
    note.rounded_rectangle((488, 230, 552, 672), radius=32, fill=255)
    note.polygon([(520, 230), (770, 294), (770, 422), (520, 358)], fill=255)
    head = Image.new("L", (360, 260), 0)
    ImageDraw.Draw(head).ellipse((23, 30, 337, 230), fill=255)
    head = head.rotate(13, resample=Image.Resampling.BICUBIC, expand=False)
    mask.paste(ImageChops.lighter(mask.crop((220, 580, 580, 840)), head), (220, 580))
    fill = Image.new("RGB", (size, size), "#9184D9")
    image.paste(fill, (0, 0), mask)
    return image


def save_outputs():
    profile = profile_master()
    profile.save(ASSETS / "nakar-profile-1024.png", optimize=True)
    profile.resize((400, 400), Image.Resampling.LANCZOS).save(
        ASSETS / "nakar-profile-400.png", optimize=True
    )

    favicon = favicon_master()
    favicon.resize((180, 180), Image.Resampling.LANCZOS).save(
        ASSETS / "apple-touch-icon.png", optimize=True
    )
    favicon.resize((64, 64), Image.Resampling.LANCZOS).save(
        ASSETS / "favicon-64.png", optimize=True
    )


if __name__ == "__main__":
    save_outputs()
