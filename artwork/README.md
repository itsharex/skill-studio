# Skill Studio icon

- `SkillStudio.icon`: editable Apple Icon Composer document, with separate monitor and pixel-robot layers.
- `Assets/machine.png`: extracted from the user-provided `machine.icns` (1024 px representation).
- Robot pixels are drawn by `scripts/generate-icon.py` using Pillow. No image generation service is used.
- The script uses the installed Icon Composer `ictool` to render the document, then generates all desktop Tauri icons from that rendering. The in-app asset uses the same rendering without the macOS outer margin.

Regenerate on macOS with Xcode/Icon Composer, Python + Pillow, and pnpm installed:

```sh
python3 scripts/generate-icon.py
```

Open `artwork/SkillStudio.icon` in Icon Composer to edit layers. Regeneration recreates the document from the script, so persist geometry/style changes in the script too.

The app header, Hub empty state, settings About/Hub storage entries, Hub Skill Studio source badges/actions and favicon share this artwork. Hub navigation uses a three-layer stacked-square symbol. Generic group and Agent icons keep their own semantic symbols.

Reference: [Apple: Creating your app icon using Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer).
