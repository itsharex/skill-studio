"""Draw the pixel mascot and assemble the editable Icon Composer document.
Requires Python 3 + Pillow. The monitor is the user's supplied machine.icns artwork.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'artwork/SkillStudio.icon'
assets = DOC / 'Assets'
# Square pixels, dark eyes, side arms and four feet; centered inside the CRT.
pixels = [
    '..##########..',
    '..##########..',
    '##############',
    '###.######.###',
    '###.######.###',
    '##############',
    '..##########..',
    '..#..#..#..#..',
    '..#..#..#..#..',
]
unit = 22
x0, y0 = 512 - len(pixels[0]) * unit // 2, 406 - len(pixels) * unit // 2
robot = Image.new('RGBA', (1024, 1024))
draw = ImageDraw.Draw(robot)
for y, row in enumerate(pixels):
    for x, pixel in enumerate(row):
        if pixel == '#':
            draw.rectangle((x0+x*unit, y0+y*unit, x0+(x+1)*unit-1, y0+(y+1)*unit-1), fill='#D97757')
robot.save(assets / 'robot.png')
document = {
    'fill': {'solid': 'extended-srgb:0.00000,0.00000,0.00000,0.00000'},
    'groups': [{
        'name': 'Skill Studio', 'shadow': {'kind': 'neutral', 'opacity': 0},
        'specular': False, 'translucency': {'enabled': False, 'value': 0},
        'layers': [ {'name': name, 'image-name': image, 'glass': False,
                     'position': {'scale': 1.22, 'translation-in-points': [0, 0]}}
                    for name, image in [('Pixel robot', 'robot.png'), ('Monitor', 'machine.png')]] 
    }],
    'supported-platforms': {'squares': ['macOS']}
}
(DOC / 'icon.json').write_text(json.dumps(document, indent=2) + '\n')

# Render with Apple's own Icon Composer engine, then reuse the result everywhere.
import subprocess
import tempfile
with tempfile.TemporaryDirectory() as tmp:
    rendered = Path(tmp) / 'rendered.png'
    composer = '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool'
    subprocess.run([composer, str(DOC), '--export-image', '--output-file', str(rendered),
                    '--platform', 'macOS', '--rendition', 'Default',
                    '--width', '1024', '--height', '1024', '--scale', '1'], check=True)
    artwork = Image.open(rendered).convert('RGBA')
    artwork.resize((256, 256), Image.Resampling.LANCZOS).save(ROOT / 'src/assets/skill-studio.png')
    # Match the supplied macOS icon's optical size and transparent outer margin.
    canvas = Image.new('RGBA', (1024, 1024))
    canvas.alpha_composite(artwork.resize((824, 824), Image.Resampling.LANCZOS), (100, 100))
    canvas.save(ROOT / 'app-icon.png')
# Tauri also produces mobile assets; this desktop project only retains desktop files.
import shutil
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['pnpm', 'tauri', 'icon', str(ROOT / 'app-icon.png'), '--output', tmp], cwd=ROOT, check=True)
    for file in Path(tmp).iterdir():
        if file.is_file():
            shutil.copy2(file, ROOT / 'src-tauri/icons' / file.name)
