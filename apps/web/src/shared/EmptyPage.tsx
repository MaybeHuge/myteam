import { Button, Empty } from 'antd';
export function EmptyPage({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty-page">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前页已无记录" />
      <Button onClick={onReset}>返回第一页</Button>
    </div>
  );
}
