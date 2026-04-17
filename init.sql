-- Asistencia Database Initialization Script
-- This script creates the necessary tables for the attendance tracking system

-- Create the asistencia database (if it doesn't exist)
CREATE DATABASE IF NOT EXISTS `asistencia`;

-- Use the asistencia database
USE `asistencia`;

-- Create the assistance_logs table
CREATE TABLE IF NOT EXISTS `assistance_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `num_empleado` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `area` VARCHAR(255),
  `turn` INT DEFAULT 1,
  `scan_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_num_empleado` (`num_empleado`),
  INDEX `idx_scan_time` (`scan_time`),
  INDEX `idx_turn` (`turn`),
  INDEX `idx_daily_scan` (`num_empleado`, `scan_time`, `turn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample data (Optional - for testing)
-- Uncomment the following lines to insert test records
/*
INSERT INTO `assistance_logs` (`num_empleado`, `full_name`, `scan_time`) VALUES
('12345', 'Juan Pérez', NOW()),
('12346', 'María García', DATE_SUB(NOW(), INTERVAL 5 MINUTE)),
('12347', 'Carlos López', DATE_SUB(NOW(), INTERVAL 10 MINUTE));
*/

-- Create a view for daily attendance summary (Optional but useful)
CREATE OR REPLACE VIEW `daily_attendance_summary` AS
SELECT 
  DATE(`scan_time`) AS `attendance_date`,
  COUNT(DISTINCT `num_empleado`) AS `unique_employees`,
  COUNT(*) AS `total_scans`,
  MIN(`scan_time`) AS `earliest_scan`,
  MAX(`scan_time`) AS `latest_scan`
FROM `assistance_logs`
GROUP BY DATE(`scan_time`)
ORDER BY `attendance_date` DESC;

-- Create a view for employee attendance history (Optional but useful)
CREATE OR REPLACE VIEW `employee_attendance_history` AS
SELECT 
  `num_empleado`,
  `full_name`,
  DATE(`scan_time`) AS `attendance_date`,
  COUNT(*) AS `scans_count`,
  MIN(`scan_time`) AS `first_scan`,
  MAX(`scan_time`) AS `last_scan`
FROM `assistance_logs`
GROUP BY `num_empleado`, `full_name`, DATE(`scan_time`)
ORDER BY `attendance_date` DESC, `num_empleado` ASC;

-- Verify the tables were created
SELECT 'Asistencia database setup completed successfully!' AS status;
SELECT COUNT(*) AS 'assistance_logs_count' FROM `assistance_logs`;
