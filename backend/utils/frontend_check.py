import logging
import os

logger = logging.getLogger(__name__)


def verify_frontend_build(project_root: str) -> None:
    """
    Verifica se o build do frontend existe e se está atualizado.

    Args:
        project_root: Caminho raiz do projeto
    """
    client_dir = os.path.join(project_root, "client")
    dist_dir = os.path.join(client_dir, "dist")
    index_html = os.path.join(dist_dir, "index.html")

    # 1. Check existence
    if not os.path.exists(dist_dir) or not os.path.exists(index_html):
        logger.error("❌ FRONTEND BUILD NOT FOUND!")
        logger.error(f"Expected at: {dist_dir}")
        logger.error("Please run: cd client && npm run build")
        return

    # 2. Check freshness (simple heuristic)
    try:
        build_time = os.path.getmtime(index_html)

        # Check against package.json (dependencies)
        pkg_json = os.path.join(client_dir, "package.json")
        if os.path.exists(pkg_json):
            if os.path.getmtime(pkg_json) > build_time:
                logger.warning(
                    "⚠️  FRONTEND BUILD MAY BE OUTDATED (package.json is newer)"
                )
                logger.warning("   Please run: cd client && npm run build")
            else:
                logger.info(
                    "✅ Frontend build check: package.json is older than build."
                )

        # Removed detailed source walk to avoid startup delay (used to be os.walk)
        # Assuming if package.json is old, user handles source changes.

    except Exception as e:
        logger.warning(f"Failed to verify frontend build freshness: {e}")
