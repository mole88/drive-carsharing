"""Линтер смешанного письма: чужая буква внутри кириллического слова.

Такие опечатки (`касcы`, `fortся`, `обновиł`, иероглиф посреди русского абзаца) не
видны глазом, не ловятся ни prettier, ни pytest, а живут в интерфейсе и
документации. Обычный греп `[а-я][a-zA-Z]{2,}` такое пропускает: нужна одна буква,
и не обязательно латинская.

Граница слова здесь — любой не-буквенный символ, включая дефис: «PNG-исходники»
и «WebAudio-синтез» — нормальная типографика, а `касcы` — опечатка. Код в
backticks и блоки ``` не читаем: там латиница уместна.

    .venv\\Scripts\\python.exe -m scripts.checktext          # проверить всё
    .venv\\Scripts\\python.exe -m scripts.checktext files... # проверить список
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    "README.md",
    "app/static",
    "app/templates",
    "docs",
    "scripts",
    "tests/ui",
    "tests",
)
SUFFIXES = {".md", ".py", ".js", ".cjs", ".html", ".css"}
# одно слово может прятать `обновиł`: ищем любые буквы, а не только латиницу
WORDS = re.compile(r"[^\W\d_]+", re.UNICODE)
# \n перед кириллицей в строках Питона — не опечатка
ESCAPES = re.compile(r"\\[nrtfv0]")
INLINE_CODE = re.compile(r"`[^`]*`")
FENCE = re.compile(r"^\s*(```|~~~)")
CJK = re.compile(
    r"[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uff00-\uffef]"
)
CYRILLIC = set("абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ")


def candidates(files: list[str]) -> list[Path]:
    if files:
        return [Path(f) if Path(f).is_absolute() else ROOT / f for f in files]
    found: list[Path] = []
    for entry in TARGETS:
        path = ROOT / entry
        if path.is_file():
            found.append(path)
            continue
        found.extend(p for p in sorted(path.rglob("*")) if p.suffix in SUFFIXES)
    keep = []
    for path in found:
        if not path.is_file() or "core-carry" in path.name:
            continue
        keep.append(path)
    return keep


def check(path: Path) -> list[str]:
    problems: list[str] = []
    inside_fence = False
    text = path.read_text(encoding="utf-8", errors="replace")
    for number, raw in enumerate(text.splitlines(), 1):
        if FENCE.match(raw):
            inside_fence = not inside_fence
            continue
        if inside_fence:
            continue
        line = INLINE_CODE.sub("", raw)
        line = ESCAPES.sub(" ", line)
        if CJK.search(line):
            problems.append(
                f"{path}:{number}: иероглифы в русском тексте: {line.strip()[:60]}"
            )
        for word in WORDS.findall(line):
            cyr = sum(c in CYRILLIC for c in word)
            if not cyr:
                continue
            alien = len(word) - cyr
            if alien:
                problems.append(f"{path}:{number}: смешалось письмо: {word!r}")
    return problems


def main(argv: list[str]) -> int:
    paths = candidates(argv[1:])
    problems: list[str] = []
    for path in paths:
        problems.extend(check(path))
    print(f"файлов проверено: {len(paths)}")
    for line in problems[:40]:
        print(line)
    if len(problems) > 40:
        print(f"… и ещё {len(problems) - 40}")
    print("итого замечаний:", len(problems))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
