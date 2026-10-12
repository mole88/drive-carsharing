"""Русский текст в репозитории обязан быть одного письма.

`scripts/checktext.py` поймал три опечатки, которые не видны глазом и не ловятся
ни prettier, ни ruff: латинскую `c` внутри кириллического слова, польскую `ł`
и иероглиф посреди абзаца. Тест нужен, чтобы правило не оставалось доброй
советением: проверка запускается вместе с остальными.
"""

from scripts.checktext import candidates, check


def test_repository_text_does_not_mix_scripts() -> None:
    problems: list[str] = []
    files = candidates([])
    assert len(files) > 40, "список проверяемых файлов усох: " + str(len(files))
    for path in files:
        problems.extend(check(path))
    assert not problems, "смешанное письмо в текстах:\n" + "\n".join(problems[:20])
