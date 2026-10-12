<?php
declare(strict_types=1);

// Optional host-only telemetry. A battery-status failure must not stop a recording.
function save_field_power(string $deviceId, mixed $input, int $now): void
{
    if (!is_array($input)) return; // Older bridges remain compatible.
    $percent = $input['battery_percent'] ?? null;
    $percent = is_int($percent) && $percent >= 0 && $percent <= 100 ? $percent : null;
    $values = ['id' => $deviceId, 'percent' => $percent, 'at' => $now];
    foreach (['on_ac', 'charging', 'has_battery'] as $key) {
        $value = $input[$key] ?? null;
        $values[$key] = is_bool($value) ? (int) $value : null;
    }
    if ($values['has_battery'] === 0) { $values['percent'] = null; $values['charging'] = 0; }
    $temperature = $input['laptop_temp_f'] ?? null;
    $values['temp_f'] = is_int($temperature) && $temperature >= 33 && $temperature <= 260 ? $temperature : null;
    try {
        $sql = 'REPLACE INTO temperature_device_power (device_id, battery_percent, on_ac, charging, has_battery, laptop_temp_f, reported_at)
            VALUES (:id, :percent, :on_ac, :charging, :has_battery, :temp_f, :at)';
        try { db()->prepare($sql)->execute($values); }
        catch (PDOException $error) {
            // Additive, automatic first-use migrations; existing test tables are untouched.
            if ($error->getCode() === '42S02') db()->exec('CREATE TABLE IF NOT EXISTS temperature_device_power (
                device_id CHAR(16) NOT NULL PRIMARY KEY, battery_percent TINYINT UNSIGNED NULL,
                on_ac TINYINT NULL, charging TINYINT NULL, has_battery TINYINT NULL,
                laptop_temp_f SMALLINT NULL, reported_at BIGINT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
            elseif (str_contains($error->getMessage(), 'laptop_temp_f')) db()->exec('ALTER TABLE temperature_device_power ADD COLUMN laptop_temp_f SMALLINT NULL');
            else throw $error;
            db()->prepare($sql)->execute($values);
        }
    } catch (PDOException $error) { error_log('Field laptop power status could not be saved.'); }
}

function list_field_power(): array
{
    try {
        $result = [];
        foreach (db()->query('SELECT * FROM temperature_device_power')->fetchAll() as $row) {
            $power = ['battery_percent' => $row['battery_percent'] === null ? null : (int) $row['battery_percent'],
                'reported_at' => (int) $row['reported_at']];
            foreach (['on_ac', 'charging', 'has_battery'] as $key) $power[$key] = $row[$key] === null ? null : (bool) $row[$key];
            $power['laptop_temp_f'] = isset($row['laptop_temp_f']) ? (int) $row['laptop_temp_f'] : null;
            $result[$row['device_id']] = $power;
        }
        return $result;
    } catch (PDOException $error) { return []; }
}
