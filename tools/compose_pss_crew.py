"""Compose deterministic crew sheets from a visual CSV/JSON description."""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image


@dataclass(frozen=True)
class Part:
    source_id: str
    width: int
    y: int
    x: int | None = None


@dataclass(frozen=True)
class Appearance:
    output_name: str
    canvas_width: int
    canvas_height: int
    frame_count: int
    frame_width: int
    parts: tuple[Part, ...]
    frame_rects: tuple[tuple[int, int, int, int], ...] = ()


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return [r for r in csv.DictReader(f) if any((v or "").strip() and not (v or "").startswith("#") for v in r.values())]


def load_appearances(visual_csv: Path, frames_csv: Path | None = None) -> list[Appearance]:
    if visual_csv.suffix.lower() == ".json":
        data: Any = json.loads(visual_csv.read_text(encoding="utf-8"))
        rows = data.get("appearances", data) if isinstance(data, dict) else data
    else:
        rows = _rows(visual_csv)
    frame_map: dict[str, list[tuple[int,int,int,int]]] = {}
    if frames_csv:
        for r in _rows(frames_csv):
            frame_map.setdefault(r.get("visualId", ""), []).append(tuple(int(r[k]) for k in ("x", "y", "width", "height")))
    result: list[Appearance] = []
    for row in rows:
        def val(*names: str, default: str = "") -> str:
            for n in names:
                if isinstance(row, dict) and str(row.get(n, "")).strip(): return str(row[n]).strip()
            return default
        parts: list[Part] = []
        if isinstance(row.get("parts"), list):
            parts = [Part(str(p.get("sourceId", p.get("source_id"))), int(p["width"]), int(p["y"]), p.get("x")) for p in row["parts"]]
        else:
            for name in ("legs", "body", "head"):
                source = val(f"{name}SourceId", f"{name}_source", f"{name}Source")
                if source:
                    parts.append(Part(source, int(val(f"{name}Width", f"{name}_width", default="0")), int(val(f"{name}Y", f"{name}_y", default="0")), int(val(f"{name}X", f"{name}_x")) if val(f"{name}X", f"{name}_x") else None))
        if not parts:
            raise ValueError(f"{val('visualId', 'visual_id', default='视觉')} 缺少一次性导入的头/身/腿部件来源")
        visual_id = val("outputName", "output_name", "visualId", "visual_id")
        rects = tuple(frame_map.get(visual_id, ()))
        width_text = val("canvasWidth", "canvas_width", "width", "imageWidth")
        height_text = val("canvasHeight", "canvas_height", "height", "imageHeight")
        if not width_text or not height_text:
            raise ValueError(f"{visual_id} 缺少画布宽高，必须由一次性导入数据提供")
        width = int(width_text); height = int(height_text)
        if rects:
            width = max(width, max(x+w for x,y,w,h in rects)); height = max(height, max(y+h for x,y,w,h in rects))
        count_text = val("frameCount", "frame_count")
        if not count_text:
            count_text = str(len(rects))
        count = int(count_text)
        frame_width_text = val("frameWidth", "frame_width")
        if not frame_width_text and not rects:
            raise ValueError(f"{visual_id} 缺少帧宽或显式帧矩形")
        fw = int(frame_width_text or rects[0][2])
        result.append(Appearance(visual_id, width, height, count, fw, tuple(parts), rects))
    return result


def compose(source_root: Path, output_root: Path, appearance: Appearance) -> Path:
    canvas = Image.new("RGBA", (appearance.canvas_width, appearance.canvas_height * 1), (0, 0, 0, 0))
    for frame_index in range(appearance.frame_count):
        for part in appearance.parts:
            sheet = Image.open(source_root / f"{part.source_id}.png").convert("RGBA")
            if sheet.width < part.width * appearance.frame_count: raise ValueError(f"source {part.source_id} 不足 {appearance.frame_count} 个水平帧")
            frame = sheet.crop((frame_index * part.width, 0, (frame_index + 1) * part.width, sheet.height))
            rect = appearance.frame_rects[frame_index] if appearance.frame_rects else (frame_index * appearance.frame_width, 0, appearance.frame_width, appearance.canvas_height)
            x = rect[0] + ((rect[2] - frame.width) // 2 if part.x is None else part.x); y = rect[1] + part.y
            canvas.alpha_composite(frame, (x, y))
    output_root.mkdir(parents=True, exist_ok=True)
    output = output_root / f"{appearance.output_name}.png"; canvas.save(output, optimize=True)
    rects = appearance.frame_rects or tuple((i*appearance.frame_width,0,appearance.frame_width,appearance.canvas_height) for i in range(appearance.frame_count))
    print(f"{output}: frames={appearance.frame_count} rects=" + ",".join(map(str, rects)))
    return output


def main() -> None:
    p = argparse.ArgumentParser(); p.add_argument("--source-root", type=Path, required=True); p.add_argument("--output-root", type=Path, required=True); p.add_argument("--visual-csv", type=Path, required=True); p.add_argument("--frames-csv", type=Path)
    a = p.parse_args()
    for appearance in load_appearances(a.visual_csv, a.frames_csv): compose(a.source_root.resolve(), a.output_root.resolve(), appearance)


if __name__ == "__main__": main()
