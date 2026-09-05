from rest_framework.authentication import TokenAuthentication

from .request_utils import touch_token_meta


class TokenAuthenticationWithMeta(TokenAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        _user, token = result
        touch_token_meta(token, request)
        return result
