import { describe, expect, it } from 'vitest';
import { extractNextStep } from './classify';

describe('extractNextStep', () => {
  it('取最後一個「下一步：」', () => {
    expect(extractNextStep('做完 A\n下一步：先看 B\n補充\n下一步：Bolas 驗收')).toBe('Bolas 驗收');
  });

  it('接受半形冒號、清單符號與粗體', () => {
    expect(extractNextStep('- **下一步：** 開 ~/x.md 看')).toBe('開 ~/x.md 看');
    expect(extractNextStep('下一步: 等 session 回報')).toBe('等 session 回報');
  });

  it('沒有或空白的「下一步：」回 null', () => {
    expect(extractNextStep(null)).toBeNull();
    expect(extractNextStep('只寫了進度')).toBeNull();
    expect(extractNextStep('下一步：   ')).toBeNull();
  });
});
