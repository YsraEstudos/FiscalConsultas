import argparse
import glob
import os
import re
from dataclasses import dataclass


SIZE_WARNING = 120000


@dataclass(frozen=True)
class Profile:
    output_file: str
    static_files: list[str]
    plan_doc: str | None = None


PROFILES: dict[str, Profile] = {
    # Legacy profile (plano de parsing)
    "parsing": Profile(
        output_file=os.path.join("Scripts results", "parsing_migration_dump.txt"),
        static_files=[
            "scripts/setup_database.py",
            "scripts/rebuild_index.py",
            "scripts/ingest_markdown.py",
            "backend/services/nesh_service.py",
            "backend/services/tipi_service.py",
            "backend/presentation/renderer.py",
            "backend/utils/ncm_utils.py",
        ],
        plan_doc=os.path.join(
            "docs", "roadmap", "NOVA_MIGRACAO_JUNTO_COM_OQ_SERA_MIGRADO.md"
        ),
    ),
    # Novo profile (ultimo plano criado: Pydantic em dominio)
    "pydantic": Profile(
        output_file=os.path.join("Scripts results", "domain_models_pydantic_dump.txt"),
        static_files=[
            "backend/domain/models.py",
            "backend/domain/__init__.py",
            "backend/__init__.py",
            "backend/domain/sqlmodels.py",
            "backend/utils/id_utils.py",
            "backend/services/nesh_service.py",
            "backend/services/tipi_service.py",
            "backend/presentation/renderer.py",
            "backend/presentation/routes/search.py",
            "backend/infrastructure/repositories/chapter_repository.py",
            "backend/infrastructure/repositories/position_repository.py",
            "backend/infrastructure/repositories/tipi_repository.py",
            "client/src/types/api.types.ts",
            "client/package.json",
            "pyproject.toml",
        ],
        plan_doc=os.path.join(
            "docs", "roadmap", "MODELOS_DOMINIO_RICOS_PYDANTIC_DETALHADO.md"
        ),
    ),
    # Architecture Overview: Navigation & Scroll Sync
    "navigation": Profile(
        output_file=os.path.join("Scripts results", "navigation_architecture_dump.txt"),
        static_files=[
            "client/src/App.tsx",
            "client/src/hooks/useSearch.ts",
            "client/src/components/ResultDisplay.tsx",
            "client/src/hooks/useRobustScroll.ts",
            "client/src/components/Sidebar.tsx",
            "backend/utils/id_utils.py",
            "backend/services/nesh_service.py",
            "backend/presentation/renderer.py",
            "backend/presentation/tipi_renderer.py",
            "client/src/utils/id_utils.ts",
            "client/src/utils/chapterDetection.ts",
            "client/src/styles/features/nesh.css",
            "client/src/styles/features/tipi.css",
            "client/src/components/ResultDisplay.module.css",
        ],
        plan_doc=None,
    ),
}


def _extract_paths_from_plan(plan_abs_path: str, project_root: str) -> list[str]:
    """
    Extrai caminhos em backticks do plano e retorna paths relativos existentes.
    Suporta curinga (ex: backend/infrastructure/repositories/*.py).
    """
    if not os.path.exists(plan_abs_path):
        return []

    with open(plan_abs_path, "r", encoding="utf-8") as infile:
        text = infile.read()

    # Captura textos em backticks que parecem caminhos de arquivo.
    raw_candidates = re.findall(r"`([^`\n]+)`", text)
    allowed_prefixes = (
        "backend/",
        "client/",
        "scripts/",
        "tests/",
        "docs/",
        "pyproject.toml",
    )
    allowed_ext = (".py", ".ts", ".tsx", ".json", ".toml", ".md", ".d.ts")

    found: list[str] = []
    for candidate in raw_candidates:
        c = candidate.strip()
        if not c:
            continue
        if not (c.startswith(allowed_prefixes) or c in ("pyproject.toml",)):
            continue
        if "*" in c:
            # Expande glob e inclui apenas arquivos.
            abs_pattern = os.path.join(project_root, c.replace("/", os.sep))
            for match in sorted(glob.glob(abs_pattern)):
                if os.path.isfile(match):
                    found.append(
                        os.path.relpath(match, project_root).replace("\\", "/")
                    )
            continue
        if not c.endswith(allowed_ext):
            continue
        abs_path = os.path.join(project_root, c.replace("/", os.sep))
        if os.path.exists(abs_path):
            found.append(c)

    # Remove duplicados preservando ordem.
    dedup: list[str] = []
    seen: set[str] = set()
    for path in found:
        if path in seen:
            continue
        seen.add(path)
        dedup.append(path)
    return dedup


