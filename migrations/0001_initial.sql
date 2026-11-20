-- Nextline 第一版資料表。時間一律存 ISO 8601 UTC 字串（例如 2026-11-02T08:29:53.024Z）。
-- linear_id 只給 05 搬家用：重跑搬家腳本時用它判斷資料是否已存在，避免重複。

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  status      TEXT    NOT NULL DEFAULT 'planned'
              CHECK (status IN ('backlog', 'planned', 'started', 'paused', 'completed', 'canceled')),
  -- 長篇說明（規格、試行規則、Sprint 儀式），Markdown。
  description TEXT    NOT NULL DEFAULT '',
  linear_id   TEXT    UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Sprint 對應 Linear 的 Cycle。
CREATE TABLE sprints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  number     INTEGER NOT NULL UNIQUE,
  name       TEXT,
  starts_at  TEXT    NOT NULL,
  ends_at    TEXT    NOT NULL CHECK (ends_at > starts_at),
  linear_id  TEXT    UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 票號就是 number：NX-<number>。AUTOINCREMENT 保證刪過的號碼不會被重用。
CREATE TABLE issues (
  number            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 從 Linear 搬過來的舊編號（例如 BOL-150），用舊號也查得到。
  legacy_identifier TEXT    UNIQUE,
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'Backlog'
                    CHECK (status IN ('Backlog', 'Todo', 'In Progress', 'Done', 'Canceled')),
  project_id        INTEGER REFERENCES projects (id) ON DELETE SET NULL,
  sprint_id         INTEGER REFERENCES sprints (id) ON DELETE SET NULL,
  due_date          TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at      TEXT,
  canceled_at       TEXT
);

CREATE INDEX issues_status_idx ON issues (status);
CREATE INDEX issues_project_idx ON issues (project_id);
CREATE INDEX issues_sprint_idx ON issues (sprint_id);
CREATE INDEX issues_updated_idx ON issues (updated_at);

-- issue_number 被 blocked_by_number 擋住。
CREATE TABLE issue_blockers (
  issue_number      INTEGER NOT NULL REFERENCES issues (number) ON DELETE CASCADE,
  blocked_by_number INTEGER NOT NULL REFERENCES issues (number) ON DELETE CASCADE,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (issue_number, blocked_by_number),
  CHECK (issue_number <> blocked_by_number)
);

CREATE INDEX issue_blockers_blocked_by_idx ON issue_blockers (blocked_by_number);

CREATE TABLE comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number INTEGER NOT NULL REFERENCES issues (number) ON DELETE CASCADE,
  -- 誰寫的：Bolas、阿澈或某個專案 agent 的名稱。
  author       TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  linear_id    TEXT    UNIQUE,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX comments_issue_idx ON comments (issue_number, created_at);

-- 變更紀錄：狀態、Project、Sprint 什麼時候從什麼改成什麼。from_value／to_value 存文字（狀態名、Project id、Sprint id），NULL 代表空。
CREATE TABLE issue_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number INTEGER NOT NULL REFERENCES issues (number) ON DELETE CASCADE,
  field        TEXT    NOT NULL CHECK (field IN ('status', 'project', 'sprint')),
  from_value   TEXT,
  to_value     TEXT,
  actor        TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX issue_events_issue_idx ON issue_events (issue_number, created_at);
CREATE INDEX issue_events_created_idx ON issue_events (created_at);
