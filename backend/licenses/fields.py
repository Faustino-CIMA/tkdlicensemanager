from __future__ import annotations

from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models


def _get_fernets() -> list[Fernet]:
    keys = getattr(settings, "FERNET_KEYS", [])
    return [Fernet(key.encode("utf-8")) for key in keys if key]


class EncryptedCharField(models.CharField):
    def get_prep_value(self, value: Any):
        value = super().get_prep_value(value)
        if value in (None, ""):
            return value
        fernet_list = _get_fernets()
        if not fernet_list:
            return value
        return fernet_list[0].encrypt(str(value).encode("utf-8")).decode("utf-8")

    def from_db_value(self, value, expression, connection):
        if value in (None, ""):
            return value
        return self.to_python(value)

    def to_python(self, value: Any):
        if value in (None, ""):
            return value
        if not isinstance(value, str):
            return value
        fernet_list = _get_fernets()
        for fernet in fernet_list:
            try:
                return fernet.decrypt(value.encode("utf-8")).decode("utf-8")
            except InvalidToken:
                continue
        return value
