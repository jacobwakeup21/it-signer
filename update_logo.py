import base64
import io
import os
from PIL import Image, ImageDraw, ImageFont
import pymupdf

img_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "img")

# 1. Prepare clean cutout emblem
emblem = Image.open(os.path.join(img_dir, "test-cutout2.png"))
bbox = emblem.split()[-1].getbbox()
emblem_cropped = emblem.crop(bbox)
emblem_cropped.save(os.path.join(img_dir, "emblem-isolated.png"))

# Save isolated emblem as clean mark
emblem_cropped.save(os.path.join(img_dir, "emblem-clean.png"))

# 2. Build high-resolution transparent logo image (Retina crisp)
# Proportions: Height 200, Width ~1180
target_h = 190
ew, eh = emblem_cropped.size
target_w = int(target_h * (ew / eh))
emblem_resized = emblem_cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)

# Create canvas
canvas_h = 200
canvas_w = target_w + 920
logo_img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

# Paste emblem cleanly on left
logo_img.paste(emblem_resized, (0, (canvas_h - target_h) // 2), emblem_resized)

# Draw typography with Pillow FreeType for razor-sharp rendering
draw = ImageDraw.Draw(logo_img)
font_title = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 90)
font_sub = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 38)

text_x = target_w + 30
title_y = 20
sub_y = 124

# Title: "IT SIGNER" in crisp bright white with slight ice-cyan gradient
draw.text((text_x, title_y), "IT SIGNER", fill="#FFFFFF", font=font_title)

# Underline smaller text: "Mobile & Desktop Digital Signature Hub"
# Significantly larger (38px), bold, in vibrant emerald-cyan tech green (#34d399)
draw.text((text_x + 2, sub_y), "Mobile & Desktop Digital Signature Hub", fill="#34d399", font=font_sub)

# Save final logo-wide.png and logo-transparent.png
final_wide = os.path.join(img_dir, "logo-wide.png")
logo_img.save(final_wide)
logo_img.save(os.path.join(img_dir, "logo-transparent.png"))
logo_img.save(os.path.join(img_dir, "logo-horizontal.png"))
print(f"Saved finalized {final_wide} ({canvas_w}x{canvas_h})")

# 3. Also export corresponding SVG for vector usage
buf = io.BytesIO()
emblem_cropped.save(buf, format="PNG")
b64_emblem = base64.b64encode(buf.getvalue()).decode("ascii")

svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas_w} {canvas_h}" fill="none" width="{canvas_w}" height="{canvas_h}">
  <defs>
    <linearGradient id="itTitleGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="60%" stop-color="#f0fdfa" />
      <stop offset="100%" stop-color="#e0f2fe" />
    </linearGradient>
  </defs>

  <!-- Clean Floating Emblem (NO black square background) -->
  <g>
    <image href="data:image/png;base64,{b64_emblem}" x="0" y="{(canvas_h - target_h) // 2}" width="{target_w}" height="{target_h}" preserveAspectRatio="xMidYMid meet" />
  </g>

  <!-- IT SIGNER Bold Title (Prominent, High-Impact) -->
  <text x="{text_x}" y="95" 
        font-family="Segoe UI, -apple-system, sans-serif" 
        font-size="90" 
        font-weight="900" 
        letter-spacing="1" 
        fill="#ffffff">
    IT SIGNER
  </text>

  <!-- Underline Smaller Green Text (Significantly Enlarged, Vibrant Green #34d399) -->
  <text x="{text_x + 2}" y="156" 
        font-family="Segoe UI, -apple-system, sans-serif" 
        font-size="38" 
        font-weight="700" 
        letter-spacing="0.3" 
        fill="#34d399">
    Mobile &amp; Desktop Digital Signature Hub
  </text>
</svg>'''

svg_file = os.path.join(img_dir, "logo-brand.svg")
with open(svg_file, "w", encoding="utf-8") as f:
    f.write(svg_content)
print(f"Saved {svg_file}")

# 4. Generate navbar preview
bg = Image.new("RGBA", (canvas_w + 80, canvas_h + 60), (11, 19, 41, 255))
bg.paste(logo_img, (40, 30), logo_img)
preview_file = os.path.join(img_dir, "navbar-preview.png")
bg.save(preview_file)
print(f"Saved preview {preview_file}")
