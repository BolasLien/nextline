-- NX-152：狀態加 In Review（待驗收）、票加看板排序位置 position、主要資料表加 workspace_id、
-- 變更紀錄擴大到所有欄位並可以還原。
--
-- SQLite 不能改既有的 CHECK，所以 issues 與 issue_events 要重建；comments、issue_blockers 也一起重建，原因：
-- 外鍵開著時 DROP TABLE issues 會先做一次隱含的 DELETE，觸發子表的 ON DELETE CASCADE，把 comment 全刪掉。
-- 做法：新表都指向 issues_new → 先刪舊的子表、再刪舊的 issues（這時已經沒有表指向它）→ 改名。
-- ALTER TABLE RENAME 會把其他表外鍵裡的 issues_new 一起改成 issues。
-- workspace_id 先固定 1；SQLite 的 ADD COLUMN 在外鍵開著時不能帶非 NULL 預設值的 REFERENCES，所以各表都不加外鍵。
PRAGMA defer_foreign_keys = true;

CREATE TABLE workspaces (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO workspaces (id, name) VALUES (1, 'Bolas');

ALTER TABLE projects ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sprints ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1;

-- ---- issues ----

CREATE TABLE issues_new (
  number            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id      INTEGER NOT NULL DEFAULT 1,
  legacy_identifier TEXT    UNIQUE,
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'Backlog'
                    CHECK (status IN ('Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled')),
  -- 看板同一欄（同一個狀態）裡的順序，小的在上。整數、間隔 1024，插在兩張中間取中間值；沒空隙時整欄重新編號。
  position          INTEGER NOT NULL DEFAULT 0,
  project_id        INTEGER REFERENCES projects (id) ON DELETE SET NULL,
  sprint_id         INTEGER REFERENCES sprints (id) ON DELETE SET NULL,
  due_date          TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at      TEXT,
  canceled_at       TEXT
);

-- 舊資料的 position：每個狀態各自依更新時間新到舊排（跟原本列表的順序一樣），1024、2048、…
INSERT INTO issues_new (number, workspace_id, legacy_identifier, title, description, status, position,
                        project_id, sprint_id, due_date, created_at, updated_at, completed_at, canceled_at)
SELECT number, 1, legacy_identifier, title, description, status,
       ROW_NUMBER() OVER (PARTITION BY status ORDER BY updated_at DESC, number DESC) * 1024,
       project_id, sprint_id, due_date, created_at, updated_at, completed_at, canceled_at
FROM issues;

-- ---- comments ----

CREATE TABLE comments_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  issue_number INTEGER NOT NULL REFERENCES issues_new (number) ON DELETE CASCADE,
  author       TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  linear_id    TEXT    UNIQUE,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO comments_new (id, workspace_id, issue_number, author, body, linear_id, created_at, updated_at)
SELECT id, 1, issue_number, author, body, linear_id, created_at, updated_at FROM comments;

-- ---- issue_blockers ----

CREATE TABLE issue_blockers_new (
  workspace_id      INTEGER NOT NULL DEFAULT 1,
  issue_number      INTEGER NOT NULL REFERENCES issues_new (number) ON DELETE CASCADE,
  blocked_by_number INTEGER NOT NULL REFERENCES issues_new (number) ON DELETE CASCADE,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (issue_number, blocked_by_number),
  CHECK (issue_number <> blocked_by_number)
);

INSERT INTO issue_blockers_new (workspace_id, issue_number, blocked_by_number, created_at)
SELECT 1, issue_number, blocked_by_number, created_at FROM issue_blockers;

-- ---- issue_events ----

-- 變更紀錄：每次改欄位一筆。from_value／to_value 存文字，NULL 代表空：
--   status 存狀態名；project、sprint 存 id；title、description、due_date 存原文；
--   blocked_by 存擋住這張票的票號數字：加入是 NULL → n，移除是 n → NULL。
-- 還原：新的那筆 revert_of_event_id 指向被還原的那筆，被還原的那筆 reverted_by_event_id 指回來。
CREATE TABLE issue_events_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id         INTEGER NOT NULL DEFAULT 1,
  issue_number         INTEGER NOT NULL REFERENCES issues_new (number) ON DELETE CASCADE,
  field                TEXT    NOT NULL
                       CHECK (field IN ('title', 'description', 'status', 'project', 'sprint', 'due_date', 'blocked_by')),
  from_value           TEXT,
  to_value             TEXT,
  actor                TEXT    NOT NULL,
  revert_of_event_id   INTEGER REFERENCES issue_events_new (id),
  reverted_by_event_id INTEGER REFERENCES issue_events_new (id),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO issue_events_new (id, workspace_id, issue_number, field, from_value, to_value, actor, created_at)
SELECT id, 1, issue_number, field, from_value, to_value, actor, created_at FROM issue_events;

-- ---- 換掉舊表：先子表、再 issues，最後改名 ----

DROP TABLE issue_events;
DROP TABLE issue_blockers;
DROP TABLE comments;
DROP TABLE issues;

ALTER TABLE issues_new RENAME TO issues;
ALTER TABLE comments_new RENAME TO comments;
ALTER TABLE issue_blockers_new RENAME TO issue_blockers;
ALTER TABLE issue_events_new RENAME TO issue_events;

CREATE INDEX issues_status_idx ON issues (status);
CREATE INDEX issues_project_idx ON issues (project_id);
CREATE INDEX issues_sprint_idx ON issues (sprint_id);
CREATE INDEX issues_updated_idx ON issues (updated_at);
CREATE INDEX issues_board_idx ON issues (workspace_id, status, position);
CREATE INDEX issue_blockers_blocked_by_idx ON issue_blockers (blocked_by_number);
CREATE INDEX comments_issue_idx ON comments (issue_number, created_at);
CREATE INDEX issue_events_issue_idx ON issue_events (issue_number, created_at);
CREATE INDEX issue_events_created_idx ON issue_events (created_at);
-- 一筆變更只能被還原一次；同時送兩次還原，第二次會撞這個索引。
CREATE UNIQUE INDEX issue_events_revert_of_idx ON issue_events (revert_of_event_id) WHERE revert_of_event_id IS NOT NULL;