def _resolve_files(
    profile: Profile, project_root: str, override_plan: str | None
) -> tuple[list[str], str | None]:
    plan_rel = override_plan if override_plan else profile.plan_doc
    plan_abs = os.path.join(project_root, plan_rel) if plan_rel else None

    dynamic_paths = _extract_paths_from_plan(plan_abs, project_root) if plan_abs else []
    merged = profile.static_files + [
        p for p in dynamic_paths if p not in profile.static_files
    ]
    return merged, plan_rel


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Consolida arquivos-alvo de um plano em um dump de texto."
    )
    parser.add_argument(
        "--profile",
        choices=sorted(PROFILES.keys()),
        default="pydantic",
        help="Perfil de extração. Default: pydantic (ultimo plano).",
    )
    parser.add_argument(
        "--plan",
        default=None,
        help="Caminho relativo de um plano .md para extrair paths em backticks (opcional).",
    )
    args = parser.parse_args()

    profile = PROFILES[args.profile]
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    files_to_include, plan_used = _resolve_files(profile, project_root, args.plan)
    output_path = os.path.join(project_root, profile.output_file)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"Project Root: {project_root}")
    print(f"Profile: {args.profile}")
    print(f"Plan: {plan_used or '(none)'}")
    print(f"Writing to: {output_path}")
    print(f"Total files selected: {len(files_to_include)}")
    print("-" * 50)

    content_blocks: list[str] = []
    total_length = 0

    # Header/manifest
    manifest = [
        f"{'=' * 50}",
        "CONSOLIDATED FILE MANIFEST",
        f"{'=' * 50}",
        f"PROFILE: {args.profile}",
        f"PLAN: {plan_used or '(none)'}",
        "",
    ]
    manifest.extend([f"- {p}" for p in files_to_include])
    manifest_text = "\n".join(manifest) + "\n\n"
    content_blocks.append(manifest_text)
    total_length += len(manifest_text)

    for rel_path in files_to_include:
        abs_path = os.path.join(project_root, rel_path.replace("/", os.sep))
        print(f"Processing: {rel_path}...", end=" ")

        if not os.path.exists(abs_path):
            print("NOT FOUND")
            block = f"FILE: {rel_path} (NOT FOUND)\n\n"
            content_blocks.append(block)
            total_length += len(block)
            continue

        try:
            with open(abs_path, "r", encoding="utf-8") as infile:
                content = infile.read()
            block = f"{'=' * 50}\nFILE: {rel_path}\n{'=' * 50}\n{content}\n\n"
            content_blocks.append(block)
            total_length += len(block)
            print("OK")
        except Exception as exc:
            print(f"ERROR: {exc}")
            block = f"FILE: {rel_path} (Reading Error: {exc})\n\n"
            content_blocks.append(block)
            total_length += len(block)

    if total_length > SIZE_WARNING:
        print(
            f"\nWARNING: Total size ({total_length} chars) exceeds {SIZE_WARNING} limit."
        )

    with open(output_path, "w", encoding="utf-8") as outfile:
        if total_length > SIZE_WARNING:
            outfile.write(
                f"WARNING: TOTAL CONTENT LENGTH ({total_length}) EXCEEDS {SIZE_WARNING} CHARACTERS.\n"
            )
            outfile.write(f"{'=' * 50}\n\n")
        for block in content_blocks:
            outfile.write(block)

    print("-" * 50)
    print(f"Done! Consolidated {len(files_to_include)} files to {profile.output_file}")


if __name__ == "__main__":
    main()
