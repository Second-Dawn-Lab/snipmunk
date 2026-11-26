"""Writes docs/media/ from the raw pictures of scripts/make-docs-media.mjs.

    python -B scripts/docs-media/images.py <work folder> [name ...]

PNG pictures are stored without loss (a palette when a picture has at most 256 colours) and are never wider than asked.
GIF frames are put on one canvas size, equal neighbours are joined, and one palette is used for the whole film.
A contact sheet of every film is written next to the raw pictures, to look through all frames at once.
Needs Pillow (pip install pillow).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

MEDIA = Path(__file__).resolve().parents[2] / "docs" / "media"
BACKDROP = (31, 36, 51)


def same(a, b):
    return a.size == b.size and ImageChops.difference(a, b).getbbox() is None


def write_png(name, entry):
    picture = Image.open(entry["src"]).convert("RGBA")
    if picture.getchannel("A").getextrema() == (255, 255):
        picture = picture.convert("RGB")
    limit = entry.get("maxWidth", 1400)
    if picture.width > limit:
        height = round(picture.height * limit / picture.width)
        picture = picture.resize((limit, height), Image.LANCZOS)
    if picture.mode == "RGB":
        colours = picture.getcolors(256)
        if colours:
            indexed = picture.convert("P", palette=Image.ADAPTIVE, colors=len(colours))
            if same(indexed.convert("RGB"), picture):
                picture = indexed
    target = MEDIA / f"{name}.png"
    picture.save(target, optimize=True, compress_level=9)
    return target, picture.size


def on_canvas(item, size):
    if "layers" in item:
        canvas = Image.new("RGB", size, BACKDROP)
        for layer in item["layers"]:
            piece = Image.open(layer["src"]).convert("RGBA")
            canvas.paste(piece, (layer["x"], layer["y"]), piece)
        return canvas
    frame = Image.open(item["src"]).convert("RGB")
    if frame.width > size[0] or frame.height > size[1]:
        factor = min(size[0] / frame.width, size[1] / frame.height)
        frame = frame.resize((round(frame.width * factor), round(frame.height * factor)), Image.LANCZOS)
    if frame.size == size:
        return frame
    canvas = Image.new("RGB", size, BACKDROP)
    canvas.paste(frame, ((size[0] - frame.width) // 2, (size[1] - frame.height) // 2))
    return canvas


def contact_sheet(frames, times, target):
    columns, small = 6, (320, round(320 * frames[0].height / frames[0].width))
    rows = (len(frames) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * (small[0] + 6), rows * (small[1] + 20)), (255, 0, 255))
    pen = ImageDraw.Draw(sheet)
    for i, frame in enumerate(frames):
        x, y = (i % columns) * (small[0] + 6), (i // columns) * (small[1] + 20)
        sheet.paste(frame.resize(small, Image.LANCZOS), (x, y))
        pen.text((x + 4, y + small[1] + 4), f"{i}  {times[i]} ms", fill=(0, 0, 0))
    sheet.save(target)


def write_gif(name, entry, work):
    size = (entry["width"], entry["height"])
    frames, times = [], []
    for item in entry["frames"]:
        frame = on_canvas(item, size)
        if frames and same(frames[-1], frame):
            times[-1] += item["ms"]
        else:
            frames.append(frame)
            times.append(item["ms"])
    contact_sheet(frames, times, Path(work) / f"sheet-{name}.png")
    # One palette from frames spread over the whole film.
    picks = frames[:: max(1, len(frames) // 12)] + [frames[-1]]
    board = Image.new("RGB", (size[0], size[1] * len(picks)))
    for i, frame in enumerate(picks):
        board.paste(frame, (0, i * size[1]))
    palette = board.quantize(colors=255, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    indexed = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    target = MEDIA / f"{name}.gif"
    indexed[0].save(target, save_all=True, append_images=indexed[1:], duration=times, loop=0, optimize=True, disposal=1)
    return target, size, len(frames), sum(times) / 1000


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    work, only = Path(sys.argv[1]), set(sys.argv[2:])
    manifest = json.loads((work / "manifest.json").read_text(encoding="utf-8"))
    MEDIA.mkdir(parents=True, exist_ok=True)
    for name, entry in manifest["png"].items():
        if not only or name in only:
            target, size = write_png(name, entry)
            print(f"{target.name:34} {size[0]} x {size[1]:5}  {target.stat().st_size / 1024:8.0f} KB")
    for name, entry in manifest["gif"].items():
        if entry["frames"] and (not only or name in only):
            target, size, count, seconds = write_gif(name, entry, work)
            print(f"{target.name:34} {size[0]} x {size[1]:5}  {target.stat().st_size / 1024:8.0f} KB  {count} frames, {seconds:.1f} s")


if __name__ == "__main__":
    main()
