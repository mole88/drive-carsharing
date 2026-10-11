"""Copy sounds/*.mp3 into the game's audio folder and print the SAMPLES lines.

Кладёте файл в `sounds/` с именем слота (например `sounds/knock.mp3`), запускаете
`python scripts/sounds.py` — файл попадёт в `app/static/audio/`, а строку для
`SAMPLES` в `app/static/game-audio.js` останется только скопировать.
"""

from pathlib import Path
from shutil import copy2

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "sounds"
TARGET = ROOT / "app" / "static" / "audio"
SLOTS = (
    "knock",
    "vip",
    "cash",
    "power",
    "nitro",
    "siren",
    "encounter",
    "bribe",
    "broke",
    "protocol",
    "damage",
    "graze",
    "ram",
    "droneLock",
    "droneDive",
    "droneKill",
    "droneMiss",
    "spin",
    "cone",
    "phase",
    "shield",
    "start",
    "win",
    "lose",
    "loseWreck",
    "defeat",
    "cheer",
    "babachai",
    "go",
)
EXTENSIONS = {".mp3", ".ogg", ".wav", ".m4a"}


def canonical(name: str) -> str:
    """drone_lock -> droneLock, чтобы можно было называть файлы как угодно."""
    parts = name.split("_")
    return parts[0] + "".join(word.title() for word in parts[1:])


def sync():
    if not INBOX.is_dir():
        print(f"Нет папки {INBOX} — положите туда звуки с именами слотов.")
        return 0
    TARGET.mkdir(parents=True, exist_ok=True)
    lines, unknown = [], []
    for source in sorted(INBOX.iterdir()):
        if not source.is_file() or source.suffix.lower() not in EXTENSIONS:
            continue
        slot = canonical(source.stem)
        copy2(source, TARGET / source.name)
        line = f'    {slot}: "audio/{source.name}",'
        (lines if slot in SLOTS else unknown).append(line)
        print(f"→ {source.name} → app/static/audio/{source.name}")
    if not lines and not unknown:
        print("В sounds/ пока нет аудиофайлов.")
    if lines:
        print("\nДобавьте в SAMPLES (app/static/game-audio.js):")
        print("\n".join(lines))
    if unknown:
        print("\nНеизвестные слоты — переименуйте файл под один из списка или скажите, куда играть:")
        print("\n".join(unknown))
        print("\nДоступные слоты: " + ", ".join(SLOTS))
    return 0


if __name__ == "__main__":
    raise SystemExit(sync())
