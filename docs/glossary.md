# LTF Taekwondo License Manager — Glossary

This glossary explains the main terms and concepts used in the system.

## A

**API**  
Application Programming Interface. The way the Frontend communicates with the Backend. All data requests and actions go through APIs.

## B

**Backend**  
The server-side part of the application. It contains all the business logic, rules, payment processing, PDF generation, and database operations.

**Beat (Celery Beat)**  
The scheduler. It automatically triggers background tasks at specific times (e.g. every minute or every hour).

## C

**Celery**  
The background task system. It allows the application to perform heavy or time-consuming work without slowing down the user interface.

**Club Admin**  
A user role. Club administrators can manage their own club’s members, approve licenses, and print cards.

## D

**Database (PostgreSQL)**  
The permanent storage where all important data is kept: members, licenses, payments, print history, etc.

## F

**Frontend**  
The part of the application that users see and interact with in their web browser (dashboards, forms, card designer, etc.).

## L

**License**  
The official document proving that a person is a registered member of a Taekwondo club under the LTF. It can be digital or printed as a physical card.

**LTF Admin**  
The highest role. Luxembourg Taekwondo Federation administrators have full access to the entire system.

## P

**Payconiq**  
A Luxembourg payment method integrated into the system alongside Stripe.

**Printer Profile**  
User or club-specific settings that define how license cards are positioned when printed (offsets). This ensures cards print correctly on different printers.

**PrintJob**  
A record in the system that represents one or more license cards being generated and printed.

## R

**Redis**  
A fast in-memory database used for queuing background tasks and caching.

## S

**Stripe**  
The primary international payment processor used by the system.

## W

**Worker (Celery Worker)**  
The service that performs heavy background tasks such as generating PDFs, processing payments, and sending emails.

---

### Common Acronyms

- **LTF** — Luxembourg Taekwondo Federation
- **DRF** — Django REST Framework
- **PDF** — Portable Document Format (the format used for printable license cards)

---

This glossary is meant to be updated as new features are added.

**Last updated:** 2026-03-22