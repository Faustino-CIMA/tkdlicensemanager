from django.conf import settings
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class OptionalPageNumberPagination(PageNumberPagination):
    page_size = getattr(settings, "API_PAGINATION_DEFAULT_PAGE_SIZE", 50)
    page_size_query_param = "page_size"
    max_page_size = getattr(settings, "API_PAGINATION_MAX_PAGE_SIZE", 200)


class OptionalPaginationListMixin:
    pagination_class = OptionalPageNumberPagination

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        if "page" in request.query_params:
            page = self.paginate_queryset(queryset)
            if page is not None:
                serializer = self.get_serializer(page, many=True)
                return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
