# Asistencia - Employee Attendance Scanner

A real-time web-based attendance tracking system built with React, Vite, Express.js, and MySQL. Employees scan their ID badges to automatically register their attendance.

## Features

- **Barcode Scanner Integration**: Fast, hands-free attendance registration using standard barcode scanners
- **Employee Lookup**: Automatically retrieves employee name and number from the `credenciales` database
- **Real-time Dashboard**: Displays recent attendance scans with timestamps
- **Dual Database Setup**: Reads from `credenciales` database, writes to `asistencia` database
- **Responsive Design**: Works on desktop and mobile devices with clean Tailwind CSS interface

## Tech Stack

**Backend:**
- Express.js v5.2.1
- Node.js with nodemon for development
- MySQL2 with connection pooling
- CORS enabled for frontend communication

**Frontend:**
- React 19.2.4
- Vite 8.0.8 (bundler)
- Axios for API requests
- Tailwind CSS 4.2.2 for styling
- React hooks for state management

## Project Structure

```
asistencia/
├── backend/
│   ├── .env              # Environment variables
│   ├── db.js             # Database connection pools
│   ├── index.js          # Express server & API endpoints
│   └── package.json      # Backend dependencies
│
└── frontend/
    ├── index.html        # HTML entry point
    ├── vite.config.js    # Vite bundler configuration
    ├── tailwind.config.js # Tailwind CSS configuration
    ├── postcss.config.js # PostCSS configuration
    ├── src/
    │   ├── main.jsx      # React app entry
    │   ├── App.jsx       # Main component
    │   ├── index.css     # Tailwind CSS imports
    │   └── assets/       # Static assets
    └── package.json      # Frontend dependencies
```

## Installation & Setup

### Prerequisites
- Node.js 18+ and npm
- MySQL Server running locally (or update `.env` with your server details)
- Your `credenciales` database with a `users` table containing:
  - `num_empleado` (employee number)
  - `usuario` (employee username)
  - `nombre` (full name)

### Step 1: Backend Setup

```bash
cd asistencia/backend
```

Create or update `.env` file:
```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=asistencia
CRED_DB_HOST=localhost
CRED_DB_USER=root
CRED_DB_PASSWORD=
CRED_DB_NAME=credenciales
```

Install dependencies:
```bash
npm install
```

Start the development server:
```bash
npm run dev
```

The server will automatically:
- Create the `asistencia` database if it doesn't exist
- Create the `assistance_logs` table
- Start listening on `http://localhost:3000`

### Step 2: Frontend Setup

In a new terminal:
```bash
cd asistencia/frontend
npm install
npm run dev
```

The frontend will start on `http://localhost:5173/`

## Usage

1. **Open the Dashboard**: Navigate to `http://localhost:5173/` in your browser
2. **Scan Employee Badge**: Use a barcode scanner to scan the employee's ID/badge number
3. **Automatic Registration**: The system will:
   - Look up the employee in the `credenciales` database
   - Register the attendance in the `asistencia` database
   - Display the employee's name and timestamp
4. **View Recent Scans**: The dashboard shows the last 10 scans with timestamps

## API Endpoints

### POST `/api/scan`
Register an employee's attendance

**Request:**
```json
{
  "num_empleado": "12345"
}
```

**Success Response (200):**
```json
{
  "message": "Asistencia registrada",
  "user": {
    "num_empleado": "12345",
    "full_name": "Juan Pérez",
    "date": "2026-04-10T21:50:00.000Z"
  }
}
```

**Error Responses:**
- `400`: Missing num_empleado
- `404`: Employee not found in credenciales database
- `500`: Server error

### GET `/api/history`
Retrieve the last 50 attendance logs

**Response:**
```json
[
  {
    "id": 1,
    "num_empleado": "12345",
    "full_name": "Juan Pérez",
    "scan_time": "2026-04-10T21:50:00.000Z"
  },
  ...
]
```

## Database Schema

### `credenciales.users` (Must already exist)
```sql
-- Your existing users table should have:
- id (INT)
- usuario (VARCHAR) - username
- num_empleado (VARCHAR) - employee number
- nombre (VARCHAR) - full name
- ... other fields
```

### `asistencia.assistance_logs` (Auto-created)
```sql
CREATE TABLE assistance_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  num_empleado VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  scan_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Development

### Running in Development Mode

**Terminal 1 - Backend:**
```bash
cd asistencia/backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd asistencia/frontend
npm run dev
```

### Building for Production

**Backend:** No build step required - runs Node.js directly

**Frontend:**
```bash
cd asistencia/frontend
npm run build
```

Output will be in `dist/` folder

### Preview Production Build
```bash
npm run preview
```

## Troubleshooting

### "Employee not found" error
- Verify the employee number exists in the `credenciales.users` table
- Check that the columns `num_empleado` and `nombre` are correctly named in your database
- Ensure both databases are using the same employee numbering scheme

### "Cannot connect to database"
- Verify MySQL is running
- Check `.env` credentials match your MySQL user
- Ensure `credenciales` database exists with a `users` table
- For Windows users: may need to use `127.0.0.1` instead of `localhost`

### Frontend not connecting to backend
- Verify backend is running on port 3000
- Check that CORS is enabled (it is by default)
- Ensure frontend is configured to hit `http://localhost:3000`

### Barcode scanner not working
- Ensure the scanner emulates keyboard input (standard USB scanners do)
- Keep focus on the input field (dashboard auto-focuses)
- Verify the scanner sends a carriage return/Enter after the code

## Common Database Issues

If you need to see what's in your database:

```bash
# Check if asistencia database was created
mysql -u root -e "SHOW DATABASES;" | grep asistencia

# Check the assistance_logs table
mysql -u root asistencia -e "SELECT * FROM assistance_logs;"

# Check your credenciales users
mysql -u root credenciales -e "SELECT num_empleado, nombre FROM users LIMIT 5;"
```

## Performance Notes

- The frontend caches the last 10 scans in memory (resets on page reload)
- Backend supports 10 concurrent connections by default
- Each scan operation takes <100ms on modern hardware
- Ideal for environments with up to 1000+ employees

## Security Notes

- Employee credentials are NOT required for attendance registration
- The app only reads from `credenciales`, never modifies it
- All queries use parameterized statements (no SQL injection)
- CORS is configured but ensure proper firewall rules in production

## License

Internal project - Proprietary

## Support

For issues or questions about this application, contact the development team.