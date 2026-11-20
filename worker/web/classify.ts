// 票的「下一步」：最新一則 comment 裡「下一步：」那一行（API 的 next_step，看板卡片顯示它）。
// 三區歸類（zone）在 NX-160 拿掉：那是 Bolas 晨報的邏輯，不放進產品。

const NEXT_STEP = /^[\s>*_-]*下一步\s*[：:]\s*(.*)$/;

// 取最新 comment 裡最後一個「下一步：」後的文字（規則要求放在最後一行，但前面有也接受）。
export function extractNextStep(body: string | null): string | null {
  if (body === null) return null;
  let found: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const m = NEXT_STEP.exec(line);
    if (m?.[1] !== undefined) {
      // 「**下一步：** xxx」的粗體記號不算內容。
      const text = m[1].replace(/^[*_\s]+|[*_\s]+$/g, '');
      if (text !== '') found = text;
    }
  }
  return found;
}
