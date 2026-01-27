from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User

from .models import Club


class ClubApiTests(TestCase):
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

        self.club = Club.objects.create(
            name="Main Club",
            city="Luxembourg",
            address="1 Main St",
            created_by=self.nma_admin,
        )
        self.club.admins.add(self.club_admin)

    def test_nma_admin_sees_all_clubs(self):
        self.client.force_authenticate(user=self.nma_admin)
        response = self.client.get("/api/clubs/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_club_admin_sees_own_club(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/clubs/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
from django.test import TestCase

# Create your tests here.
