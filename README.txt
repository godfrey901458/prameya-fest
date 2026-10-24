PRAMEYA 1.0 — IT BATTLE
Frontend + Node.js/Express backend + MySQL database

REQUIREMENTS
1. Node.js LTS installed.
2. XAMPP installed (start MySQL from XAMPP Control Panel; Apache is not needed).
3. VS Code or another editor.

STEP 1 — EXTRACT AND OPEN
Extract this ZIP. Open the PRAMEYA_1.0_Website folder in VS Code.
Open Terminal > New Terminal in VS Code.

STEP 2 — CREATE DATABASE
A. Start MySQL in XAMPP Control Panel.
B. Open http://localhost/phpmyadmin
C. Click Import, choose database.sql from this project, and click Import/Go.
   This creates the prameya_fest database, admins table, and registrations table.
   If your MySQL root account has a password, you will enter it in the next step.

STEP 3 — CONFIGURE THE BACKEND
In the VS Code terminal run:
  npm install
Copy .env.example to a new file named .env (same project folder).
Edit .env and set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
For a typical local XAMPP setup: DB_HOST=localhost, DB_PORT=3306,
DB_USER=root, DB_PASSWORD= (leave blank only if your root account has no password),
DB_NAME=prameya_fest.
Set JWT_SECRET to a long random secret of at least 32 characters.
Do not share .env or upload it to GitHub.

STEP 4 — CREATE THE ORGANIZER LOGIN
Run:
  npm run create-admin
Enter a username and a password of at least 12 characters.
The password is hashed before it is stored in MySQL. The script input may be visible
while typing in the terminal, so create the account in a private environment.
If you need to change the password, run the command again with the same username.

STEP 5 — START THE WEBSITE
Run:
  npm start
Open:
  http://localhost:3000
Do NOT open index.html directly from File Explorer. The frontend must use the Node server.
The organizer / coordinator console is:
  http://localhost:3000/admin.html

COORDINATOR MODULE
1. Organizers sign in to the console and open http://localhost:3000/coordinators.html to create
   a coordinator: give a unique coordinator ID, a password (at least 8 characters), and the event
   they manage.
2. Coordinators sign in on the console page (http://localhost:3000/admin.html) with their
   own ID and password. The login detects the role and opens the matching view automatically.
3. A coordinator only sees registrations for their own event and can upload that event's
   winner and runner-up. Saved results appear in the organizer view under "Event Results".

TEST
1. Submit a registration from register.html.
2. Visit /admin.html and log in with the organizer account you created.
3. Confirm the entry appears and test the event filter and Export CSV.
4. Database connectivity check: http://localhost:3000/api/health

DATABASE RULES
- Registration records are stored in MySQL and persist after closing the browser.
- Admin passwords are bcrypt-hashed. Admin endpoints require a signed JWT.
- The server applies basic request rate limits and validates submitted values.

IMPORTANT
- This is a local development setup. Before real/public deployment, use HTTPS, a strong
  unique JWT secret, a dedicated least-privilege database account, backups, and hosting
  with environment secrets. Consider privacy/data-retention requirements for student data.
- Do not use this as a public production deployment without security review.
- Email confirmations are not configured.
- Team-size and event rules still need official organizer confirmation.
