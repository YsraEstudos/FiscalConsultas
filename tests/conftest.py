"""Keep root-level pytest fixtures intentionally lightweight.

Integration and performance fixtures live in their respective subdirectories so
unit tests stay isolated and do not mutate shared application settings.
"""
