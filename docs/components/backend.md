# Backend Component

## Overview

The **Backend** is the core of the LTF Taekwondo License Manager. It acts as the "brain" of the entire system — handling all business logic, data processing, security, and communication between the user interface and the database.

- **Location**: `/backend/`
- **Technology**: Django 6.0.3 + Django REST Framework (DRF)
- **Runs in**: Docker container (based on `python:3.13-slim-bookworm`)

---

## What Does the Backend Do?

The Backend is responsible for almost everything that happens "behind the scenes". Its main responsibilities include:

### Core Functions

- **Business Logic**: Validates data, enforces rules (e.g. who can print cards, license validity, payment requirements)
- **API Layer**: Provides REST endpoints that the Frontend (and external systems) use to read and write data
- **Authentication & Authorization**: Manages user login, roles (LTF Admin, Club Admin, Coach, Member, etc.), and permissions
- **License Management**: Creates, updates, tracks, and activates licenses
- **Payment Processing**: Handles Stripe and Payconiq integration, creates invoices, processes webhooks
- **PDF Generation**: Creates official license cards with correct layout, offsets, and member data
- **Audit & History**: Keeps immutable records of all changes using `django-simple-history`
- **Background Task Coordination**: Sends heavy jobs to the Worker and schedules recurring tasks via Beat

---

## Key Folders Inside Backend

- `config/` — Main Django settings and project configuration
- `licenses/` — Core models and logic for licenses, print jobs, payments
- `members/` — Member profiles, roles, and history
- `clubs/` — Club management
- `accounts/` — User accounts and permissions
- `scripts/` — Helper scripts used during container startup

---

## How It Interacts With Other Components

- Receives requests from the **Frontend**
- Stores and retrieves data from the **Database** (PostgreSQL)
- Uses **Redis** as a message broker for background tasks
- Sends heavy work (PDF generation, payment reconciliation, emails) to the **Worker**
- Relies on **Beat** to trigger scheduled jobs (e.g. payment reconciliation, license activation)

---

## Why It's Important

Without the Backend, the application would have no logic — it would be just a pretty interface with no ability to save data, process payments, generate cards, or enforce rules.

It is the central hub that ensures everything works correctly, securely, and according to LTF’s requirements.
