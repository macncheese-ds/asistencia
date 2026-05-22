// Admin configuration for TXT feature
// This file contains the fixed admin user credentials for edit mode
// Change these values as needed without modifying the database

module.exports = {
  // Admin user for TXT edit mode (can edit and add comments)
  adminUser: {
    num_empleado: "000",
    password: "Hacker2026",  // Change this password as needed
    nombre: "Administrator",
    rol: "admin"
  },
  
  // Viewer user for TXT view mode (read-only, sees all employees)
  viewerUser: {
    num_empleado: "viewer",
    password: "Viewer2026",  // Change this password as needed
    nombre: "Viewer - Visualización General",
    rol: "viewer"
  }
};
