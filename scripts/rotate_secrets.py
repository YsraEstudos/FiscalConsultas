import secrets
import os
import re


def _get_env_value(content: str, key: str) -> str | None:
    pattern = rf"^{re.escape(key)}=(.*)$"
    match = re.search(pattern, content, flags=re.MULTILINE)
    return match.group(1).strip() if match else None


def _set_env_value(content: str, key: str, value: str) -> str:
    pattern = rf"^{re.escape(key)}=.*$"
    line = f"{key}={value}"
    if re.search(pattern, content, flags=re.MULTILINE):
        return re.sub(pattern, line, content, flags=re.MULTILINE)
    suffix = "\n" if content and not content.endswith("\n") else ""
    return f"{content}{suffix}{line}\n"


def rotate_secrets(env_path=".env"):
    if not os.path.exists(env_path):
        print(f"⚠️ Erro: Arquivo {env_path} não encontrado.")
        return

    with open(env_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Captura valores atuais para permitir coexistencia (novo + antigo)
    previous_values = {
        "AUTH__ADMIN_PASSWORD_PREVIOUS": _get_env_value(
            content, "AUTH__ADMIN_PASSWORD"
        ),
        "AUTH__ADMIN_TOKEN_PREVIOUS": _get_env_value(content, "AUTH__ADMIN_TOKEN"),
    }

    # Gerar novos valores
    new_secrets = {
        "AUTH__ADMIN_PASSWORD": secrets.token_urlsafe(32),
        "AUTH__ADMIN_TOKEN": secrets.token_hex(32),
        "AUTH__SECRET_KEY": secrets.token_hex(64),
    }

    # Salvar valores anteriores (se existirem)
    for key, previous_value in previous_values.items():
        if previous_value:
            content = _set_env_value(content, key, previous_value)
            print(f"✅ {key} atualizado com valor anterior.")
        else:
            print(f"⚠️ Valor anterior de {key.replace('_PREVIOUS', '')} não encontrado.")

    # Substituir no arquivo
    for key, new_value in new_secrets.items():
        content = _set_env_value(content, key, new_value)
        print(f"✅ {key} rotacionado com sucesso.")

    with open(env_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(
        "\n🚀 Rotação concluída! Use o endpoint /api/admin/reload-secrets para hot-reload."
    )


if __name__ == "__main__":
    rotate_secrets()
