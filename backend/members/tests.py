from io import BytesIO
import json

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from clubs.models import Club

from .models import Member


class MemberApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="clubadmin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.member_user = User.objects.create_user(
            username="member",
            password="pass12345",
            role=User.Roles.MEMBER,
        )

        self.club = Club.objects.create(
            name="Central Club",
            city="Luxembourg",
            address="10 Center Rd",
            created_by=self.ltf_admin,
        )
        self.club.admins.add(self.club_admin)

        self.member = Member.objects.create(
            user=self.member_user,
            club=self.club,
            first_name="Mia",
            last_name="Lee",
        )

    def test_member_sees_own_profile(self):
        self.client.force_authenticate(user=self.member_user)
        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_club_admin_sees_club_members(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)


class MemberImportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="clubadmin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(
            name="North Club",
            city="Luxembourg",
            address="12 North Rd",
            created_by=self.ltf_admin,
        )
        self.club.admins.add(self.club_admin)

    def test_preview_requires_club_id(self):
        self.client.force_authenticate(user=self.club_admin)
        csv_data = "first_name,last_name\nAna,Ng\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members.csv"
        response = self.client.post(
            "/api/imports/members/preview/",
            {"file": file_obj},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_preview_club_admin_restricted(self):
        self.client.force_authenticate(user=self.club_admin)
        csv_data = "first_name,last_name\nAna,Ng\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members.csv"
        response = self.client.post(
            "/api/imports/members/preview/",
            {"file": file_obj, "club_id": self.club.id},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("headers", response.data)

    def test_confirm_creates_members(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,date_of_birth\nAna,Ng,2000-01-01\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "date_of_birth": "date_of_birth",
        }
        response = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Member.objects.count(), 1)
