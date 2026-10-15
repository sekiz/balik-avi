# Derive clean HUD images from the Genex originals: hard alpha (drops coloured fringe), crop, resize.
from PIL import Image, ImageFilter
import sys
def clean(src, dst, width, thr):
    im = Image.open(src).convert("RGBA")
    a = im.getchannel("A").point(lambda v: 255 if v >= thr else 0)
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(a)
    im = im.crop(a.getbbox())
    h = round(im.height * width / im.width)
    im.resize((width, h), Image.LANCZOS).save(dst, optimize=True)
    print(dst, width, h)
clean("assets/genex/88ecf720-d729-4249-9705-f74f7eeadcc5/shiny-gold-coin-icon-for-a-mobile-game-o-cmv9ff24.png", "assets/ui/coin.png", 192, 200)
clean("assets/genex/4de3559e-879c-41c1-857a-db80db95bb23/mobile-game-title-logo-reading-balik-avi-cmv9ff31.png", "assets/ui/logo.png", 900, 200)
