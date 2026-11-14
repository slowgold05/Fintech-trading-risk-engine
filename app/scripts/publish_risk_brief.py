"""Archive a risk brief from a local JSON figures file.

The file is the only input. This command does not open a database, call a data
vendor, call a language model, or send email, Slack, or Discord.
"""

import json
import sys
from pathlib import Path

from app.services.risk_brief import archive_brief, render_brief


def write_from_file(figures_path: Path, output_path: Path) -> Path:
    figures = json.loads(figures_path.read_text(encoding="utf-8"))
    if not isinstance(figures, dict):
        raise ValueError("Brief figures must be an object")
    return archive_brief(render_brief(figures), figures, output_path)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m app.scripts.publish_risk_brief FIGURES.json OUTPUT.md")
    path = write_from_file(Path(sys.argv[1]), Path(sys.argv[2]))
    print(path)


if __name__ == "__main__":
    main()
