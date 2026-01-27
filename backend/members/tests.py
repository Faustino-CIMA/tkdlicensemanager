from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from clubs.models import Club

from .models import Member


class MemberApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.nma_admin = User.objects.create_user(
            username="nmaadmin",
            password="pass12345",
            role=User.Roles.NMA_ADMIN,
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
            created_by=self.nma_admin,
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
from django.test import TestCase

# Create your tests here.
