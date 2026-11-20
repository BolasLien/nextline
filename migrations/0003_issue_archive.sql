-- NX-160：封存（不做永久刪除）。票加 archived_at（NULL＝沒封存），變更紀錄多一個欄位 archived。
-- 列表、看板預設不含已封存的票；封存與取消封存都寫變更紀錄，可以用現有的還原改回來。
--
-- issue_events 的 field 有 CHECK，SQLite 不能改既有的 CHECK，所以只重建 issue_events（其他表都沒有指向它，
-- 自己指自己的 revert_of_event_id／reverted_by_event_id 跟著改名）。issues 只加欄位，不重建，comment、blocked by 不受影響。
PRAGMA defer_foreign_keys = true;

ALTER TABLE issues ADD COLUMN archived_at TEXT;
CREATE INDEX issues_archived_idx ON issues (archived_at);

-- 變更紀錄：archived 存封存時間（from／to 是 NULL 代表沒封存）。其餘同 0002。
CREATE TABLE issue_events_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id         INTEGER NOT NULL DEFAULT 1,
  issue_number         INTEGER NOT NULL REFERENCES issues (number) ON DELETE CASCADE,
  field                TEXT    NOT NULL
                       CHECK (field IN ('title', 'description', 'status', 'project', 'sprint', 'due_date', 'blocked_by', 'archived')),
  from_value           TEXT,
  to_value             TEXT,
  actor                TEXT    NOT NULL,
  revert_of_event_id   INTEGER REFERENCES issue_events_new (id),
  reverted_by_event_id INTEGER REFERENCES issue_events_new (id),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO issue_events_new (id, workspace_id, issue_number, field, from_value, to_value, actor,
                              revert_of_event_id, reverted_by_event_id, created_at)
SELECT id, workspace_id, issue_number, field, from_value, to_value, actor,
       revert_of_event_id, reverted_by_event_id, created_at
FROM issue_events;

DROP TABLE issue_events;
ALTER TABLE issue_events_new RENAME TO issue_events;

CREATE INDEX issue_events_issue_idx ON issue_events (issue_number, created_at);
CREATE INDEX issue_events_created_idx ON issue_events (created_at);
CREATE UNIQUE INDEX issue_events_revert_of_idx ON issue_events (revert_of_event_id) WHERE revert_of_event_id IS NOT NULL;
