"""Package existing builds without including source configuration or credentials."""

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "release"


def package():
    TARGET.mkdir(exist_ok=True)
    manifest = json.loads((ROOT / "extension/dist/manifest.json").read_text())
    for folder, label in [("dist", "extension"), ("dashboard-dist", "dashboard")]:
        source = ROOT / "extension" / folder
        if not (source / "index.html").is_file():
            raise RuntimeError(f"Build {label} before packaging")
        if ".tsx" in (source / "index.html").read_text(encoding="utf-8"):
            raise RuntimeError("Build still references development source files")
        output = TARGET / f"before-you-agree-{label}-{manifest['version']}.zip"
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            for item in sorted(source.rglob("*")):
                if item.is_file():
                    if item.name.startswith(".env") or item.suffix in {
                        ".map",
                        ".pem",
                        ".key",
                    }:
                        raise RuntimeError(
                            "Unexpected private or development file in build"
                        )
                    archive.write(item, item.relative_to(source))
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        output.with_suffix(".zip.sha256").write_text(f"{digest}  {output.name}\n")
        print(f"Packaged {output.name}")
    output = TARGET / f"before-you-agree-backend-{manifest['version']}.zip"
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        folders = [
            ROOT / "backend/app",
            ROOT / "backend/migrations",
            ROOT / "backend/scripts",
            ROOT / "backend/tests",
            ROOT / "docs",
            ROOT / "infra",
            ROOT / "evaluation",
        ]
        files = [ROOT / ".env.example", ROOT / ".dockerignore", ROOT / "README.md", ROOT / "render.yaml"]
        files += [
            ROOT / "backend" / name
            for name in [
                "requirements.txt",
                "requirements-dev.txt",
                "pyproject.toml",
                "alembic.ini",
            ]
        ]
        for folder in folders:
            files.extend(path for path in folder.rglob("*") if path.is_file())
        for path in sorted(files):
            if (
                "__pycache__" in path.parts
                or path.suffix == ".pyc"
                or path.name.endswith(".env")
                or (path.name.startswith(".env") and path.name != ".env.example")
                or path.suffix in {".pem", ".key", ".p12"}
            ):
                continue
            archive.write(path, path.relative_to(ROOT))
    output.with_suffix(".zip.sha256").write_text(
        f"{hashlib.sha256(output.read_bytes()).hexdigest()}  {output.name}\n"
    )
    print(f"Packaged {output.name}")


if __name__ == "__main__":
    package()
