-- NX-165：Project 不再有狀態（2026-11-04 Bolas）。側欄改看「有沒有沒做完的票」與釘選，網頁、API、MCP 都不再有 status。
-- SQLite 3.35+ 的 ALTER TABLE DROP COLUMN（D1 支援）：status 只有自己的 CHECK、沒有索引、外鍵或 view 用到，
-- 可以直接刪，不用重建表；projects 的 id 不變，issues.project_id 的外鍵不受影響。
ALTER TABLE projects DROP COLUMN status;
