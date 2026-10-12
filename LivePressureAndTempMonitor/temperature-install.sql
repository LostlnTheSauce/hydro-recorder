CREATE TABLE IF NOT EXISTS temperature_sources (
    id CHAR(16) PRIMARY KEY,
    session_id VARCHAR(32) NOT NULL,
    slot ENUM('A', 'B') NOT NULL,
    serial VARCHAR(40) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    sample_interval_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 2,
    whole_degrees TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_temperature_sources_session FOREIGN KEY (session_id)
        REFERENCES live_sessions(id) ON DELETE CASCADE,
    INDEX idx_temperature_sources_session_slot (session_id, slot, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS temperature_readings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_id CHAR(16) NOT NULL,
    session_id VARCHAR(32) NOT NULL,
    slot ENUM('A', 'B') NOT NULL,
    captured_at BIGINT UNSIGNED NOT NULL,
    received_at BIGINT UNSIGNED NOT NULL,
    pipe DOUBLE NULL,
    soil DOUBLE NULL,
    ambient DOUBLE NULL,
    aux DOUBLE NULL,
    CONSTRAINT fk_temperature_readings_source FOREIGN KEY (source_id)
        REFERENCES temperature_sources(id) ON DELETE CASCADE,
    CONSTRAINT fk_temperature_readings_session FOREIGN KEY (session_id)
        REFERENCES live_sessions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_temperature_sample (source_id, captured_at),
    INDEX idx_temperature_readings_session_id (session_id, id),
    INDEX idx_temperature_readings_session_slot_time (session_id, slot, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trusted field laptops are enrolled once by the operator. Tokens are stored as hashes;
-- a serial number alone never grants write access or makes a device appear online.
CREATE TABLE IF NOT EXISTS temperature_devices (
    id CHAR(16) PRIMARY KEY,
    serial VARCHAR(40) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    ready TINYINT(1) NOT NULL DEFAULT 0,
    last_seen_at BIGINT UNSIGNED NULL,
    source_id CHAR(16) NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    UNIQUE KEY uq_temperature_device_serial (serial),
    INDEX idx_temperature_device_source (source_id),
    CONSTRAINT fk_temperature_device_source FOREIGN KEY (source_id)
        REFERENCES temperature_sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A run defines exactly the website's Start/Stop window. Stopped runs stay
-- assigned until the field app has uploaded its locally saved in-window data.
CREATE TABLE IF NOT EXISTS temperature_device_runs (
    source_id CHAR(16) PRIMARY KEY,
    device_id CHAR(16) NOT NULL,
    stopped_at BIGINT UNSIGNED NULL,
    CONSTRAINT fk_temperature_run_source FOREIGN KEY (source_id)
        REFERENCES temperature_sources(id) ON DELETE CASCADE,
    CONSTRAINT fk_temperature_run_device FOREIGN KEY (device_id)
        REFERENCES temperature_devices(id) ON DELETE CASCADE,
    INDEX idx_temperature_run_device (device_id, stopped_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
