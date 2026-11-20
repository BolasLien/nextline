-- NX-162：Project 可以釘選在側欄最上方。projects 加 pinned_at（NULL＝沒釘選），只加欄位，不重建，其他表不受影響。
-- 排序用的 last_activity_at（Project、底下的票、底下票的 comment 最新時間）由 API 即時算，不存欄位。
ALTER TABLE projects ADD COLUMN pinned_at TEXT;
