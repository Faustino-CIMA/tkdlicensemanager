from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .transfers import (
    TransferError,
    accept_transfer,
    add_transfer_message,
    cancel_transfer,
    create_transfer,
    get_transfer,
    list_transfers,
    reject_transfer,
    search_destination_clubs,
    search_transfer_members,
    serialize_transfer,
)


class MemberTransferViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def _handle(self, error: TransferError):
        return Response(error.payload, status=error.status_code)

    def list(self, request):
        fee_raw = str(request.query_params.get("fee_only", "")).strip().lower()
        fee_only = fee_raw in {"1", "true", "yes"}
        try:
            return Response(list_transfers(user=request.user, fee_only=fee_only))
        except TransferError as error:
            return self._handle(error)

    def retrieve(self, request, pk=None):
        try:
            transfer = get_transfer(user=request.user, transfer_id=int(pk))
        except (TypeError, ValueError):
            return Response({"detail": "Transfer not found."}, status=status.HTTP_404_NOT_FOUND)
        except TransferError as error:
            return self._handle(error)
        return Response(serialize_transfer(transfer))

    def create(self, request):
        try:
            payload = create_transfer(
                user=request.user,
                member_id=request.data.get("member_id"),
                to_club_id=request.data.get("to_club_id"),
                from_club_id=request.data.get("from_club_id"),
                fee_amount=request.data.get("fee_amount"),
                note=request.data.get("note", ""),
                locale=request.data.get("locale"),
            )
        except TransferError as error:
            return self._handle(error)
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def members(self, request):
        try:
            return Response(
                search_transfer_members(
                    user=request.user,
                    club_id=request.query_params.get("club_id"),
                    query=request.query_params.get("q", ""),
                )
            )
        except TransferError as error:
            return self._handle(error)

    @action(detail=False, methods=["get"])
    def clubs(self, request):
        try:
            return Response(
                search_destination_clubs(
                    user=request.user,
                    from_club_id=request.query_params.get("from_club_id")
                    or request.query_params.get("club_id"),
                    query=request.query_params.get("q", ""),
                )
            )
        except TransferError as error:
            return self._handle(error)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        try:
            payload = accept_transfer(
                user=request.user, transfer_id=int(pk), locale=request.data.get("locale")
            )
        except (TypeError, ValueError):
            return Response({"detail": "Transfer not found."}, status=status.HTTP_404_NOT_FOUND)
        except TransferError as error:
            return self._handle(error)
        return Response(payload)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        try:
            payload = reject_transfer(
                user=request.user, transfer_id=int(pk), locale=request.data.get("locale")
            )
        except (TypeError, ValueError):
            return Response({"detail": "Transfer not found."}, status=status.HTTP_404_NOT_FOUND)
        except TransferError as error:
            return self._handle(error)
        return Response(payload)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        try:
            payload = cancel_transfer(
                user=request.user, transfer_id=int(pk), locale=request.data.get("locale")
            )
        except (TypeError, ValueError):
            return Response({"detail": "Transfer not found."}, status=status.HTTP_404_NOT_FOUND)
        except TransferError as error:
            return self._handle(error)
        return Response(payload)

    @action(detail=True, methods=["post"])
    def messages(self, request, pk=None):
        try:
            payload = add_transfer_message(
                user=request.user,
                transfer_id=int(pk),
                body=request.data.get("body", ""),
            )
        except (TypeError, ValueError):
            return Response({"detail": "Transfer not found."}, status=status.HTTP_404_NOT_FOUND)
        except TransferError as error:
            return self._handle(error)
        return Response(payload, status=status.HTTP_201_CREATED)
