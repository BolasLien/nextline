import { Link } from 'react-router';
import { PageHeader } from '../shell/AppShell';
import type { IconName } from '../ui/Icon';
import { EmptyState } from '../ui/states';

// 側欄連得到、但功能還沒做的頁面（設定…）。
export function PlaceholderPage({ title, icon }: { title: string; icon: IconName }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="view">
        <EmptyState icon={icon} title={`${title}尚未完成`} action={<Link className="nl-btn nl-btn--secondary" to="/">回看板</Link>} />
      </div>
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="找不到" />
      <div className="view">
        <EmptyState icon="search" title="找不到這一頁" action={<Link className="nl-btn nl-btn--secondary" to="/">回看板</Link>}>
          網址錯誤，或頁面已移除。
        </EmptyState>
      </div>
    </>
  );
}
