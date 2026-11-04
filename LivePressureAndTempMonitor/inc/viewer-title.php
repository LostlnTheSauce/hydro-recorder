<?php
declare(strict_types=1);

// The title of a shared live view, readable without the viewer password so the sign-in page can
// show which test it is. Only titles the host chose to share are kept: saved when remote viewing
// starts, removed when it stops, and never for private recordings.

function viewer_title_schema(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS live_viewer_titles (session_id CHAR(16) PRIMARY KEY, title VARCHAR(100) NOT NULL, updated_at BIGINT NOT NULL)');
}

function viewer_title_set(PDO $db, string $sessionId, string $title, int $now): void {
    viewer_title_schema($db);
    $db->prepare('DELETE FROM live_viewer_titles WHERE session_id = ?')->execute([$sessionId]);
    $db->prepare('INSERT INTO live_viewer_titles (session_id, title, updated_at) VALUES (?, ?, ?)')->execute([$sessionId, $title, $now]);
}

function viewer_title_clear(PDO $db, string $sessionId): void {
    viewer_title_schema($db);
    $db->prepare('DELETE FROM live_viewer_titles WHERE session_id = ?')->execute([$sessionId]);
}

// The shared title, or null (not shared, sharing stopped, or the session has expired).
function viewer_title_get(PDO $db, string $sessionId): ?string {
    if (!preg_match('/^[a-f0-9]{16}$/', $sessionId)) return null;
    viewer_title_schema($db);
    $q = $db->prepare('SELECT t.title FROM live_viewer_titles t JOIN live_sessions s ON s.id = t.session_id WHERE t.session_id = ?');
    $q->execute([$sessionId]);
    $title = $q->fetchColumn();
    return $title === false ? null : (string) $title;
}
