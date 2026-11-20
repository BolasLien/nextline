// 畫面拋錯時不要整頁空白（NX-160）：React 會把出錯的那一塊卸載，沒有 boundary 就是整個 #root 都不見。
// AppShell 把主內容、右側預覽各包一層（換頁就重來），App 最外層再包一層當最後防線。
// 出錯時顯示原因與「再試一次」／「重新整理」，錯誤也印到 console，方便回報。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './states';

interface Props {
  children: ReactNode;
  // 這一塊叫什麼（「這一頁」「預覽」），寫進標題
  area: string;
  // 整頁版：沒有側欄可以用，所以給「重新整理」
  fullPage?: boolean;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[Nextline] ${this.props.area}出錯了`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const message = `${error.message || '未知錯誤'}。資料仍保存在伺服器，${this.props.fullPage === true ? '重新整理' : '再試一次'}即可恢復。`;
    return (
      <div className={this.props.fullPage === true ? 'view error-boundary error-boundary--page' : 'view error-boundary'} data-error-boundary={this.props.area}>
        <ErrorState
          title={`${this.props.area}發生錯誤`}
          message={message}
          onRetry={() => {
            if (this.props.fullPage === true) window.location.reload();
            else this.setState({ error: null });
          }}
        />
      </div>
    );
  }
}
