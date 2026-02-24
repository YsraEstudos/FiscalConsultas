import pytest


@pytest.fixture
def should_not_decode_factory():
    def _factory(
        message: str = "jwt.decode should not run when JWKS is unavailable",
    ):
        called = {"value": False}

        def _guard(*_args, **_kwargs):
            called["value"] = True
            raise AssertionError(message)

        return _guard, called

    return _factory
