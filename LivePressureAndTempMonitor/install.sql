CREATE TABLE IF NOT EXISTS live_sessions (
    id VARCHAR(32) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    viewer_password_hash VARCHAR(255) NOT NULL,
    publisher_token_hash CHAR(64) NOT NULL,
    config_json MEDIUMTEXT NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    INDEX idx_live_sessions_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS live_readings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(32) NOT NULL,
    slot ENUM('A', 'B') NOT NULL,
    captured_at BIGINT UNSIGNED NOT NULL,
    pressure DOUBLE NOT NULL,
    unit VARCHAR(12) NOT NULL DEFAULT 'PSI',
    CONSTRAINT fk_live_readings_session FOREIGN KEY (session_id)
        REFERENCES live_sessions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_live_reading (session_id, slot, captured_at),
    INDEX idx_live_readings_session_time (session_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
