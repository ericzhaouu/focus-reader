import { requestHostAccess } from '../lib/permissions';

interface Props {
  onGranted: () => void;
}

/**
 * `chrome.permissions.request` only works inside a real user gesture, so the call
 * happens directly in the click handler with nothing awaited before it.
 */
export default function FocusPermissionBanner({ onGranted }: Props) {
  const handleClick = (): void => {
    void requestHostAccess().then((granted) => {
      if (granted) onGranted();
    });
  };

  return (
    <div className="banner banner--info">
      <div className="banner__body">
        <div className="banner__title">专注阅读模式还差一步</div>
        <div className="muted">
          要把文章渲染成无干扰的阅读视图，需要授予读取网页内容的权限。内容只在你本地处理，不会上传到任何地方。
        </div>
      </div>
      <button className="btn btn--primary" onClick={handleClick}>
        授予权限
      </button>
    </div>
  );
}
