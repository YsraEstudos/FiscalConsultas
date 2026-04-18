# AGENTS.md for this repository

Before sending code, check whether the full Windows file path is too long. Prefer shorter paths, and if you get a "filename too long" error, split the change into smaller parts or use a relative path.

GitHub commands that depend on the keyring need to run outside the agent sandbox. Inside the sandbox, `gh` and Git Credential Manager may still appear to be broken even when they are working normally in the terminal.
