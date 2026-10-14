<?php
declare(strict_types=1);

// Temperature feed check. The field app checks in every 5 seconds; one row per
// laptop per minute keeps how many check-ins arrived, how many said MadgeTech was
// delivering readings, and the hottest laptop temperature. Compared with the
// readings that reached the site (and when they arrived), this tells a stopped
// logger from a frozen laptop or a dropped internet connection.

function feed_table_missing(PDOException $error): bool
{
    return $error->getCode() === '42S02' || str_contains($error->getMessage(), 'no such table');
}

function save_field_checkin(string $deviceId, bool $ready, mixed $tempF, int $now): void
{
    $minute = $now - $now % 60000;
    $temp = is_int($tempF) && $tempF >= 33 && $tempF <= 260 ? $tempF : null;
    $values = ['id' => $deviceId, 'minute' => $minute, 'ready' => $ready ? 1 : 0];
    try {
        $sql = 'UPDATE temperature_device_checkins SET checkins = checkins + 1, ready = ready + :ready,
            laptop_temp_f = CASE WHEN laptop_temp_f IS NULL OR laptop_temp_f < :temp THEN :temp2 ELSE laptop_temp_f END
            WHERE device_id = :id AND minute_at = :minute';
        $params = $values + ['temp' => $temp ?? 0, 'temp2' => $temp];
        try { ($update = db()->prepare($sql))->execute($params); }
        catch (PDOException $error) {
            // Additive first-use migration; no existing table is touched. Numbers only, so the
            // server's default engine and character set are fine.
            if (!feed_table_missing($error)) throw $error;
            db()->exec('CREATE TABLE IF NOT EXISTS temperature_device_checkins (
                device_id CHAR(16) NOT NULL, minute_at BIGINT NOT NULL,
                checkins SMALLINT NOT NULL, ready SMALLINT NOT NULL, laptop_temp_f SMALLINT NULL,
                PRIMARY KEY (device_id, minute_at))');
            ($update = db()->prepare($sql))->execute($params);
        }
        if ($update->rowCount() > 0) return;
        db()->prepare('INSERT INTO temperature_device_checkins (device_id, minute_at, checkins, ready, laptop_temp_f)
            VALUES (:id, :minute, 1, :ready, :temp)')->execute($values + ['temp' => $temp]);
        db()->prepare('DELETE FROM temperature_device_checkins WHERE device_id = :id AND minute_at < :old')
            ->execute(['id' => $deviceId, 'old' => $minute - 30 * 86400000]);
    } catch (PDOException $error) { error_log('Field laptop check-in could not be saved.'); }
}

// Per-minute readings (and how many arrived more than 90 seconds late) for one
// test, with the field laptop's check-ins for the same minutes. Only recordings
// that ran after $since (the current job's start) are included.
function feed_check(string $sessionId, string $slot, int $now, int $since = 0): array
{
    $sources = db()->prepare('SELECT s.id, s.sample_interval_seconds, s.created_at, r.device_id, r.stopped_at
        FROM temperature_sources s LEFT JOIN temperature_device_runs r ON r.source_id = s.id
        WHERE s.session_id = :session_id AND s.slot = :slot ORDER BY s.created_at');
    $sources->execute(['session_id' => $sessionId, 'slot' => $slot]);
    $recordings = [];
    foreach ($sources->fetchAll() as $row) {
        if ($row['stopped_at'] !== null && (int) $row['stopped_at'] < $since) continue;
        $recordings[] = ['id' => $row['id'], 'device_id' => $row['device_id'],
            'interval_seconds' => max(2, min(60, (int) $row['sample_interval_seconds'])),
            'from' => max($since, (int) $row['created_at']), 'to' => $row['stopped_at'] === null ? null : (int) $row['stopped_at']];
    }
    $minutes = [];
    if ($recordings) {
        $readings = db()->prepare('SELECT captured_at - (captured_at % 60000) AS minute_at, COUNT(*) AS readings,
            SUM(CASE WHEN received_at - captured_at > 90000 THEN 1 ELSE 0 END) AS late
            FROM temperature_readings WHERE session_id = :session_id AND slot = :slot AND captured_at >= :from
            GROUP BY captured_at - (captured_at % 60000) ORDER BY minute_at');
        $readings->execute(['session_id' => $sessionId, 'slot' => $slot, 'from' => $recordings[0]['from']]);
        foreach ($readings->fetchAll() as $row) $minutes[] = ['at' => (int) $row['minute_at'], 'readings' => (int) $row['readings'], 'late' => (int) $row['late']];
    }
    $devices = array_values(array_unique(array_filter(array_column($recordings, 'device_id'))));
    $checkins = [];
    $loggedSince = null;
    if ($devices && $recordings) {
        try {
            $marks = implode(',', array_fill(0, count($devices), '?'));
            $first = db()->prepare("SELECT MIN(minute_at) AS first_at FROM temperature_device_checkins WHERE device_id IN ($marks)");
            $first->execute($devices);
            $loggedSince = ($value = $first->fetch()['first_at'] ?? null) === null ? null : (int) $value;
            $query = db()->prepare("SELECT minute_at, SUM(checkins) AS checkins, SUM(ready) AS ready, MAX(laptop_temp_f) AS laptop_temp_f
                FROM temperature_device_checkins WHERE device_id IN ($marks) AND minute_at >= ? GROUP BY minute_at ORDER BY minute_at");
            $query->execute([...$devices, $recordings[0]['from'] - 60000]);
            foreach ($query->fetchAll() as $row) $checkins[] = ['at' => (int) $row['minute_at'], 'checkins' => (int) $row['checkins'],
                'ready' => (int) $row['ready'], 'laptop_temp_f' => $row['laptop_temp_f'] === null ? null : (int) $row['laptop_temp_f']];
        } catch (PDOException $error) {
            if (!feed_table_missing($error)) throw $error;
        }
    }
    return ['recordings' => $recordings, 'minutes' => $minutes, 'checkins' => $checkins, 'checkins_since' => $loggedSince, 'server_time' => $now];
}
