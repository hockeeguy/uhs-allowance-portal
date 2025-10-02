# UHS Allowance Portal

## Setup
1) Copy `.env.local.example` → `.env.local` and fill Firebase config from Project settings → Web app config.
2) Install & run:
```
npm install
npm run dev
```
Open http://localhost:3000

## Admin
- `/admin` route for admins (emails in `NEXT_PUBLIC_ADMIN_EMAILS`).
- Inline editing of client cards (Type/Link/Notes, client name/email).
- Status per client: `pending`, `reviewed`, `approved`.
- Search text and filter by status.
- Export All CSV, Print single PDF, Print All PDF.
- Print-friendly stylesheet with page breaks.

## Client
- Multiple items per category (add/remove).
- Images per item, notes, link/SKU.
- Export CSV/PDF.

## Firestore Rules (example)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isSelf(userId) { return signedIn() && request.auth.uid == userId; }
    function isAdmin() {
      return signedIn() &&
        (request.auth.token.email == "david.gould@unityhomesolutions.net" ||
         request.auth.token.email == "maxwell.malone@unityhomesolutions.net" ||
         request.auth.token.email == "kellie.locke@unityhomesolutions.net");
    }
    match /selections/{userId} {
      allow read, write: if isSelf(userId) || isAdmin();
    }
  }
}
```
